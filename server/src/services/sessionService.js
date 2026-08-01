const crypto = require('crypto');
const prisma = require('../lib/prisma');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function createSession({ userId, ip, userAgent, ttlMs = 7 * 24 * 60 * 60 * 1000 }) {
  const token = randomToken();
  const tokenHash = hashToken(token);
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      ip: ip || null,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
}

async function validateSession(token) {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({ where: { tokenHash } });
  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt < new Date()) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }).catch(() => {});
    return null;
  }
  return session;
}

async function revokeSession(token) {
  if (!token) return;
  const tokenHash = hashToken(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => {});
}

async function revokeAllForUser(userId) {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  }).catch(() => {});
}

module.exports = { createSession, validateSession, revokeSession, revokeAllForUser, hashToken };
