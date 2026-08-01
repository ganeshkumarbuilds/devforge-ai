const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');
const { port, generatedDir, corsOrigin, trustProxy } = require('./config');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const authRoutes = require('./routes/authRoutes');
const projectRoutes = require('./routes/projectRoutes');
const openrouterRoutes = require('./routes/openrouterRoutes');
const { isConfigured, getModel } = require('./services/openrouterService');

const app = express();

app.disable('x-powered-by');
if (trustProxy) app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()) }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api')) {
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

app.use(express.json({ limit: '2mb' }));

// Ensure generated directory exists.
fs.mkdirSync(path.resolve(generatedDir), { recursive: true });

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime(), ts: new Date().toISOString() }));
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/ai', openrouterRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(port, () => {
  logger.info(`DevForge AI server running on http://localhost:${port}`);
  if (isConfigured()) {
    logger.info('✓ OpenRouter initialized');
    logger.info(`Model: ${getModel()}`);
  } else {
    logger.warn('OpenRouter NOT initialized: set OPENROUTER_API_KEY and OPENROUTER_MODEL in server/.env');
  }
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = app;
