const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const prisma = require('../lib/prisma');
const { createAgents } = require('../agents');
const { generatedDir } = require('../config');
const { sleep } = require('../agents/baseAgent');
const { writeLog } = require('./buildLogService');
const { languageOf } = require('../utils/fileUtils');

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
      await this.updateAgent(agentRun.id, {
        status: 'failed',
        error: errMsg,
        completedAt: new Date(),
      }).catch(() => {});

      await writeLog({
        projectId: this.projectId,
        agentRunId: agentRun.id,
        level: 'error',
        source: agent.role,
        message: `[${agent.displayName}] failed: ${errMsg}`,
      });

      throw err;
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
          await this.runAgentStep(agent);
        } catch (err) {
          await this.setProject('failed', `Agent "${agent.displayName}" failed: ${err.message}`);
          return;
        }
      }

      await this.setProject('completed');
    } catch (err) {
      await this.setProject('failed', err.message).catch(() => {});
    }
  }

  async runSingleAgent(role) {
    const agents = createAgents();
    const agent = agents.find((a) => a.role === role);
    if (!agent) throw new Error(`Unknown agent role: ${role}`);

    await this.setProject('running');
    try {
      await this.runAgentStep(agent);
      await this.setProject('completed');
    } catch (err) {
      await this.setProject('failed', `Agent "${agent.displayName}" retry failed: ${err.message}`);
    }
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
