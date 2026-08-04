const prisma = require('../lib/prisma');
const HttpError = require('./httpError');

/**
 * Load a project that belongs to the requesting user, or 404.
 * Centralizes ownership checks so every controller authorizes access identically.
 */
async function requireOwnedProject(id, userId, opts = {}) {
  const project = await prisma.project.findFirst({
    where: { id, ownerId: userId },
    include: opts.includeCount ? { _count: { select: { files: true } } } : undefined,
  });
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

module.exports = { requireOwnedProject };