const path = require('path');

require('dotenv').config();

function parseBool(value, fallback) {
  if (value == null) return fallback;
  return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
}

function requireEnv(name, fallback) {
  const value = process.env[name];
  if (value == null || value === '') {
    if (fallback === undefined) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return fallback;
  }
  return value;
}

const config = {
  nodeEnv: requireEnv('NODE_ENV', 'development'),
  port: parseInt(requireEnv('PORT', '5000'), 10),
  preview: {
    enabled: parseBool(process.env.PREVIEW_ENABLED, true),
    // Bind preview servers to loopback only. Outbound requests from the
    // generated app stay on the machine and are proxied through the main API.
    host: requireEnv('PREVIEW_HOST', '127.0.0.1'),
    portStart: parseInt(requireEnv('PREVIEW_PORT_START', '4100'), 10),
    portCount: parseInt(requireEnv('PREVIEW_PORT_COUNT', '500'), 10),
    installTimeoutMs: parseInt(requireEnv('PREVIEW_INSTALL_TIMEOUT_MS', '300000'), 10),
    startTimeoutMs: parseInt(requireEnv('PREVIEW_START_TIMEOUT_MS', '120000'), 10),
    maxLogLines: parseInt(requireEnv('PREVIEW_MAX_LOG_LINES', '800'), 10),
    previewTokenTtl: requireEnv('PREVIEW_TOKEN_TTL', '1h'),
  },
  jwtSecret: requireEnv('JWT_SECRET', 'devforge_super_secret_change_me_in_production'),
  jwtExpiresIn: requireEnv('JWT_EXPIRES_IN', '7d'),
  openrouterApiKey: requireEnv('OPENROUTER_API_KEY', ''),
  openrouterBaseUrl: 'https://openrouter.ai/api/v1',
  openrouterModel: requireEnv('OPENROUTER_MODEL', 'openrouter/free'),
  generatedDir: path.resolve(requireEnv('GENERATED_DIR', './generated')),
  agentMaxTokens: parseInt(requireEnv('AGENT_MAX_TOKENS', '16384'), 10),
  rateLimitWindowMs: parseInt(requireEnv('RATE_LIMIT_WINDOW_MS', '60000'), 10),
  rateLimitMax: parseInt(requireEnv('RATE_LIMIT_MAX', '100'), 10),
  trustProxy: parseBool(process.env.TRUST_PROXY, false),
  logLevel: requireEnv('LOG_LEVEL', 'info'),
  corsOrigin: requireEnv('CORS_ORIGIN', '*'),
  validationEnabled: parseBool(process.env.VALIDATION_ENABLED, true),
  validationMaxRetries: parseInt(requireEnv('VALIDATION_MAX_RETRIES', '3'), 10),
  validationCommandTimeoutMs: parseInt(requireEnv('VALIDATION_COMMAND_TIMEOUT_MS', '240000'), 10),
  validationStartTimeoutMs: parseInt(requireEnv('VALIDATION_START_TIMEOUT_MS', '90000'), 10),
  validationHealthTimeoutMs: parseInt(requireEnv('VALIDATION_HEALTH_TIMEOUT_MS', '10000'), 10),
  validationAiFixEnabled: parseBool(process.env.VALIDATION_AI_FIX_ENABLED, true),
  validationAllowUnvalidatedDownload: parseBool(process.env.VALIDATION_ALLOW_UNVALIDATED_DOWNLOAD, true),
};

module.exports = config;
