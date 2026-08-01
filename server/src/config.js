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
