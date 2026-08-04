const fsp = require('fs/promises');
const path = require('path');
const prisma = require('../../lib/prisma');
const config = require('../../config');
const logger = require('../../utils/logger');
const { writeLog } = require('../buildLogService');
const { languageOf } = require('../../utils/fileUtils');
const previewService = require('../previewService');
const BuildRunner = require('./BuildRunner');
const DependencyInstaller = require('./DependencyInstaller');
const ProjectRepairService = require('./ProjectRepairService');
const ValidationReporter = require('./ValidationReporter');

/**
 * BuildValidator — orchestrator of the Build Validation Pipeline.
 *
 * Runs automatically after project generation and before any ZIP export or
 * Live Preview. For each project it:
 *   1. syncs generated files to disk
 *   2. ensures the required file structure (regenerating anything missing)
 *   3. installs dependencies
 *   4. builds the frontend (npm run build)
 *   5. starts the backend (npm start) and verifies it boots
 *   6. on failure, self-heals (deterministic templates + AI) and retries
 * until the project passes, up to VALIDATION_MAX_RETRIES times.
 */

const CLIENT_DIRS = ['client', 'web', 'frontend', 'front'];
const SERVER_DIRS = ['server', 'api', 'backend'];
const SERVER_ENTRIES = ['server.js', 'index.js', 'app.js', 'main.js'];

const reporter = new ValidationReporter();
const inFlight = new Map();

// ---------------------------------------------------------------------------
// Layout detection
// ---------------------------------------------------------------------------

function hasSubdirFiles(files, dir) {
  const prefix = `${dir}/`;
  return Object.keys(files).some((p) => p.startsWith(prefix) && p.length > prefix.length);
}

function detectLayout(files) {
  const clientDir = CLIENT_DIRS.find((d) => hasSubdirFiles(files, d)) || null;
  const serverDir = SERVER_DIRS.find((d) => hasSubdirFiles(files, d)) || null;

  const fileMap = new Map(Object.entries(files));
  const rootPkg = DependencyInstaller.parsePackageJson(fileMap, 'package.json');

  let clientAtRoot = false;
  let serverAtRoot = false;
  if (rootPkg) {
    const deps = { ...(rootPkg.dependencies || {}), ...(rootPkg.devDependencies || {}) };
    if (deps.react || deps.vue || deps.svelte || deps.vite) clientAtRoot = true;
    if (deps.express || deps.fastify || deps.koa) serverAtRoot = true;
  }
  if (!clientAtRoot && (files['vite.config.js'] || files['src/main.jsx'] || files['index.html'])) clientAtRoot = true;
  if (!serverAtRoot && (files['server.js'] || files['index.js'])) serverAtRoot = true;

  const hasClient = Boolean(clientDir || clientAtRoot);
  const hasServer = Boolean(serverDir || serverAtRoot);

  return {
    clientDir: clientDir !== null ? clientDir : clientAtRoot ? '' : null,
    serverDir: serverDir !== null ? serverDir : serverAtRoot ? '' : null,
    hasClient,
    hasServer,
  };
}

function resolveServerEntry(files, serverDir) {
  const prefix = serverDir ? `${serverDir}/` : '';
  const fileMap = new Map(Object.entries(files));
  const pkg = DependencyInstaller.parsePackageJson(fileMap, `${prefix}package.json`);
  if (pkg && pkg.scripts && typeof pkg.scripts.start === 'string') {
    const m = pkg.scripts.start.match(/node\s+([^\s&|;]+)/);
    if (m) {
      const rel = m[1].replace(/^\.\//, '');
      const candidate = rel.startsWith(prefix) ? rel : `${prefix}${rel}`;
      if (files[candidate]) return rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    }
  }
  for (const e of SERVER_ENTRIES) {
    if (files[`${prefix}${e}`]) return e;
  }
  return 'server.js';
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

async function loadFiles(projectId) {
  const rows = await prisma.projectFile.findMany({ where: { projectId }, select: { path: true, content: true } });
  const files = {};
  for (const r of rows) files[r.path] = r.content;
  return files;
}

async function writeFilesToDisk(projectId, files) {
  const root = previewService.safeProjectDir(projectId);
  for (const [p, content] of Object.entries(files)) {
    const absolute = path.resolve(path.join(root, p));
    if (absolute !== root && !absolute.startsWith(root + path.sep)) continue;
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, content, 'utf8');
  }
}

async function syncDiskToDb(projectId, files) {
  for (const [p, content] of Object.entries(files)) {
    await prisma.projectFile
      .upsert({
        where: { projectId_path: { projectId, path: p } },
        update: { content, language: languageOf(p) },
        create: { projectId, path: p, content, language: languageOf(p) },
      })
      .catch((err) => logger.warn(`[BuildValidator] db sync ${p} failed: ${err.message}`));
  }
}

// ---------------------------------------------------------------------------
// Validation loop
// ---------------------------------------------------------------------------

function makeStep(name, status, message, detail, durationMs, dir = null) {
  return { name, status, message, detail, durationMs, dir };
}

async function validateOnce(projectId, attempt, steps) {
  const files = await loadFiles(projectId);
  const layout = detectLayout(files);
  const results = [];

  // 1. Structure — regenerate missing files deterministically.
  const t0 = Date.now();
  const changed = ProjectRepairService.repairAll(files, layout);
  if (changed.length) {
    await writeFilesToDisk(projectId, files);
    await syncDiskToDb(projectId, files);
  }
  steps.push(
    makeStep(
      'structure',
      'passed',
      changed.length ? `Regenerated missing files: ${changed.length} file(s).` : 'All required files present.',
      changed.length ? changed.join('\n') : null,
      Date.now() - t0
    )
  );

  // 2. Install dependencies for every package directory.
  const dirs = [];
  if (layout.clientDir !== null) dirs.push({ dir: layout.clientDir, label: 'client' });
  if (layout.serverDir !== null) dirs.push({ dir: layout.serverDir, label: 'server' });

  if (dirs.length === 0) {
    steps.push(makeStep('install', 'passed', 'No Node.js package directories found.', null, 0));
  } else {
    const root = previewService.safeProjectDir(projectId);
    for (const d of dirs) {
      const res = await DependencyInstaller.install(path.join(root, d.dir));
      const ok = res.ok;
      results.push(ok);
      steps.push(
        makeStep(
          'install',
          ok ? 'passed' : 'failed',
          ok ? `Dependencies installed for ${d.dir}.` : `npm install failed for ${d.dir}.`,
          ok ? null : res.output.slice(-80).join('\n'),
          res.durationMs,
          d.dir
        )
      );
    }
  }

  // 3. Build the frontend.
  if (layout.clientDir !== null) {
    const clientPath = path.join(previewService.safeProjectDir(projectId), layout.clientDir);
    const res = await BuildRunner.runCommand({
      args: ['run', 'build'],
      cwd: clientPath,
      timeoutMs: config.validationCommandTimeoutMs,
    });
    const ok = res.ok;
    results.push(ok);
    steps.push(
      makeStep(
        'build',
        ok ? 'passed' : 'failed',
        ok ? 'Frontend build succeeded.' : `Frontend build failed (exit ${res.exitCode}).`,
        ok ? null : res.output.slice(-80).join('\n'),
        res.durationMs,
        layout.clientDir
      )
    );
  }

  // 4. Start the backend and verify it boots.
  if (layout.serverDir !== null) {
    const serverPath = path.join(previewService.safeProjectDir(projectId), layout.serverDir);
    const entry = resolveServerEntry(files, layout.serverDir);
    const res = await BuildRunner.runServer({ entry, cwd: serverPath, timeoutMs: config.validationStartTimeoutMs });
    const ok = res.ok;
    results.push(ok);
    steps.push(
      makeStep(
        'start',
        ok ? 'passed' : 'failed',
        ok ? 'Backend started successfully.' : `Backend failed to start${res.exitCode != null ? ` (exit ${res.exitCode})` : ''}.`,
        ok ? null : res.output.slice(-80).join('\n'),
        res.durationMs,
        layout.serverDir
      )
    );
  }

  return results.length === 0 || results.every(Boolean);
}

async function selfHeal(projectId, files, diagnostics) {
  const layout = detectLayout(files);
  const deterministic = ProjectRepairService.repairAll(files, layout);
  const ai = await ProjectRepairService.aiRepair(files, diagnostics);

  const applied = new Set(deterministic);
  for (const f of ai) {
    if (f && f.path && typeof f.content === 'string') {
      files[f.path] = f.content;
      applied.add(f.path);
    }
  }

  if (applied.size) {
    await writeFilesToDisk(projectId, files);
    await syncDiskToDb(projectId, files);
  }
  logger.info(`[BuildValidator] self-heal applied ${applied.size} file(s) for ${projectId}.`);
  return applied.size;
}

/**
 * Full validation pipeline. Guarded so the same project is never validated
 * twice concurrently.
 */
async function runValidation(projectId) {
  const started = Date.now();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, validated: true, validationStatus: true },
  });
  if (!project) return { ok: false, error: 'Project not found', report: null };

  await writeLog({ projectId, level: 'info', source: 'validator', message: 'Build validation started.' });

  try {
    await previewService.syncProjectToDisk(projectId);
  } catch (err) {
    logger.error(`[BuildValidator] disk sync failed: ${err.message}`);
  }

  const maxAttempts = Math.max(1, config.validationMaxRetries || 3);
  const allSteps = [];
  let ok = false;
  let lastError = 'Validation failed';
  let lastAttempt = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastAttempt = attempt;
    const attemptSteps = [];
    const passed = await validateOnce(projectId, attempt, attemptSteps);
    allSteps.push(...attemptSteps);

    if (passed) {
      ok = true;
      break;
    }

    const failed = attemptSteps.find((s) => s.status === 'failed');
    lastError = failed?.message || `Validation failed on attempt ${attempt}.`;

    if (attempt < maxAttempts) {
      await writeLog({
        projectId,
        level: 'warn',
        source: 'validator',
        message: `Validation attempt ${attempt} failed: ${lastError} — self-healing and retrying.`,
      });
      const files = await loadFiles(projectId);
      await selfHeal(projectId, files, {
        step: failed?.name || 'unknown',
        dir: failed?.dir || null,
        error: lastError,
        logs: attemptSteps.flatMap((s) => (s.detail ? String(s.detail).split('\n') : [])),
        unresolved: ProjectRepairService.findUnresolvedImports(files),
      });
    }
  }

  await reporter.updateProjectState({ projectId, ok, attempt: lastAttempt, error: ok ? null : lastError });
  await reporter.persistRun({ projectId, attempt: lastAttempt, ok, steps: allSteps, error: ok ? null : lastError });

  const report = reporter.buildReport({
    ok,
    attempts: lastAttempt,
    steps: allSteps,
    logs: allSteps.flatMap((s) => (s.detail ? String(s.detail).split('\n') : [])),
    project: { validated: ok, validationStatus: ok ? 'passed' : 'failed', validationError: ok ? null : lastError },
  });

  await writeLog({
    projectId,
    level: ok ? 'success' : 'error',
    source: 'validator',
    message: ok ? 'Validation passed — project is ready to export.' : `Validation failed after ${lastAttempt} attempt(s): ${lastError.slice(0, 400)}`,
  });

  return { ok, report, attempts: lastAttempt, durationMs: Date.now() - started };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a project. Reuses any in-flight validation for the same project and
 * short-circuits when the project already passed (unless `force` is set).
 */
async function validateProject(projectId, { force = false } = {}) {
  if (!config.validationEnabled) {
    return { ok: true, skipped: true, report: { ok: true, skipped: true, issues: [], logs: [], attempts: 0 } };
  }

  if (!force) {
    const cached = await prisma.project
      .findUnique({ where: { id: projectId }, select: { validated: true, validationStatus: true, validationAttempts: true } })
      .catch(() => null);
    if (cached && cached.validated) {
      return { ok: true, cached: true, report: { ok: true, cached: true, issues: [], logs: [], attempts: cached.validationAttempts || 0 } };
    }
  }

  if (inFlight.has(projectId)) return inFlight.get(projectId);

  const promise = runValidation(projectId);
  inFlight.set(projectId, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(projectId);
  }
}

/**
 * Export protection gate. Throws a structured error (or returns ok:false) when
 * the project has not passed validation and unvalidated downloads are blocked.
 */
async function ensureValidated(projectId) {
  const result = await validateProject(projectId);
  if (result.ok) return result;
  if (config.validationAllowUnvalidatedDownload) {
    return { ...result, allowedUnvalidated: true };
  }
  return result;
}

function invalidateValidation(projectId) {
  return reporter.invalidate(projectId);
}

/** Latest persisted validation run + steps for a project. */
async function getValidationReport(projectId) {
  const project = await prisma.project
    .findUnique({
      where: { id: projectId },
      select: { validated: true, validationStatus: true, validationAttempts: true, validationError: true },
    })
    .catch(() => null);
  const latestRun = await prisma.validationRun
    .findFirst({ where: { projectId }, orderBy: { attempt: 'desc' }, include: { steps: { orderBy: { createdAt: 'asc' } } } })
    .catch(() => null);
  return { project, latestRun };
}

function isValidationRunning(projectId) {
  return inFlight.has(projectId);
}

module.exports = {
  validateProject,
  ensureValidated,
  invalidateValidation,
  getValidationReport,
  isValidationRunning,
  detectLayout,
  resolveServerEntry,
};