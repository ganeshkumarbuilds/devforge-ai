const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const prisma = require('../lib/prisma');
const { createAgents } = require('../agents');
const { generatedDir } = require('../config');
const { sleep } = require('../agents/baseAgent');
const { isRateLimitError } = require('../services/openrouterService');
const { writeLog } = require('./buildLogService');
const { languageOf, IGNORED_DIRS } = require('../utils/fileUtils');
const { finalizeGeneratedProject } = require('./finalizeService');

const PROGRESS_THROTTLE_MS = 600;
const OUTPUT_THROTTLE_MS = 700;

function makeSafePath(projectId, filePath) {
  return path.join(generatedDir, projectId, filePath);
}

async function writeFileTree(rootDir, files) {
  for (const f of files) {
    const absolute = path.resolve(makeSafePath(rootDir, f.path));
    const root = path.resolve(path.join(generatedDir, rootDir));
    if (!absolute.startsWith(root + path.sep) && absolute !== root) {
      console.warn('[Pipeline] refused unsafe file path:', f.path);
      continue;
    }
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, f.content, 'utf8');
  }
}

async function validateJsonFiles(projectId, files) {
  for (const f of files) {
    if (f.path.endsWith('.json')) {
      try {
        JSON.parse(f.content);
        console.log(`[Pipeline] Validated JSON file: ${f.path}`);
      } catch (jsonErr) {
        console.error(`[Pipeline] Invalid JSON in file ${f.path}: ${jsonErr.message}`);
        console.error(`[Pipeline] Content: ${f.content.substring(0, 500)}...`);
        throw new Error(`Invalid JSON in file ${f.path}: ${jsonErr.message}`);
      }
    }
  }
}

async function syncFilesToDb(projectId, filesMap) {
  const fileEntries = Object.entries(filesMap);
  for (const [p, content] of fileEntries) {
    await prisma.projectFile.upsert({
      where: { projectId_path: { projectId, path: p } },
      update: { content, language: languageOf(p) },
      create: { projectId, path: p, content, language: languageOf(p) },
    }).catch((err) => console.error('[Pipeline DB sync error]', err.message));
  }
}

function createZip(projectId) {
  const zip = new AdmZip();
  const rootDir = path.join(generatedDir, projectId);
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Never ship dependencies or build artifacts in the exported ZIP.
      if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(full, rel);
      } else {
        zip.addLocalFile(full, path.dirname(rel).replace(/\\/g, '/'));
      }
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir, '');
  return zip.toBuffer();
}

class Pipeline {
  constructor({ projectId, prompt, stack }) {
    this.projectId = projectId;
    this.prompt = prompt;
    this.stack = stack || 'Auto';
    this.context = {
      prompt,
      prd: null,
      architecture: null,
      database: null,
      backend: null,
      frontend: null,
      qa: null,
      docs: null,
      deployment: null,
      files: {},
    };
    this.aborted = false;
  }

  async setProject(status, error = null) {
    await prisma.project.update({
      where: { id: this.projectId },
      data: { status, error },
    });
    await writeLog({
      projectId: this.projectId,
      level: status === 'failed' ? 'error' : status === 'completed' ? 'success' : 'info',
      source: 'system',
      message: status === 'failed' ? `Build failed: ${error || 'unknown error'}` : `Build ${status}`,
    });
  }

  async updateAgent(agentRunId, data) {
    await prisma.agentRun.update({ where: { id: agentRunId }, data });
  }

  async runAgentStep(agent) {
    let agentRun = await prisma.agentRun.findFirst({
      where: { projectId: this.projectId, role: agent.role },
    });

    if (agentRun) {
      agentRun = await prisma.agentRun.update({
        where: { id: agentRun.id },
        data: {
          status: 'running',
          progress: 10,
          error: null,
          startedAt: new Date(),
          completedAt: null,
        },
      });
    } else {
      agentRun = await prisma.agentRun.create({
        data: {
          projectId: this.projectId,
          role: agent.role,
          displayName: agent.displayName,
          status: 'running',
          progress: 10,
          startedAt: new Date(),
        },
      });
    }

    await writeLog({
      projectId: this.projectId,
      agentRunId: agentRun.id,
      level: 'info',
      source: agent.role,
      message: `[${agent.displayName}] started`,
    });

    let lastProgressUpdate = 0;
    let lastOutputUpdate = 0;
    let progressSinceLastDbWrite = 0;
    let lastRateLimitNoteAt = 0;

    const callbacks = {
      onProgress: async (text) => {
        progressSinceLastDbWrite += text.length;
        const now = Date.now();
        if (now - lastProgressUpdate > PROGRESS_THROTTLE_MS) {
          const progress = Math.min(95, 15 + Math.floor(progressSinceLastDbWrite / 120));
          lastProgressUpdate = now;
          await this.updateAgent(agentRun.id, { progress }).catch(() => {});
        }
        if (now - lastOutputUpdate > OUTPUT_THROTTLE_MS) {
          lastOutputUpdate = now;
          const snippet = text.slice(-1200);
          await this.updateAgent(agentRun.id, { output: snippet }).catch(() => {});
          await writeLog({
            projectId: this.projectId,
            agentRunId: agentRun.id,
            level: 'info',
            source: agent.role,
            message: snippet.slice(-400),
          });
        }
      },
      onOutput: async (text) => {
        await this.updateAgent(agentRun.id, { output: text, progress: 95 }).catch(() => {});
      },
      // The global LLM scheduler surfaces queue / rate-limit state here. The
      // agent stays "queued" (Waiting for OpenRouter) instead of failing while
      // OpenRouter throttles us, and the project is never marked failed.
      onSchedulerStatus: (status) => {
        if (!status) return;
        if (status.type === 'queued') {
          this.updateAgent(agentRun.id, { status: 'queued' }).catch(() => {});
        } else if (status.type === 'rate_limited') {
          this.updateAgent(agentRun.id, { status: 'queued' }).catch(() => {});
          const now = Date.now();
          if (now - lastRateLimitNoteAt > 5000) {
            lastRateLimitNoteAt = now;
            const note = `Waiting for OpenRouter — retrying in ${status.retryInSec}s (attempt ${status.attempt})`;
            this.updateAgent(agentRun.id, { output: note }).catch(() => {});
            writeLog({
              projectId: this.projectId,
              agentRunId: agentRun.id,
              level: 'warn',
              source: agent.role,
              message: `[${agent.displayName}] OpenRouter rate limited — ${note}.`,
            }).catch(() => {});
          }
        } else if (status.type === 'running') {
          this.updateAgent(agentRun.id, { status: 'running' }).catch(() => {});
        }
      },
      requestId: agentRun.id,
    };

    try {
      await agent.run(this.context, callbacks);

      // Persist any generated files immediately - ensure JSON files are valid JSON
      const fileList = Object.entries(this.context.files).map(([p, content]) => {
        const fileObj = { path: p, content };
        
        // Verify JSON files are valid before writing
        if (p.endsWith('.json')) {
          try {
            const parsed = JSON.parse(content);
            fileObj.content = JSON.stringify(parsed, null, 2);
            console.log(`[Pipeline] Validated JSON file: ${p}`);
          } catch (jsonErr) {
            console.error(`[Pipeline] Invalid JSON in file ${p}: ${jsonErr.message}`);
            console.error(`[Pipeline] Content: ${content.substring(0, 500)}...`);
            throw new Error(`Invalid JSON in file ${p}: ${jsonErr.message}`);
          }
        }
        
        return fileObj;
      });
      
      if (fileList.length > 0) {
        await writeFileTree(this.projectId, fileList);
        await syncFilesToDb(this.projectId, this.context.files);
      }

      // If PRD title updated, update project title
      if (this.context.prd?.title) {
        await prisma.project.update({
          where: { id: this.projectId },
          data: { title: this.context.prd.title.slice(0, 80) },
        }).catch(() => {});
      }

      await this.updateAgent(agentRun.id, {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
      });

      await writeLog({
        projectId: this.projectId,
        agentRunId: agentRun.id,
        level: 'success',
        source: agent.role,
        message: `[${agent.displayName}] completed successfully`,
      });

      return true;
    } catch (err) {
      const errMsg = err.message || 'Execution error';
      // Temporary OpenRouter rate limits must never surface as a failed agent.
      // The scheduler retries them automatically; the step-level retry loop in
      // `_runAgentStepGuarded` picks it up if one still escapes (finite
      // OPENROUTER_MAX_RETRIES). Keep the agent "queued"/waiting, not "failed".
      const rateLimited = isRateLimitError(err);
      await this.updateAgent(agentRun.id, {
        status: rateLimited ? 'queued' : 'failed',
        error: rateLimited ? null : errMsg,
        completedAt: rateLimited ? null : new Date(),
      }).catch(() => {});

      await writeLog({
        projectId: this.projectId,
        agentRunId: agentRun.id,
        level: rateLimited ? 'warn' : 'error',
        source: agent.role,
        message: rateLimited
          ? `[${agent.displayName}] waiting for OpenRouter rate limit to clear — retrying automatically`
          : `[${agent.displayName}] failed: ${errMsg}`,
      });

      throw err;
    }
  }

  /**
   * Run a single agent step, retrying automatically when the failure is only a
   * temporary OpenRouter rate limit. This is a defensive backstop: the global
   * scheduler already retries 429s internally, but this guarantees a project or
   * agent is never marked failed because of a rate limit even when the operator
   * bounds OPENROUTER_MAX_RETRIES.
   */
  async _runAgentStepGuarded(agent) {
    const MAX_RATE_RETRIES = 50;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.runAgentStep(agent);
      } catch (err) {
        if (!isRateLimitError(err)) throw err;
        if (attempt > MAX_RATE_RETRIES) throw err;
        const delay = Math.min(3000 * Math.pow(2, attempt - 1), 60000);
        console.warn(
          `[Pipeline] Rate limit during "${agent.displayName}" step — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt})`
        );
        await sleep(delay);
      }
    }
  }

  async run() {
    try {
      await this.setProject('running');
      const agents = createAgents();

      for (let i = 0; i < agents.length; i++) {
        if (this.aborted) break;
        const agent = agents[i];
        try {
          await this._runAgentStepGuarded(agent);
        } catch (err) {
          await this.setProject('failed', `Agent "${agent.displayName}" failed: ${err.message}`);
          return;
        }
      }

      // Generation finished. The project is NOT "completed" yet — it must pass
      // the verification pipeline (static, API contract, build, health, E2E)
      // before the controller may mark it Completed. This status tells the UI
      // that the agents are done and automated verification is running.
      if (this.aborted) {
        await this.setProject('failed', 'Build aborted by user');
        return;
      }
      await this.setProject('validating');
    } catch (err) {
      await this.setProject('failed', err.message).catch(() => {});
    }
  }

  async runSingleAgent(role) {
    const agents = createAgents();
    const agent = agents.find((a) => a.role === role);
    if (!agent) throw new Error(`Unknown agent role: ${role}`);
    return this.runAndFinalize([agent], {
      summary: `Snapshot from single-agent run (${agent.role})`,
      errorPrefix: `Agent "${agent.displayName}" retry failed`,
    });
  }

  /**
   * Run one or more agents, then hand the project to the shared verification
   * pipeline. Only a passing validation marks the project "Completed".
   * Returns the finalize result ({ ok, validation }) or { ok: false, error }.
   * With `finalize: false` the verification is skipped (the caller runs it);
   * with `skipStatus: true` the project status is left untouched (useful when
   * an autonomous recovery loop controls the status itself).
   */
  async runAndFinalize(agentList, { summary, errorPrefix = 'Repair failed', finalize = true, skipStatus = false } = {}) {
    if (!skipStatus) await this.setProject('running');
    try {
      for (const agent of agentList) {
        if (this.aborted) throw new Error('Repair aborted by user');
        await this._runAgentStepGuarded(agent);
      }

      if (!skipStatus) await this.setProject('validating');
      if (!finalize) return { ok: true, skippedFinalize: true };

      // The project is NOT "completed" yet — it must pass the same verification
      // pipeline as a full build (static, API contract, build, health, E2E)
      // before it may be marked Completed.
      return await finalizeGeneratedProject({
        projectId: this.projectId,
        prompt: this.prompt,
        summary,
        title: this.context.prd && this.context.prd.title,
        files: this.context.files,
      });
    } catch (err) {
      if (!skipStatus) await this.setProject('failed', `${errorPrefix}: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Regenerate only the failing components. `roles` are the agent roles to
   * re-run (e.g. backend-engineer); `repair` carries the diagnostics + area so
   * the agents fix only their own component.
   */
  async runRepairAgents(roles, { summary, repair, finalize = true, skipStatus = false } = {}) {
    const agents = createAgents();
    const targets = roles.map((r) => agents.find((a) => a.role === r));
    if (targets.some((a) => !a)) throw new Error(`Unknown agent role for repair: ${roles.join(', ')}`);
    if (repair) this.context.repair = repair;
    return this.runAndFinalize(targets, { summary, errorPrefix: 'AI repair failed', finalize, skipStatus });
  }

  abort() {
    this.aborted = true;
    writeLog({
      projectId: this.projectId,
      level: 'warn',
      source: 'system',
      message: 'Build aborted by user',
    }).catch(() => {});
  }
}

async function persistGeneratedFiles(projectId, files) {
  await prisma.$transaction(
    files.map((f) =>
      prisma.projectFile.upsert({
        where: { projectId_path: { projectId, path: f.path } },
        update: { content: f.content, language: languageOf(f.path) },
        create: { projectId, path: f.path, content: f.content, language: languageOf(f.path) },
      })
    )
  );
}

async function validateJsonFiles(projectId, files) {
  for (const f of files) {
    if (f.path.endsWith('.json')) {
      try {
        JSON.parse(f.content);
        console.log(`[Pipeline] Validated JSON file: ${f.path}`);
      } catch (jsonErr) {
        console.error(`[Pipeline] Invalid JSON in file ${f.path}: ${jsonErr.message}`);
        console.error(`[Pipeline] Content: ${f.content.substring(0, 500)}...`);
        throw new Error(`Invalid JSON in file ${f.path}: ${jsonErr.message}`);
      }
    }
  }
}

async function createZipBuffer(projectId) {
  return createZip(projectId);
}

module.exports = { Pipeline, persistGeneratedFiles, createZipBuffer, languageOf, sleep };
