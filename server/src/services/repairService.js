const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { getLogs } = require('./buildLogService');
const { getModel } = require('./openrouterService');
const previewService = require('./previewService');
const buildValidator = require('./validation/BuildValidator');
const apiContractValidator = require('./validation/apiContractValidator');

const AREA_ROLES = {
  backend: ['backend-engineer'],
  frontend: ['frontend-engineer'],
  database: ['database-engineer'],
  docs: ['documentation-engineer'],
  deployment: ['deployment-engineer'],
  all: ['database-engineer', 'backend-engineer', 'frontend-engineer', 'deployment-engineer', 'documentation-engineer'],
};

const AREA_LABELS = {
  backend: 'Backend',
  frontend: 'Frontend',
  database: 'Database',
  docs: 'Documentation',
  deployment: 'Deployment files',
  all: 'Entire project',
};

const inFlight = new Set();

function serializeRepair(r) {
  return {
    id: r.id,
    area: r.area,
    model: r.model,
    status: r.status,
    filesModified: Array.isArray(r.filesModified) ? r.filesModified : [],
    validationResult: r.validationResult || null,
    error: r.error || null,
    createdAt: r.createdAt,
  };
}

async function snapshotFiles(projectId) {
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, content: true },
  });
  return files.map((f) => ({ path: f.path, content: f.content }));
}

function filesToMap(files) {
  const map = {};
  for (const f of files) map[f.path] = f.content;
  return map;
}

function pickByPrefix(map, prefixes) {
  return Object.entries(map)
    .filter(([p]) => prefixes.some((pf) => p === pf || p.startsWith(pf)))
    .map(([path, content]) => ({ path, content }));
}

function diffPaths(before, after) {
  const a = new Map(before.map((f) => [f.path, f.content]));
  const b = new Map(after.map((f) => [f.path, f.content]));
  const changed = [];
  const allPaths = new Set([...a.keys(), ...b.keys()]);
  for (const p of allPaths) {
    if (a.get(p) !== b.get(p)) changed.push(p);
  }
  return changed.sort();
}

/**
 * Read everything the repair agent needs to understand what is broken:
 * build logs, validation results, structured API contract failures, runtime
 * errors, preview failures and E2E failures.
 */
async function gatherDiagnostics(projectId) {
  const [buildLogs, validation] = await Promise.all([
    getLogs({ projectId, limit: 500 }).catch(() => []),
    buildValidator.getValidationReport(projectId).catch(() => null),
  ]);

  const preview = previewService.getStatus(projectId) || { state: 'idle' };

  let apiContract = [];
  let runtime = [];
  let e2e = [];
  const files = await snapshotFiles(projectId);
  if (files.length) {
    const layout = buildValidator.detectLayout(filesToMap(files));
    try {
      const res = apiContractValidator.validate(filesToMap(files), layout);
      apiContract = res.missing || [];
    } catch {
      apiContract = [];
    }
  }

  if (validation && validation.latestRun) {
    for (const s of validation.latestRun.steps || []) {
      if (s.status !== 'failed') continue;
      if (s.name === 'start' || s.name === 'install' || s.name === 'build' || s.name === 'backend-build' || s.name === 'frontend-load') {
        runtime.push(`${s.name}: ${s.message || ''}${s.detail ? `\n${String(s.detail).slice(0, 800)}` : ''}`);
      } else if (s.name === 'e2e' || s.name === 'e2e-ui' || /^e2e-/.test(s.name)) {
        e2e.push(`${s.name}: ${s.message || ''}`);
      }
    }
  }

  return { buildLogs, validation, apiContract, runtime, preview, e2e };
}

function seedContext(pipeline, project, files) {
  const map = filesToMap(files);
  pipeline.context.files = map;
  pipeline.context.prd = {
    title: project.title,
    summary: project.description,
    features: null,
    stack: project.stack,
  };
  pipeline.context.database = { files: pickByPrefix(map, ['server/db/', 'server/prisma/', 'prisma/']), schema: null };
  pipeline.context.backend = { files: pickByPrefix(map, ['server/', 'api/', 'backend/']) };
  pipeline.context.frontend = { files: pickByPrefix(map, ['client/', 'web/', 'frontend/', 'front/']) };
  pipeline.context.repair = null;
}

/**
 * Run the AI repair agents for an area. Regenerates only the failing
 * components — no validation, no status changes (the caller controls those).
 * `quiet` skips status transitions so an autonomous recovery loop can keep the
 * project in the "recovering" state.
 */
async function performRepair(projectId, area, summary, { quiet = false } = {}) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new HttpError(404, 'Project not found');

  const before = await snapshotFiles(projectId);
  await previewService.syncProjectToDisk(projectId).catch(() => {});
  const diagnostics = await gatherDiagnostics(projectId);

  // Lazy require: repairService <-> pipelineService <-> finalizeService form a
  // cycle; deferring the Pipeline import to call time keeps load order acyclic.
  const { Pipeline } = require('./pipelineService');
  const pipeline = new Pipeline({ projectId: project.id, prompt: project.description, stack: project.stack });
  seedContext(pipeline, project, before);

  const roles = AREA_ROLES[area] || AREA_ROLES.all;
  const result = await pipeline.runRepairAgents(roles, {
    summary,
    repair: { area, diagnostics },
    finalize: false,
    skipStatus: quiet,
  });

  const after = await snapshotFiles(projectId);
  return { filesModified: diffPaths(before, after), ok: result.ok, error: result.error || null };
}

/** Persist one AI repair run into the repair history. Never throws. */
async function recordRepairRun({ projectId, area, status, validation, filesModified = [], error = null }) {
  try {
    return await prisma.repairRun.create({
      data: {
        projectId,
        area,
        model: getModel() || '',
        status: status || (validation && validation.ok ? 'passed' : 'failed'),
        filesModified,
        validationResult: validation
          ? {
              ok: Boolean(validation.ok),
              attempts: validation.attempts || 0,
              issues: (validation.report && validation.report.issues) || [],
            }
          : null,
        error: error ? String(error).slice(0, 4000) : null,
      },
    });
  } catch (err) {
    console.error('[Repair] failed to record repair run', err.message);
    return null;
  }
}

/**
 * Guard + bookkeeping for a user-initiated "Repair with AI". The caller runs
 * the shared finalize/recovery pipeline afterwards and must call `endRepair`.
 */
async function startRepair(projectId, area) {
  if (!AREA_ROLES[area]) throw new HttpError(400, `Unknown repair area: ${area}`);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new HttpError(404, 'Project not found');
  if (inFlight.has(projectId)) throw new HttpError(409, 'An AI repair is already running for this project');
  if (buildValidator.isValidationRunning(projectId)) {
    throw new HttpError(409, 'A validation run is already in progress');
  }
  if (['running', 'recovering', 'validating'].includes(project.status)) {
    throw new HttpError(409, 'Project is already building or recovering');
  }
  inFlight.add(projectId);
  return { project };
}

function endRepair(projectId) {
  inFlight.delete(projectId);
}

function isRepairRunning(projectId) {
  return inFlight.has(projectId);
}

async function listRepairs(projectId) {
  const runs = await prisma.repairRun.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return runs.map(serializeRepair);
}

module.exports = {
  performRepair,
  recordRepairRun,
  startRepair,
  endRepair,
  listRepairs,
  isRepairRunning,
  AREA_LABELS,
};
