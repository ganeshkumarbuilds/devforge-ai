const prisma = require('../lib/prisma');
const config = require('../config');
const { getModel } = require('./openrouterService');
const { getLogs } = require('./buildLogService');
const { createVersion } = require('./versionService');
const { languageOf } = require('../utils/fileUtils');
const previewService = require('./previewService');
const buildValidator = require('./validation/BuildValidator');
const repairService = require('./repairService');

/**
 * Restart the live preview so it serves the repaired build. Restarts the
 * running session when present, otherwise starts one.
 */
async function restartPreview(projectId) {
  try {
    const status = previewService.getStatus(projectId);
    if (status && status.running) {
      await previewService.restart(projectId, { reinstall: false });
    } else {
      await previewService.start(projectId, { install: false });
    }
  } catch (err) {
    console.error('[Preview] restart after recovery failed', err.message);
  }
}

/**
 * Shared completion step for every code-generation path (full agent pipeline,
 * rebuilds, single-agent runs and AI repairs).
 *
 * A project is only marked "Completed" once the full verification pipeline
 * passes (static structure, API contract, dependency install, frontend build,
 * backend boot + /api/health, frontend load and E2E tests).
 *
 * Autonomous failure recovery: validation failures are never surfaced
 * immediately. The AI repair agent regenerates the failing components and the
 * full pipeline re-runs, continuing the repair→validate cycle until validation
 * succeeds or the configured maximum retry count is reached. Only then is the
 * project marked "Validation Failed" (status is "recovering" throughout).
 */
async function finalizeGeneratedProject({ projectId, prompt, summary, title = null, files = {}, repairArea = null }) {
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

    const maxAuto = Math.max(0, config.validationAutoRepairMaxRetries || 2);
    let validation;
    let autoRepairs = 0;

    // Optional initial targeted repair (user-initiated "Repair with AI").
    if (repairArea) {
      autoRepairs = 1;
      await prisma.project.update({ where: { id: projectId }, data: { status: 'recovering' } });
      const repair = await repairService.performRepair(projectId, repairArea, `AI repair: ${repairArea}`, { quiet: true });
      validation = await buildValidator.validateProject(projectId, { force: true });
      await repairService.recordRepairRun({
        projectId,
        area: repairArea,
        status: validation.ok ? 'passed' : 'failed',
        validation,
        filesModified: repair.filesModified,
        error: validation.ok ? null : validationError(validation),
      });
    } else {
      validation = await buildValidator.validateProject(projectId, { force: true });
    }

    // Autonomous recovery: repair all detected issues, rebuild, restart preview
    // and re-run the complete pipeline until success or max retries.
    while (!validation.ok && autoRepairs < maxAuto) {
      autoRepairs++;
      await prisma.project.update({ where: { id: projectId }, data: { status: 'recovering' } });
      const repair = await repairService.performRepair(
        projectId,
        'all',
        `${summary} — autonomous AI repair (attempt ${autoRepairs})`,
        { quiet: true }
      );
      validation = await buildValidator.validateProject(projectId, { force: true });
      await repairService.recordRepairRun({
        projectId,
        area: 'all',
        status: validation.ok ? 'passed' : 'failed',
        validation,
        filesModified: repair.filesModified,
        error: validation.ok ? null : validationError(validation),
      });
    }

    if (validation.ok) {
      await prisma.project.update({ where: { id: projectId }, data: { status: 'completed' } });
      await restartPreview(projectId);
      return { ok: true, validation, autoRepairs };
    }

    // All autonomous repair attempts exhausted — surface the manual report.
    await prisma.project.update({ where: { id: projectId }, data: { status: 'validation_failed' } });
    return { ok: false, validation, autoRepairs };
  } catch (err) {
    console.error('[Finalize]', err);
    await prisma.project
      .update({ where: { id: projectId }, data: { status: 'failed', error: err.message } })
      .catch(() => {});
    return { ok: false, error: err.message };
  }
}

function validationError(validation) {
  if (!validation) return null;
  const issues = validation.report && validation.report.issues;
  if (Array.isArray(issues) && issues.length) {
    return issues.map((i) => i.title).join('; ').slice(0, 4000);
  }
  return null;
}

module.exports = { finalizeGeneratedProject };
