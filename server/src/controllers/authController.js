const bcrypt = require('bcryptjs');
const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { establishSession } = require('../middleware/auth');
const { revokeSession, revokeAllForUser } = require('../services/sessionService');

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    settings: user.settings,
    createdAt: user.createdAt,
  };
}

async function register(req, res) {
  const { name, email, password } = req.body;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new HttpError(409, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { name: name.trim(), email, passwordHash },
  });

  const token = await establishSession(req, res, user);
  res.status(201).json({ token, user: sanitizeUser(user) });
}

async function login(req, res) {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new HttpError(401, 'Invalid credentials');
  }

  const token = await establishSession(req, res, user);
  res.json({ token, user: sanitizeUser(user) });
}

async function me(req, res) {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    include: { _count: { select: { projects: true, sessions: true } } },
  });
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user: { ...sanitizeUser(user), projectCount: user._count.projects, sessionCount: user._count.sessions } });
}

async function updateSettings(req, res) {
  const body = req.body || {};
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');

  const settings = { ...(user.settings || {}), ...(body.settings || body) };
  const updated = await prisma.user.update({
    where: { id: req.userId },
    data: { settings },
  });
  res.json({ settings: updated.settings });
}

async function updateProfile(req, res) {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new HttpError(400, 'Name is required');
  }
  const updated = await prisma.user.update({
    where: { id: req.userId },
    data: { name: name.trim().slice(0, 80) },
  });
  res.json({ user: sanitizeUser(updated) });
}

async function changePassword(req, res) {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword || newPassword.length < 8) {
    throw new HttpError(400, 'Current password and a new password of at least 8 characters are required');
  }
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) throw new HttpError(404, 'User not found');

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new HttpError(401, 'Current password is incorrect');

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: req.userId }, data: { passwordHash } });
  await revokeAllForUser(req.userId);
  res.json({ ok: true });
}

async function listSessions(req, res) {
  const sessions = await prisma.session.findMany({
    where: { userId: req.userId },
    orderBy: { lastSeen: 'desc' },
    take: 20,
    select: {
      id: true,
      ip: true,
      userAgent: true,
      createdAt: true,
      lastSeen: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  res.json({ sessions });
}

async function logout(req, res) {
  const sessionToken = req.get('x-session-token');
  if (sessionToken) {
    await revokeSession(sessionToken);
  }
  res.json({ ok: true });
}

module.exports = {
  register,
  login,
  me,
  updateSettings,
  updateProfile,
  changePassword,
  listSessions,
  logout,
};
