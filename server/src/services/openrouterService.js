const OpenAI = require('openai');
const { openrouterApiKey, openrouterBaseUrl, openrouterModel, agentMaxTokens } = require('../config');
const logger = require('../utils/logger');

class OpenRouterError extends Error {
  constructor(message, detail, code = null) {
    super(message);
    this.detail = detail;
    this.code = code;
  }
}

// Single reusable client instance shared by every agent.
const client = new OpenAI({
  apiKey: openrouterApiKey,
  baseURL: openrouterBaseUrl,
  defaultHeaders: {
    'HTTP-Referer': 'https://devforge.local',
    'X-Title': 'DevForge AI',
  },
  timeout: 120000,
});

function isConfigured() {
  return Boolean(openrouterApiKey) && Boolean(openrouterModel);
}

function getModel() {
  return openrouterModel;
}

/**
 * Map provider/transport errors to clear, user-friendly messages.
 */
function toErrorMessage(err) {
  if (!err || typeof err !== 'object') return String(err);

  const status = err.status || (err.response && err.response.status);
  const providerMessage = (err.error && (err.error.message || err.error.error)) || err.message || '';

  if (status === 401) {
    return 'Invalid OpenRouter API key (HTTP 401). Update OPENROUTER_API_KEY in server/.env and restart the server.';
  }
  if (status === 402) {
    return 'OpenRouter has insufficient credits (HTTP 402). Add credits at https://openrouter.ai/settings/credits.';
  }
  if (status === 403) {
    return 'OpenRouter access denied (HTTP 403). Check your API key permissions.';
  }
  if (status === 429) {
    return 'OpenRouter rate limit exceeded (HTTP 429). Wait a moment and try again.';
  }
  if (status && status >= 500) {
    return `OpenRouter server error (HTTP ${status}): ${providerMessage}`.trim();
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT' || err.code === 'EAI_AGAIN' || err.code === 'UND_ERR_CONNECT_TIMEOUT') {
    return `Network error connecting to OpenRouter (${err.code}). Check your internet connection and that https://openrouter.ai is reachable.`;
  }
  if (status) {
    return `OpenRouter error (HTTP ${status}): ${providerMessage}`.trim();
  }
  return err.message || String(err);
}

/**
 * Generate a streaming completion through OpenRouter.
 * @param {Object} opts
 * @param {Array} opts.messages Array of { role, content }
 * @param {string} opts.model Override model
 * @param {Object} opts.options Chat options (temperature, max_tokens / num_predict, etc.)
 * @param {Function} opts.onProgress Streaming progress callback with full text so far
 */
async function chat({ messages, options = {}, onProgress }) {
  if (!isConfigured()) {
    throw new OpenRouterError(
      'OpenRouter is not configured',
      'Set OPENROUTER_API_KEY and OPENROUTER_MODEL in server/.env and restart the server.'
    );
  }

  const payload = {
    model: openrouterModel,
    messages,
    stream: true,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.max_tokens ?? options.num_predict ?? agentMaxTokens,
  };

  try {
    const stream = await client.chat.completions.create(payload);
    let fullText = '';
    for await (const chunk of stream) {
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : null;
      if (delta) {
        fullText += delta;
        if (onProgress) onProgress(fullText);
      }
    }
    return { content: fullText.trim() };
  } catch (err) {
    const status = err.status || (err.response && err.response.status);
    const message = toErrorMessage(err);
    logger.error(`[OpenRouter] Request failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
    throw new OpenRouterError(message, err.message || String(err), status ? String(status) : 'network');
  }
}

/**
 * Ask the model to produce a code block (fenced). Returns extracted block or raw text.
 */
function extractCodeBlock(content) {
  const fenceMatch = content.match(/```[\w+-]*\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].replace(/\n+$/, '');
  return content.trim();
}

function stripFences(content) {
  return content
    .replace(/^```[\w+-]*\s*/gm, '')
    .replace(/```$/gm, '')
    .trim();
}

module.exports = { client, chat, isConfigured, getModel, extractCodeBlock, stripFences, OpenRouterError, toErrorMessage };
