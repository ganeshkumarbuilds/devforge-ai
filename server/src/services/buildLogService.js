const prisma = require('../lib/prisma');

async function writeLog({ projectId, agentRunId = null, level = 'info', source = 'system', message }) {
  const safeMessage = String(message ?? '').slice(0, 4000);
  if (!projectId || !safeMessage) return;
  try {
    await prisma.buildLog.create({
      data: { projectId, agentRunId, level, source, message: safeMessage },
    });
  } catch (err) {
    // Logging must never crash the pipeline.
    console.error('[BuildLog] write failed', err.message);
  }
}

async function getLogs({ projectId, afterId = null, limit = 500 }) {
  const where = { projectId };
  if (afterId) {
    where.id = { gt: afterId };
  }
  const logs = await prisma.buildLog.findMany({
    where,
    orderBy: { id: 'asc' },
    take: Math.min(limit, 2000),
    select: { id: true, level: true, source: true, message: true, createdAt: true, agentRunId: true },
  });
  return logs;
}

async function clearLogs(projectId) {
  await prisma.buildLog.deleteMany({ where: { projectId } });
}

module.exports = { writeLog, getLogs, clearLogs };
