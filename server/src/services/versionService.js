const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { chat, getModel, isConfigured, stripFences } = require('./openrouterService');
const logger = require('../utils/logger');
const { languageOf } = require('../utils/fileUtils');

function serializeVersion(v, { includeFiles = false, includeLogs = false } = {}) {
  const base = {
    id: v.id,
    version: v.version,
    number: v.number,
    prompt: v.prompt,
    model: v.model,
    summary: v.summary,
    status: v.status,
    notes: v.notes,
    fileCount: Array.isArray(v.files) ? v.files.length : 0,
    logCount: Array.isArray(v.logs) ? v.logs.length : 0,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
  if (includeFiles) base.files = normalizeFiles(v.files);
  if (includeLogs) base.logs = Array.isArray(v.logs) ? v.logs : [];
  return base;
}

function normalizeFiles(files) {
  if (!Array.isArray(files)) return [];
  return files
    .filter((f) => f && f.path)
    .map((f) => ({ path: f.path.replace(/\\/g, '/'), content: String(f.content ?? '') }));
}

function normalizeLogs(logs) {
  if (!Array.isArray(logs)) return [];
  return logs
    .filter((l) => l && l.message)
    .slice(-2000)
    .map((l) => ({
      level: String(l.level ?? 'info').slice(0, 10),
      source: String(l.source ?? 'system').slice(0, 50),
      message: String(l.message ?? '').slice(0, 4000),
      createdAt: l.createdAt ? new Date(l.createdAt).toISOString() : new Date().toISOString(),
    }));
}

async function nextVersionNumber(projectId) {
  const agg = await prisma.projectVersion.aggregate({
    where: { projectId },
    _max: { number: true },
  });
  return (agg._max.number || 0) + 1;
}

/**
 * Capture a snapshot of generated files as a new project version.
 * Safe to call from anywhere in the build lifecycle; never throws.
 */
async function createVersion({ projectId, prompt, model, files, logs, notes, status = 'completed', summary }) {
  try {
    const snapshot = normalizeFiles(files);
    const number = await nextVersionNumber(projectId);
    const version = await prisma.projectVersion.create({
      data: {
        projectId,
        number,
        version: `v${number}`,
        prompt: String(prompt ?? '').slice(0, 8000),
        model: model || getModel() || '',
        status,
        notes: notes ? String(notes).slice(0, 2000) : null,
        summary: summary ? String(summary).slice(0, 2000) : null,
        files: snapshot,
        logs: normalizeLogs(logs),
      },
    });
    logger.info(`[Versions] captured ${version.version} for project ${projectId} (${snapshot.length} files, ${version.logs ? version.logs.length : 0} logs)`);
    return serializeVersion(version);
  } catch (err) {
    // Version capture must never break the generation workflow.
    logger.error(`[Versions] capture failed for project ${projectId}: ${err.message}`);
    return null;
  }
}

async function listVersions(projectId) {
  const versions = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { number: 'asc' },
  });
  return versions.map((v) => serializeVersion(v));
}

async function getVersion(projectId, versionId) {
  const version = await prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) throw new HttpError(404, 'Version not found');
  return serializeVersion(version, { includeFiles: true, includeLogs: true });
}

/**
 * Restore a version's file snapshot as the project's current files.
 */
async function restoreVersion(projectId, versionId) {
  const version = await prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) throw new HttpError(404, 'Version not found');

  const snapshot = normalizeFiles(version.files);
  if (snapshot.length === 0) throw new HttpError(400, 'This version has no files to restore');

  await prisma.$transaction([
    prisma.projectFile.deleteMany({ where: { projectId } }),
    prisma.projectFile.createMany({
      data: snapshot.map((f) => ({ projectId, path: f.path, content: f.content, language: languageOf(f.path) })),
      skipDuplicates: true,
    }),
  ]);
  await prisma.project.update({ where: { id: projectId }, data: { updatedAt: new Date() } });

  logger.info(`[Versions] restored ${version.version} for project ${projectId}`);
  return { restored: version.version, files: snapshot.length };
}

/**
 * Simple line-level diff between two versions. Returns per-file changes plus stats.
 */
async function diffVersions(projectId, aId, bId) {
  const aRaw = await prisma.projectVersion.findFirst({ where: { id: aId, projectId } });
  const bRaw = await prisma.projectVersion.findFirst({ where: { id: bId, projectId } });
  if (!aRaw) throw new HttpError(404, 'Source version not found');
  if (!bRaw) throw new HttpError(404, 'Target version not found');

  const aFiles = new Map(normalizeFiles(aRaw.files).map((f) => [f.path, f.content]));
  const bFiles = new Map(normalizeFiles(bRaw.files).map((f) => [f.path, f.content]));
  const allPaths = new Set([...aFiles.keys(), ...bFiles.keys()]);

  const changes = [];
  let addedCount = 0;
  let removedCount = 0;
  let modifiedCount = 0;

  for (const p of allPaths) {
    const ac = aFiles.get(p);
    const bc = bFiles.get(p);
    if (ac === undefined) {
      addedCount++;
      changes.push({ path: p, status: 'added', hunks: [{ type: 'added', text: bc }] });
    } else if (bc === undefined) {
      removedCount++;
      changes.push({ path: p, status: 'removed', hunks: [{ type: 'removed', text: ac }] });
    } else if (ac !== bc) {
      modifiedCount++;
      changes.push({ path: p, status: 'modified', hunks: lineDiff(ac, bc) });
    }
  }

  const order = { modified: 0, added: 1, removed: 2 };
  changes.sort((x, y) => order[x.status] - order[y.status] || x.path.localeCompare(y.path));

  return {
    aVersion: { id: aRaw.id, version: aRaw.version, createdAt: aRaw.createdAt },
    bVersion: { id: bRaw.id, version: bRaw.version, createdAt: bRaw.createdAt },
    stats: { added: addedCount, removed: removedCount, modified: modifiedCount, total: changes.length },
    changes,
  };
}

function lineDiff(aText, bText) {
  const A = String(aText).split('\n').slice(0, 3000);
  const B = String(bText).split('\n').slice(0, 3000);
  const n = A.length;
  const m = B.length;

  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const hunks = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      hunks.push({ type: 'context', text: A[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      hunks.push({ type: 'removed', text: A[i] });
      i++;
    } else {
      hunks.push({ type: 'added', text: B[j] });
      j++;
    }
  }
  while (i < n) hunks.push({ type: 'removed', text: A[i++] });
  while (j < m) hunks.push({ type: 'added', text: B[j++] });

  if (hunks.length > 4000) return [{ type: 'context', text: '… diff truncated …' }];
  return hunks;
}

const MIGRATION_PROMPT = `You are the Database Migration agent inside the DevForge AI platform. Based on the database schema definition below, generate a single PostgreSQL migration SQL script.

- Use appropriate CREATE TABLE / ALTER TABLE / CREATE INDEX and constraints.
- Use PostgreSQL syntax only.
- Return ONLY the SQL. Do not wrap it in code fences and do not add explanations or comments.

Schema files:
`;

async function generateMigration(projectId, versionId) {
  if (!isConfigured()) {
    throw new HttpError(503, 'OpenRouter is not configured. Add OPENROUTER_API_KEY and OPENROUTER_MODEL in server/.env.');
  }
  const version = await prisma.projectVersion.findFirst({ where: { id: versionId, projectId } });
  if (!version) throw new HttpError(404, 'Version not found');

  const files = normalizeFiles(version.files);
  const schemaFiles = files.filter((f) =>
    /schema\.prisma$/i.test(f.path) || /\.sql$/i.test(f.path) || /migration/i.test(f.path)
  );
  if (schemaFiles.length === 0) {
    throw new HttpError(400, 'This version does not contain a database schema (schema.prisma or .sql) to migrate.');
  }

  const schemaText = schemaFiles.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');
  const { content } = await chat({
    messages: [
      { role: 'system', content: MIGRATION_PROMPT },
      { role: 'user', content: schemaText },
    ],
    options: { temperature: 0.2 },
  });

  const sql = stripFences(content).trim();
  if (!sql) throw new HttpError(500, 'The model returned an empty migration.');
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  return {
    filename: `${timestamp}_migration.sql`,
    sql,
    version: version.version,
    schemaFiles: schemaFiles.map((f) => f.path),
  };
}

module.exports = {
  createVersion,
  listVersions,
  getVersion,
  restoreVersion,
  diffVersions,
  generateMigration,
  serializeVersion,
};
