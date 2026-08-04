const prisma = require('../../lib/prisma');
const logger = require('../../utils/logger');
const { writeLog } = require('../buildLogService');

/**
 * ValidationReporter — captures every Build Validation Pipeline run into the
 * database (ValidationRun / ValidationStep) and turns failures into a
 * structured, human-readable report: missing files, missing dependencies,
 * syntax errors, import errors, build logs and suggested fixes.
 */

function tailLines(text, n = 60) {
  const lines = String(text || '')
    .split('\n')
    .filter((l) => l && l.trim());
  return lines.slice(-n);
}

function buildReport({ ok, attempts, steps, logs, project }) {
  const issues = [];

  const failedStep = steps.find((s) => s.status === 'failed');
  const stepLogs = logs.filter((l) => l && l.message).slice(-120);

  if (!ok && failedStep) {
    const { name, detail, message } = failedStep;
    const logTail = tailLines(detail, 80).join('\n');

    if (name === 'structure') {
      issues.push({
        type: 'missing-file',
        title: 'Required project files are missing',
        detail: message || 'The generated project is missing files required to run.',
        log: logTail,
        suggestedFix: 'The missing files were regenerated automatically. Re-run validation.',
      });
    } else if (name === 'install') {
      issues.push({
        type: 'missing-dependency',
        title: 'Dependency installation failed',
        detail: message || 'npm install failed for one of the project directories.',
        log: logTail,
        suggestedFix: 'Ensure package.json lists valid dependencies. Check network access and retry.',
      });
    } else if (name === 'build') {
      issues.push({
        type: 'build-error',
        title: 'Frontend build failed',
        detail: message || 'npm run build failed for the frontend.',
        log: logTail,
        suggestedFix: 'The build errors above were used to repair the code. Re-run validation.',
      });
    } else if (name === 'start') {
      issues.push({
        type: 'start-error',
        title: 'Backend failed to start',
        detail: message || 'The backend server did not start successfully.',
        log: logTail,
        suggestedFix: 'The startup errors above were used to repair the code. Re-run validation.',
      });
    } else {
      issues.push({
        type: 'validation-error',
        title: 'Validation failed',
        detail: message || 'The project did not pass validation.',
        log: logTail,
        suggestedFix: 'Review the logs below and re-run validation.',
      });
    }
  }

  const unresolved = [];
  for (const line of stepLogs) {
    if (/cannot find module|failed to resolve import|module not found/i.test(line.message)) {
      unresolved.push(line.message);
    }
  }
  const importIssues = [...new Set(unresolved)].slice(0, 10);
  if (importIssues.length) {
    issues.unshift({
      type: 'import-error',
      title: 'Unresolved imports detected',
      detail: importIssues.join('\n'),
      log: importIssues.join('\n'),
      suggestedFix: 'Broken imports were passed to the self-healing agent. Re-run validation.',
    });
  }

  const syntaxIssues = stepLogs.filter((l) => /syntaxerror|unexpected token|prettier|eslint|parse error/i.test(l.message));
  if (syntaxIssues.length) {
    issues.push({
      type: 'syntax-error',
      title: 'Syntax errors detected',
      detail: syntaxIssues.slice(-5).map((l) => l.message).join('\n'),
      log: syntaxIssues.slice(-5).map((l) => l.message).join('\n'),
      suggestedFix: 'Syntax errors were passed to the self-healing agent. Re-run validation.',
    });
  }

  return {
    ok,
    attempts,
    issues,
    logs: stepLogs.map((l) => (typeof l === 'string' ? l : l.message)),
    project: {
      validated: Boolean(project?.validated),
      validationStatus: project?.validationStatus || 'none',
      validationError: project?.validationError || null,
    },
  };
}

class ValidationReporter {
  /**
   * Persist a completed validation run with its steps.
   */
  async persistRun({ projectId, attempt, ok, steps, error }) {
    try {
      const run = await prisma.validationRun.create({
        data: {
          projectId,
          attempt,
          status: ok ? 'passed' : 'failed',
          error: error ? String(error).slice(0, 4000) : null,
          completedAt: new Date(),
          steps: {
            create: steps.map((s) => ({
              name: s.name,
              status: s.status,
              message: s.message ? String(s.message).slice(0, 4000) : null,
              detail: s.detail ? String(s.detail).slice(0, 8000) : null,
              durationMs: s.durationMs || null,
            })),
          },
        },
      });
      return run;
    } catch (err) {
      logger.error(`[ValidationReporter] persistRun failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Update the project's cached validation state.
   */
  async updateProjectState({ projectId, ok, attempt, error }) {
    await prisma.project
      .update({
        where: { id: projectId },
        data: {
          validated: ok,
          validationStatus: ok ? 'passed' : 'failed',
          validationAttempts: attempt,
          validationError: ok ? null : String(error || 'Validation failed').slice(0, 4000),
        },
      })
      .catch((err) => logger.warn(`[ValidationReporter] updateProjectState failed: ${err.message}`));

    await writeLog({
      projectId,
      level: ok ? 'success' : 'error',
      source: 'validator',
      message: ok
        ? `Validation passed (attempt ${attempt}): frontend builds and backend starts.`
        : `Validation failed (attempt ${attempt}): ${String(error || 'unknown error').slice(0, 500)}`,
    });
  }

  /**
   * Invalidate the cached "validated" flag (e.g. after a version restore).
   */
  async invalidate(projectId) {
    await prisma.project
      .update({ where: { id: projectId }, data: { validated: false, validationStatus: 'none' } })
      .catch((err) => logger.warn(`[ValidationReporter] invalidate failed: ${err.message}`));
  }

  buildReport(report) {
    return buildReport(report);
  }
}

module.exports = ValidationReporter;