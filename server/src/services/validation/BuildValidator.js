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
const staticValidator = require('./staticValidator');
const apiContractValidator = require('./apiContractValidator');
const runtimeValidator = require('./runtimeValidator');
const e2eValidator = require('./e2eValidator');

/**
 * BuildValidator — orchestrator of the Build Validation Pipeline.
 *
 * Runs automatically after project generation and before any ZIP export or
 * Live Preview. For each project it runs up to VALIDATION_MAX_RETRIES attempts
 * of the full verification pipeline:
 *   1. structure  — static validation of required files (regenerating missing)
 *   2. api-contract — frontend fetch/axios calls vs backend Express routes
 *   3. install    — npm install for client/server
 *   4. build      — frontend build (+ backend build when a build script exists)
 *   5. runtime    — backend start + GET /api/health == 200 + frontend loads
 *   6. e2e        — register/login/create/update/delete/logout (Playwright + API)
 * On failure it self-heals (deterministic templates + AI repair) and retries.
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

/**
 * Run one full validation attempt against a project. Stages:
 *   1. structure  — deterministic repair + static validation (fails on missing files)
 *   2. api-contract — frontend calls vs backend routes (fails on missing endpoints)
 *   3. install    — npm install for client/server
 *   4. build      — frontend build (+ backend build when a build script exists)
 *   5. runtime    — backend start + GET /api/health == 200 + frontend loads
 *   6. e2e        — Playwright / API-level register, login, CRUD, logout
 *
 * @returns {Promise<{passed: boolean, apiContractMissing: any[], e2e: object|null}>}
 */
async function validateOnce(projectId, attempt, steps) {
  const files = await loadFiles(projectId);
  const layout = detectLayout(files);
  const results = [];
  const outcome = { passed: false, apiContractMissing: [], e2e: null };

  // 1. Structure — regenerate missing files, then fail if anything required is still absent.
  let t0 = Date.now();
  const changed = ProjectRepairService.repairAll(files, layout);
  if (changed.length) {
    await writeFilesToDisk(projectId, files);
    await syncDiskToDb(projectId, files);
  }
  const staticResult = config.validationStaticEnabled ? staticValidator.validate(files, layout) : { ok: true, missing: [] };
  steps.push(
    makeStep(
      'structure',
      staticResult.ok ? 'passed' : 'failed',
      staticResult.ok
        ? changed.length
          ? `Regenerated ${changed.length} missing file(s); all required files present.`
          : 'All required files present.'
        : `${staticResult.missing.length} required file(s) missing.`,
      staticResult.ok ? (changed.length ? changed.join('\n') : null) : staticResult.missing.map((m) => `${m.category}: ${m.path} — ${m.hint}`).join('\n'),
      Date.now() - t0
    )
  );
  results.push(staticResult.ok);

  // 2. API Contract — frontend calls must be satisfiable by backend routes.
  t0 = Date.now();
  const contractResult = config.validationApiContractEnabled
    ? apiContractValidator.validate(files, layout)
    : { ok: true, frontendCalls: 0, backendRoutes: 0, missing: [], unused: [] };
  outcome.apiContractMissing = contractResult.missing || [];
  steps.push(
    makeStep(
      'api-contract',
      contractResult.ok ? 'passed' : 'failed',
      contractResult.ok
        ? `API contract passed (${contractResult.frontendCalls} frontend call(s), ${contractResult.backendRoutes} backend route(s)).`
        : `${contractResult.missing.length} endpoint(s) called by the frontend are missing on the backend.`,
      contractResult.ok ? null : contractResult.missing.map((m) => `${m.method} ${m.path} (from ${m.file})`).join('\n'),
      Date.now() - t0
    )
  );
  results.push(contractResult.ok);

  // 3. Install dependencies.
  const installSteps = await runtimeValidator.installAll(projectId, layout);
  steps.push(...installSteps);
  installSteps.forEach((s) => results.push(s.status === 'passed'));

  // 4. Build frontend + backend.
  const frontendBuild = await runtimeValidator.buildFrontend(projectId, layout);
  if (frontendBuild) {
    steps.push(frontendBuild);
    results.push(frontendBuild.ok);
  }
  const backendBuild = await runtimeValidator.buildBackend(projectId, layout);
  if (backendBuild) {
    steps.push(backendBuild);
    results.push(backendBuild.ok);
  }

  // 5. Runtime — start the backend (kept alive for E2E), require /api/health == 200,
  //    then serve the built frontend and require it to load.
  let backend = null;
  let frontendServer = null;
  const startRes = await runtimeValidator.startBackendLive(projectId, layout);
  steps.push(startRes.step);
  results.push(startRes.ok);
  backend = startRes.backend;

  const frontendRes = await runtimeValidator.verifyFrontendLoads(projectId, layout);
  steps.push(frontendRes.step);
  results.push(frontendRes.ok);
  frontendServer = frontendRes.server;

  // 6. End-to-end tests (register/login/create/update/delete/logout).
  let e2eRes = null;
  if (config.validationE2eEnabled) {
    e2eRes = await e2eValidator.runE2E({ projectId, files, layout, backend });
    outcome.e2e = e2eRes;
    steps.push(...e2eRes.steps);
    results.push(e2eRes.ok);
  } else {
    steps.push(makeStep('e2e', 'skipped', 'E2E testing disabled — skipped.', null, 0));
  }

  // Always clean up the live backend + static frontend server.
  if (backend && backend.child) BuildRunner.killProcessTree(backend.child);
  if (frontendServer) await frontendServer.close().catch(() => {});

  outcome.passed = results.length === 0 || results.every(Boolean);
  return outcome;
}

async function selfHeal(projectId, files, diagnostics) {
  const layout = detectLayout(files);
  const applied = new Set(ProjectRepairService.repairAll(files, layout));

  // Deterministic API-contract repair: regenerate missing routes/controllers.
  if (config.validationApiContractEnabled && Array.isArray(diagnostics.apiContract) && diagnostics.apiContract.length) {
    const apiChanged = apiContractValidator.repair(files, layout, diagnostics.apiContract);
    apiChanged.forEach((f) => applied.add(f));
  }

  const ai = await ProjectRepairService.aiRepair(files, diagnostics);
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
    const outcome = await validateOnce(projectId, attempt, attemptSteps);
    allSteps.push(...attemptSteps);

    if (outcome.passed) {
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
      const e2eDetails = outcome.e2e
        ? outcome.e2e.steps.filter((s) => s.status === 'failed').map((s) => `${s.name}: ${s.message}`)
        : [];
      await selfHeal(projectId, files, {
        step: failed?.name || 'unknown',
        dir: failed?.dir || null,
        error: lastError,
        logs: attemptSteps.flatMap((s) => (s.detail ? String(s.detail).split('\n') : [])),
        unresolved: ProjectRepairService.findUnresolvedImports(files),
        apiContract: outcome.apiContractMissing || [],
        e2e: e2eDetails,
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