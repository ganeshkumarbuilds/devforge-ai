const fsp = require('fs/promises');
const path = require('path');
const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { Pipeline, persistGeneratedFiles, createZipBuffer, languageOf } = require('../services/pipelineService');
const { generatedDir } = require('../config');
const { isConfigured, getModel } = require('../services/openrouterService');
const { getLogs: fetchLogs } = require('../services/buildLogService');
const { buildLogsMarkdown, projectMarkdown, buildPdf } = require('../services/exportService');
const { createVersion } = require('../services/versionService');
const { requireOwnedProject } = require('../utils/projectAccess');
const { slugify } = require('../utils/fileUtils');
const previewService = require('../services/previewService');
const buildValidator = require('../services/validation/BuildValidator');

const activePipelines = new Map();

async function maybeStartPreview(projectId) {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!project || project.status !== 'completed') return;
  const count = await prisma.projectFile.count({ where: { projectId } });
  if (count === 0) return;
  // Build Validation Pipeline must pass before a preview is allowed to start.
  const result = await buildValidator.validateProject(projectId);
  if (!result.ok) {
    console.warn(`[Preview] validation failed for ${projectId} — preview not started.`);
    return;
  }
  previewService.start(projectId, { install: false }).catch((err) => console.error('[Preview] auto-start failed', err.message));
}

function projectSummary(p) {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    stack: p.stack,
    status: p.status,
    error: p.error,
    validated: p.validated,
    validationStatus: p.validationStatus,
    validationAttempts: p.validationAttempts,
    validationError: p.validationError,
    fileCount: p._count ? p._count.files : undefined,
    agentCount: p._count ? p._count.agents : undefined,
    favorite: Boolean(p.favorite),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function toFileTree(files) {
  const root = {};
  const insert = (parts, file) => {
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!node[part]) {
        node[part] = { type: 'folder', name: part, children: {} };
      }
      node = node[part].children;
    }
    const name = parts[parts.length - 1];
    node[name] = { type: 'file', name, path: file.path, content: file.content };
  };
  for (const file of files) {
    insert(file.path.split('/'), file);
  }
  const toArray = (node) =>
    Object.values(node).map((entry) =>
      entry.type === 'folder'
        ? { ...entry, children: toArray(entry.children) }
        : entry
    );
  return toArray(root);
}

async function generate(req, res) {
  const { prompt, stack } = req.body;
  const ownerId = req.userId;
  const project = await prisma.project.create({
    data: {
      title: 'Generating…',
      description: prompt.trim(),
      stack: stack || 'Auto',
      status: 'running',
      ownerId,
    },
  });

  const pipeline = new Pipeline({ projectId: project.id, prompt: prompt.trim(), stack });
  activePipelines.set(project.id, pipeline);

  (async () => {
    try {
      await pipeline.run();
      if (pipeline.context.prd && pipeline.context.prd.title && project.title === 'Generating…') {
        const title = pipeline.context.prd.title.slice(0, 80);
        await prisma.project.update({
          where: { id: project.id },
          data: { title },
        });
      }
      const files = Object.entries(pipeline.context.files).map(([p, content]) => ({
        path: p,
        content,
      }));
      if (files.length > 0) {
        await prisma.projectFile.createMany({
          data: files.map((f) => ({
            projectId: project.id,
            path: f.path,
            content: f.content,
            language: languageOf(f.path),
          })),
          skipDuplicates: true,
        });
      }
      const logs = await fetchLogs({ projectId: project.id, limit: 2000 });
      await createVersion({
        projectId: project.id,
        prompt: prompt.trim(),
        model: getModel(),
        files,
        logs,
        summary: `Snapshot from generation "${project.title}"`,
      });
      await maybeStartPreview(project.id);
    } catch (err) {
      console.error('[Pipeline]', err);
    } finally {
      activePipelines.delete(project.id);
    }
  })();

  res.status(202).json({
    project: projectSummary(await prisma.project.findUnique({
      where: { id: project.id },
      include: { _count: { select: { files: true, agents: true } } },
    })),
  });
}

async function listProjects(req, res) {
  const { search, status, stack } = req.query;
  const where = { ownerId: req.userId };

  if (search && typeof search === 'string' && search.trim()) {
    const q = search.trim();
    where.OR = [
      { title: { contains: q } },
      { description: { contains: q } },
      { stack: { contains: q } },
    ];
  }
  if (status && ['running', 'completed', 'failed'].includes(status)) {
    where.status = status;
  }
  if (stack && typeof stack === 'string' && stack.trim()) {
    where.stack = stack.trim();
  }

  const [projects, counts] = await Promise.all([
    prisma.project.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { files: true, agents: true } } },
      take: 100,
    }),
    prisma.project.groupBy({
      by: ['status'],
      where: { ownerId: req.userId },
      _count: { _all: true },
    }),
  ]);

  const statusCounts = { running: 0, completed: 0, failed: 0 };
  for (const c of counts) statusCounts[c.status] = c._count._all;

  res.json({
    projects: projects.map(projectSummary),
    counts: statusCounts,
    total: projects.length,
  });
}

function humanizeBytes(bytes) {
  if (!bytes || bytes <= 0) return { value: 0, unit: 'B' };
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u += 1;
  }
  return { value: Math.round(v * 10) / 10, unit: units[u] };
}

async function getStats(req, res) {
  const ownerId = req.userId;

  const [projects, agentRuns, fileRows, favorites] = await Promise.all([
    prisma.project.findMany({
      where: { ownerId },
      select: { id: true, createdAt: true, status: true },
    }),
    prisma.agentRun.findMany({
      where: { project: { ownerId }, status: 'completed', startedAt: { not: null }, completedAt: { not: null } },
      select: { projectId: true, startedAt: true, completedAt: true, output: true },
    }),
    prisma.projectFile.findMany({
      where: { project: { ownerId } },
      select: { content: true },
    }),
    prisma.project.count({ where: { ownerId, favorite: true } }),
  ]);

  const statusCounts = { running: 0, completed: 0, failed: 0 };
  for (const p of projects) {
    if (Object.prototype.hasOwnProperty.call(statusCounts, p.status)) statusCounts[p.status] += 1;
  }
  const finished = statusCounts.completed + statusCounts.failed;
  const successRate = finished > 0 ? Math.round((statusCounts.completed / finished) * 100) : null;

  // Average per-project build time (sum of its agent-run durations).
  const perProject = new Map();
  for (const r of agentRuns) {
    const dur = new Date(r.completedAt) - new Date(r.startedAt);
    if (!(dur > 0)) continue;
    perProject.set(r.projectId, (perProject.get(r.projectId) || 0) + dur);
  }
  const durations = [...perProject.values()];
  const avgBuildTimeMs = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;

  // AI usage estimate from stored agent output (approx tokens as chars/4).
  const aiCharacters = agentRuns.reduce((sum, r) => sum + (r.output ? r.output.length : 0), 0);
  const aiTokens = Math.round(aiCharacters / 4);

  let storageBytes = 0;
  for (const f of fileRows) storageBytes += Buffer.byteLength(f.content || '', 'utf8');

  // Last 14 days of build activity for the history chart.
  const history = [];
  const now = new Date();
  const dayMs = 86400000;
  for (let d = 13; d >= 0; d -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d);
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() - d + 1);
    let completed = 0;
    let failed = 0;
    let total = 0;
    for (const p of projects) {
      const t = new Date(p.createdAt);
      if (t >= day && t < next) {
        total += 1;
        if (p.status === 'completed') completed += 1;
        else if (p.status === 'failed') failed += 1;
      }
    }
    history.push({
      date: day.toISOString().slice(0, 10),
      total,
      completed,
      failed,
    });
  }

  res.json({
    counts: statusCounts,
    totalProjects: projects.length,
    successRate,
    avgBuildTimeMs,
    aiUsage: { tokens: aiTokens, agentRuns: agentRuns.length },
    storage: humanizeBytes(storageBytes),
    storageBytes,
    favorites,
    history,
  });
}

async function toggleFavorite(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);
  const updated = await prisma.project.update({
    where: { id },
    data: { favorite: !project.favorite },
    select: { id: true, favorite: true },
  });
  res.json({ favorite: updated.favorite });
}

async function getProject(req, res) {
  const { id } = req.params;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: req.userId },
    include: {
      agents: { orderBy: { createdAt: 'asc' } },
      files: { orderBy: { path: 'asc' } },
      _count: { select: { downloads: true, logs: true } },
    },
  });
  if (!project) throw new HttpError(404, 'Project not found');

  const active = activePipelines.get(id);

  res.json({
    project: projectSummary(project),
    isBuilding: !!active,
    agents: project.agents.map((a) => ({
      id: a.id,
      role: a.role,
      displayName: a.displayName || a.role,
      status: a.status,
      progress: a.progress,
      output: a.output,
      error: a.error,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      createdAt: a.createdAt,
    })),
    fileTree: toFileTree(project.files),
    files: project.files.map((f) => ({ path: f.path, content: f.content, language: f.language })),
    counts: { downloads: project._count.downloads, logs: project._count.logs },
    preview: previewService.getStatus(id),
    validation: await buildValidator.getValidationReport(id),
    validationRunning: buildValidator.isValidationRunning(id),
  });
}

async function deleteProject(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);

  const pipeline = activePipelines.get(id);
  if (pipeline) pipeline.abort();
  await previewService.stop(id).catch(() => {});

  await prisma.project.delete({ where: { id } });
  await fsp.rm(path.join(generatedDir, id), { recursive: true, force: true }).catch(() => {});

  res.json({ ok: true });
}

async function updateProject(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);

  const { title, description, stack } = req.body || {};
  const data = {};
  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 80) {
      throw new HttpError(400, 'Title must be 1-80 characters');
    }
    data.title = title.trim();
  }
  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > 8000) {
      throw new HttpError(400, 'Description is invalid');
    }
    data.description = description;
  }
  if (stack !== undefined) {
    if (typeof stack !== 'string' || stack.length > 100) {
      throw new HttpError(400, 'Stack is invalid');
    }
    data.stack = stack;
  }

  const updated = await prisma.project.update({ where: { id }, data });
  res.json({ project: projectSummary(updated) });
}

async function rebuildProject(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);
  if (activePipelines.get(id)) {
    throw new HttpError(409, 'Project is already building');
  }

  await prisma.agentRun.deleteMany({ where: { projectId: id } });
  await prisma.projectFile.deleteMany({ where: { projectId: id } });
  await prisma.buildLog.deleteMany({ where: { projectId: id } });
  await prisma.validationRun.deleteMany({ where: { projectId: id } });
  await prisma.project.update({
    where: { id },
    data: { status: 'running', error: null, title: 'Generating…', validated: false, validationStatus: 'none', validationError: null },
  });

  const pipeline = new Pipeline({ projectId: id, prompt: project.description, stack: project.stack });
  activePipelines.set(id, pipeline);

  (async () => {
    try {
      await pipeline.run();
      const files = Object.entries(pipeline.context.files).map(([p, content]) => ({ path: p, content }));
      if (files.length > 0) {
        await prisma.projectFile.createMany({
          data: files.map((f) => ({ projectId: id, path: f.path, content: f.content, language: languageOf(f.path) })),
          skipDuplicates: true,
        });
      }
      const logs = await fetchLogs({ projectId: id, limit: 2000 });
      await createVersion({
        projectId: id,
        prompt: project.description,
        model: getModel(),
        files,
        logs,
        summary: `Snapshot from rebuild`,
      });
      await maybeStartPreview(id);
    } catch (err) {
      console.error('[Rebuild Pipeline]', err);
    } finally {
      activePipelines.delete(id);
    }
  })();

  res.status(202).json({ ok: true, projectId: id });
}

async function downloadZip(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);

  const files = await prisma.projectFile.findMany({ where: { projectId: id }, select: { path: true, content: true } });
  if (!files.length) {
    throw new HttpError(404, 'No generated files yet');
  }

  // Export Protection: never allow exporting a project that has not passed the
  // Build Validation Pipeline (frontend builds + backend starts).
  const validation = await buildValidator.ensureValidated(id);
  if (!validation.ok && !validation.allowedUnvalidated) {
    const err = new HttpError(
      409,
      'This project has not passed build validation yet and cannot be exported. Run validation first, then retry the download.'
    );
    err.details = { kind: 'validation', report: validation.report };
    throw err;
  }

  for (const f of files) {
    const absolute = path.resolve(path.join(generatedDir, id, f.path));
    const root = path.resolve(path.join(generatedDir, id));
    if (!absolute.startsWith(root + path.sep) && absolute !== root) continue;
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, f.content, 'utf8');
  }

  const buffer = await createZipBuffer(id);
  const slug = slugify(project.title);

  await prisma.download.create({ data: { projectId: id, userId: req.userId, kind: 'zip', size: buffer.length } }).catch(() => {});

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${slug}.zip"`,
    'Content-Length': buffer.length,
  });
  res.send(buffer);
}

async function exportLogs(req, res) {
  const { id } = req.params;
  const { format = 'markdown' } = req.query;
  const project = await requireOwnedProject(id, req.userId);

  const md = await buildLogsMarkdown(project);
  const slug = slugify(project.title);

  if (format === 'pdf') {
    const buffer = await buildPdf(`Build Logs — ${project.title}`, md);
    await prisma.download.create({ data: { projectId: id, userId: req.userId, kind: 'pdf-logs', size: buffer.length } }).catch(() => {});
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-logs.pdf"`,
      'Content-Length': buffer.length,
    });
    return res.send(buffer);
  }

  await prisma.download.create({ data: { projectId: id, userId: req.userId, kind: 'markdown-logs', size: Buffer.byteLength(md) } }).catch(() => {});
  res.set({
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${slug}-logs.md"`,
  });
  res.send(md);
}

async function exportDocs(req, res) {
  const { id } = req.params;
  const { format = 'markdown' } = req.query;
  const project = await prisma.project.findFirst({
    where: { id, ownerId: req.userId },
    include: { agents: { orderBy: { createdAt: 'asc' } }, files: { orderBy: { path: 'asc' } } },
  });
  if (!project) throw new HttpError(404, 'Project not found');

  const md = await projectMarkdown(project, project.agents, project.files);
  const slug = slugify(project.title);

  if (format === 'pdf') {
    const buffer = await buildPdf(project.title, md);
    await prisma.download.create({ data: { projectId: id, userId: req.userId, kind: 'pdf-docs', size: buffer.length } }).catch(() => {});
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${slug}-documentation.pdf"`,
      'Content-Length': buffer.length,
    });
    return res.send(buffer);
  }

  await prisma.download.create({ data: { projectId: id, userId: req.userId, kind: 'markdown-docs', size: Buffer.byteLength(md) } }).catch(() => {});
  res.set({
    'Content-Type': 'text/markdown; charset=utf-8',
    'Content-Disposition': `attachment; filename="${slug}-documentation.md"`,
  });
  res.send(md);
}

async function getLogs(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);

  const { after, limit } = req.query;
  const logs = await fetchLogs({
    projectId: id,
    afterId: after || null,
    limit: limit ? parseInt(limit, 10) : 500,
  });
  res.json({ logs });
}

async function validate(req, res) {
  const { id } = req.params;
  await requireOwnedProject(id, req.userId);
  const result = await buildValidator.validateProject(id, { force: true });
  res.json({ ok: result.ok, ...(result.report || {}), durationMs: result.durationMs });
}

async function getStatus(req, res) {
  const running = await prisma.project.findMany({
    where: { ownerId: req.userId, status: 'running' },
    select: { id: true },
  });
  res.json({
    ai: { configured: isConfigured(), model: getModel() },
    activeBuilds: running.map((p) => p.id),
  });
}

module.exports = {
  generate,
  listProjects,
  getStats,
  toggleFavorite,
  getProject,
  updateProject,
  deleteProject,
  rebuildProject,
  downloadZip,
  exportLogs,
  exportDocs,
  getLogs,
  validate,
  getStatus,
};
