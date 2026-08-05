const prisma = require('../lib/prisma');
const { getModel } = require('./openrouterService');
const { getLogs } = require('./buildLogService');
const { createVersion } = require('./versionService');
const { languageOf } = require('../utils/fileUtils');
const previewService = require('./previewService');
const buildValidator = require('./validation/BuildValidator');

/**
 * Shared completion step for every code-generation path (full agent pipeline,
 * rebuilds and single-agent runs).
 *
 * A project is only marked "Completed" once the full verification pipeline
 * passes (static structure, API contract, dependency install, frontend build,
 * backend boot + /api/health, frontend load and E2E tests). Otherwise it is
 * marked "Validation Failed" and detailed diagnostics remain attached to the
 * project. Any hard error marks it "Failed".
 */
async function finalizeGeneratedProject({ projectId, prompt, summary, title = null, files = {} }) {
  try {
    if (title) {
      await prisma.project
        .update({ where: { id: projectId }, data: { title: String(title).slice(0, 80) } })
        .catch(() => {});
    }

    // Safety net: persist any in-memory files not yet written to the DB.
    const fileList = Object.entries(files).map(([p, content]) => ({ path: p, content }));
    if (fileList.length > 0) {
      await prisma.projectFile.createMany({
        data: fileList.map((f) => ({
          projectId,
          path: f.path,
          content: f.content,
          language: languageOf(f.path),
        })),
        skipDuplicates: true,
      });
    }

    const logs = await getLogs({ projectId, limit: 2000 });
    await createVersion({
      projectId,
      prompt,
      model: getModel(),
      files: fileList,
      logs,
      summary,
    });

    // Automated verification — gating "Completed".
    const validation = await buildValidator.validateProject(projectId, { force: true });
    if (validation.ok) {
      await prisma.project.update({ where: { id: projectId }, data: { status: 'completed' } });
      previewService.start(projectId, { install: false }).catch((err) => console.error('[Preview] auto-start failed', err.message));
      return { ok: true, validation };
    }
    await prisma.project.update({ where: { id: projectId }, data: { status: 'validation_failed' } });
    return { ok: false, validation };
  } catch (err) {
    console.error('[Finalize]', err);
    await prisma.project
      .update({ where: { id: projectId }, data: { status: 'failed', error: err.message } })
      .catch(() => {});
    return { ok: false, error: err.message };
  }
}

module.exports = { finalizeGeneratedProject };
