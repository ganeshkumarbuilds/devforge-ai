const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { getLogs } = require('../services/buildLogService');
const previewService = require('../services/previewService');
const buildValidator = require('../services/validation/BuildValidator');
const { requireOwnedProject } = require('../utils/projectAccess');
const {
  createVersion,
  listVersions,
  getVersion,
  restoreVersion,
  diffVersions,
  generateMigration,
} = require('../services/versionService');

async function list(req, res) {
  const { id } = req.params;
  await requireOwnedProject(id, req.userId);
  const versions = await listVersions(id);
  res.json({ versions });
}

async function getOne(req, res) {
  const { id, versionId } = req.params;
  await requireOwnedProject(id, req.userId);
  const version = await getVersion(id, versionId);
  res.json({ version });
}

async function createManual(req, res) {
  const { id } = req.params;
  const project = await requireOwnedProject(id, req.userId);

  const files = await prisma.projectFile.findMany({
    where: { projectId: id },
    select: { path: true, content: true },
    orderBy: { path: 'asc' },
  });
  if (files.length === 0) throw new HttpError(400, 'Project has no files yet to snapshot');

  const { notes } = req.body || {};
  const logs = await getLogs({ projectId: id, limit: 2000 });
  const version = await createVersion({
    projectId: id,
    prompt: project.description,
    files: files.map((f) => ({ path: f.path, content: f.content })),
    logs,
    notes,
    summary: `Manual snapshot of ${files.length} files`,
  });
  if (!version) throw new HttpError(500, 'Failed to capture a version snapshot');
  res.status(201).json({ version });
}

async function restore(req, res) {
  const { id, versionId } = req.params;
  await requireOwnedProject(id, req.userId);
  const result = await restoreVersion(id, versionId);
  // Restoring swaps the project's files — the previous validation result is no
  // longer valid. Invalidate so exports/previews re-validate before release.
  await buildValidator.invalidateValidation(id).catch((err) => console.error('[Validation] invalidate after restore failed', err.message));
  // Keep disk + live preview in sync with the restored snapshot.
  await previewService.syncProjectToDisk(id).catch((err) => console.error('[Preview] sync after restore failed', err.message));
  previewService.restart(id, { reinstall: false }).catch((err) => console.error('[Preview] restart after restore failed', err.message));
  // Kick off background re-validation so the project becomes exportable again.
  buildValidator.validateProject(id).catch((err) => console.error('[Validation] revalidate after restore failed', err.message));
  res.json({ ok: true, ...result });
}

async function diff(req, res) {
  const { id, versionId, compareId } = req.params;
  await requireOwnedProject(id, req.userId);
  const result = await diffVersions(id, versionId, compareId);
  res.json(result);
}

async function migration(req, res) {
  const { id, versionId } = req.params;
  await requireOwnedProject(id, req.userId);
  const result = await generateMigration(id, versionId);
  res.json(result);
}

module.exports = { list, getOne, createManual, restore, diff, migration };