const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { Pipeline } = require('./pipelineService');
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
 * Kick off an AI repair. The full verification pipeline runs automatically
 * afterwards; the repair is only marked successful when validation passes.
 */
async function startRepair(projectId, area) {
  if (!AREA_ROLES[area]) throw new HttpError(400, `Unknown repair area: ${area}`);
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new HttpError(404, 'Project not found');
  if (inFlight.has(projectId)) throw new HttpError(409, 'An AI repair is already running for this project');
  if (buildValidator.isValidationRunning(projectId)) {
    throw new HttpError(409, 'A validation run is already in progress');
  }

  const run = await prisma.repairRun.create({
    data: { projectId: project.id, area, model: getModel() || '', status: 'running' },
  });

  inFlight.add(projectId);
  runRepairAsync(project.id, area, run.id)
    .catch((err) => console.error('[Repair]', err))
    .finally(() => inFlight.delete(projectId));

  return { ok: true, repairId: run.id, area };
}

async function runRepairAsync(projectId, area, runId) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  const before = await snapshotFiles(projectId);
  await previewService.syncProjectToDisk(projectId).catch(() => {});

  const diagnostics = await gatherDiagnostics(projectId);

  const pipeline = new Pipeline({ projectId: project.id, prompt: project.description, stack: project.stack });
  seedContext(pipeline, project, before);

  const roles = AREA_ROLES[area];
  const result = await pipeline.runRepairAgents(roles, {
    summary: `AI repair: ${AREA_LABELS[area]}`,
    repair: { area, diagnostics },
  });

  const after = await snapshotFiles(projectId);
  const filesModified = diffPaths(before, after);

  await prisma.repairRun.update({
    where: { id: runId },
    data: {
      status: result.ok ? 'passed' : 'failed',
      filesModified,
      validationResult: result.validation
        ? {
            ok: Boolean(result.validation.ok),
            attempts: result.validation.attempts || 0,
            issues: (result.validation.report && result.validation.report.issues) || [],
          }
        : null,
      error: result.error || null,
    },
  });

  return result;
}

async function listRepairs(projectId) {
  const runs = await prisma.repairRun.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return runs.map(serializeRepair);
}

function isRepairRunning(projectId) {
  return inFlight.has(projectId);
}

module.exports = { startRepair, listRepairs, isRepairRunning, AREA_LABELS };
