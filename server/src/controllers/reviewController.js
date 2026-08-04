const prisma = require('../lib/prisma');
const HttpError = require('../utils/httpError');
const { extractSourceFiles, analyzeCode, findingsToMarkdown } = require('../services/codeReviewService');
const { buildPdf } = require('../services/exportService');
const logger = require('../utils/logger');

function serializeReview(r) {
  const files = Array.isArray(r.files) ? r.files : [];
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    summary: r.summary,
    scores: r.scores,
    results: r.status === 'completed' ? (r.results || []) : undefined,
    files,
    fileCount: files.length,
    error: r.error,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

async function upload(req, res) {
  const { name } = req.body || {};
  const paths = req.body.paths; // string or array of relative paths aligned to files

  const uploaded = (req.files || []).map((f, i) => ({
    originalname: f.originalname,
    mimetype: f.mimetype,
    buffer: f.buffer,
    path: Array.isArray(paths) ? paths[i] : paths,
  }));

  const files = extractSourceFiles(uploaded);
  if (files.length === 0) {
    throw new HttpError(400, 'No source files were provided or recognized. Upload code files or a ZIP.');
  }

  const reviewName = (name && name.trim()) || (files.length === 1 ? files[0].path : 'Code review');

  const review = await prisma.codeReview.create({
    data: {
      userId: req.userId,
      name: reviewName.slice(0, 120),
      status: 'processing',
      files: files.map((f) => ({ path: f.path, language: f.language, size: f.content.length })),
    },
  });

  (async () => {
    try {
      const result = await analyzeCode(files);
      await prisma.codeReview.update({
        where: { id: review.id },
        data: {
          status: 'completed',
          summary: result.summary,
          results: result.findings,
          scores: result.scores,
        },
      });
    } catch (err) {
      logger.error(`[CodeReview ${review.id}] analysis failed: ${err.message}`);
      await prisma.codeReview.update({
        where: { id: review.id },
        data: { status: 'failed', error: err.message || 'Analysis failed' },
      });
    }
  })();

  res.status(202).json({ review: serializeReview(review) });
}

async function list(req, res) {
  const reviews = await prisma.codeReview.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: {
      id: true,
      name: true,
      status: true,
      summary: true,
      scores: true,
      files: true,
      error: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  res.json({ reviews: reviews.map(serializeReview) });
}

async function get(req, res) {
  const { id } = req.params;
  const review = await prisma.codeReview.findFirst({ where: { id, userId: req.userId } });
  if (!review) throw new HttpError(404, 'Review not found');
  res.json({ review: serializeReview(review) });
}

async function remove(req, res) {
  const { id } = req.params;
  const review = await prisma.codeReview.findFirst({ where: { id, userId: req.userId } });
  if (!review) throw new HttpError(404, 'Review not found');
  await prisma.codeReview.delete({ where: { id } });
  res.json({ ok: true });
}

async function exportPdf(req, res) {
  const { id } = req.params;
  const review = await prisma.codeReview.findFirst({ where: { id, userId: req.userId } });
  if (!review) throw new HttpError(404, 'Review not found');
  if (review.status !== 'completed') {
    throw new HttpError(409, 'Review is not ready to export yet');
  }

  const md = findingsToMarkdown(review);
  const buffer = await buildPdf(`AI Code Review — ${review.name}`, md);
  const slug = (review.name || 'code-review').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'code-review';

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${slug}-review.pdf"`,
    'Content-Length': Buffer.byteLength(buffer),
  });
  res.send(buffer);
}

module.exports = { upload, list, get, remove, exportPdf };