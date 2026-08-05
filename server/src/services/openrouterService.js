const OpenAI = require('openai');
const { openrouterApiKey, openrouterBaseUrl, openrouterModel, agentMaxTokens } = require('../config');
const logger = require('../utils/logger');
const { scheduler, isRateLimitError, extractRetryAfterMs } = require('./llmScheduler');

class OpenRouterError extends Error {
  constructor(message, detail, code = null) {
    super(message);
    this.detail = detail;
    this.code = code;
  }
}

// Single reusable client instance shared by every agent. All retries are
// handled by the global request scheduler (see llmScheduler.js) so the SDK's
// own built-in retry is disabled to avoid double-backoff on rate limits.
const client = new OpenAI({
  apiKey: openrouterApiKey,
  baseURL: openrouterBaseUrl,
  defaultHeaders: {
    'HTTP-Referer': 'https://devforge.local',
    'X-Title': 'DevForge AI',
  },
  timeout: 120000,
  maxRetries: 0,
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
 * @param {Function} opts.onSchedulerStatus Receives scheduler status updates (queued / rate_limited / running)
 * @param {string} opts.requestId Stable id for scheduler status tracking (e.g. an agentRun id)
 * @param {AbortSignal} opts.signal Abort signal forwarded to the HTTP request
 */
async function chat({ messages, options = {}, onProgress, onSchedulerStatus, requestId, signal }) {
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
    return await scheduler.run(
      async () => {
        const stream = await client.chat.completions.create({ ...payload, signal });
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
      },
      { id: requestId, onStatus: onSchedulerStatus, signal }
    );
  } catch (err) {
    const status = err.status || (err.response && err.response.status);
    const message = toErrorMessage(err);
    logger.error(`[OpenRouter] Request failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
    throw new OpenRouterError(message, err.message || String(err), status ? String(status) : 'network');
  }
}

/**
 * Stream a chat completion through OpenRouter.
 * Yields an object with either `{ delta }` (a partial token) or `{ done: true, content }`.
 * @param {Object} opts
 * @param {Array} opts.messages Array of { role, content }
 * @param {Object} opts.options Chat options (temperature, max_tokens, etc.)
 * @param {Function} opts.onSchedulerStatus Receives scheduler status updates (queued / rate_limited / running)
 * @param {string} opts.requestId Stable id for scheduler status tracking
 */
async function* streamChat({ messages, options = {}, signal, onSchedulerStatus, requestId }) {
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

  const handle = await scheduler.acquire({
    id: requestId,
    create: () => client.chat.completions.create({ ...payload, signal }),
    onStatus: onSchedulerStatus,
    signal,
  });

  try {
    const stream = handle.stream;
    let fullText = '';
    for await (const chunk of stream) {
      if (signal && signal.aborted) break;
      const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta
        ? chunk.choices[0].delta.content
        : null;
      if (delta) {
        fullText += delta;
        yield { delta };
      }
    }
    yield { done: true, content: fullText.trim() };
  } catch (err) {
    if (signal && signal.aborted) {
      throw new OpenRouterError('Request aborted', String(err), 'aborted');
    }
    const status = err.status || (err.response && err.response.status);
    const message = toErrorMessage(err);
    logger.error(`[OpenRouter] Stream failed${status ? ` (HTTP ${status})` : ''}: ${message}`);
    throw new OpenRouterError(message, err.message || String(err), status ? String(status) : 'network');
  } finally {
    handle.release();
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

module.exports = {
  client,
  chat,
  streamChat,
  isConfigured,
  getModel,
  extractCodeBlock,
  stripFences,
  OpenRouterError,
  toErrorMessage,
  isRateLimitError,
  extractRetryAfterMs,
  scheduler,
};
