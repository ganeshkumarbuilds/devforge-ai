const { listTools, getCategories, runTool } = require('../services/aiToolService');
const HttpError = require('../utils/httpError');
const logger = require('../utils/logger');

/**
 * GET /api/ai-tools
 * Public metadata for every available AI tool (no prompts).
 */
async function getTools(req, res) {
  res.json({ tools: listTools(), categories: getCategories() });
}

/**
 * POST /api/ai-tools/run
 * Streams an assistant reply for the given tool via Server-Sent Events.
 * Body: { tool, messages }
 *   tool: string id of a registered AI tool
 *   messages: array of { role: 'user'|'assistant', content } — conversation so far
 *
 * Event payloads:
 *   data: {"delta":"..."}                    – a partial token
 *   data: {"done":true,"content":"..."}      – completion
 *   data: {"error":"..."}                    – fatal error
 */
async function run(req, res) {
  const { tool, messages } = req.body || {};

  if (!tool || typeof tool !== 'string') {
    throw new HttpError(400, 'A tool id is required');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new HttpError(400, 'At least one message is required');
  }

  const normalized = messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 20000) }))
    .slice(-60);

  if (normalized.length === 0) {
    throw new HttpError(400, 'Messages must contain user or assistant content');
  }

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  let clientGone = false;
  const abortController = new AbortController();
  req.on('close', () => {
    clientGone = true;
    abortController.abort();
  });

  const sendEvent = (payload) => {
    if (clientGone || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let fullText = '';

  try {
    for await (const chunk of runTool({
      id: tool,
      messages: normalized,
      signal: abortController.signal,
      requestId: `tool:${tool}`,
      onSchedulerStatus: (s) => {
        if (!s) return;
        if (s.type === 'queued') {
          sendEvent({ waiting: true, queued: true });
        } else if (s.type === 'rate_limited') {
          sendEvent({ waiting: true, retryInSec: s.retryInSec, attempt: s.attempt });
        }
      },
    })) {
      if (chunk.delta) {
        fullText += chunk.delta;
        sendEvent({ delta: chunk.delta });
      }
    }
  } catch (err) {
    if (abortController.signal.aborted) {
      return res.end();
    }
    if (err.code === 'UNKNOWN_TOOL') {
      logger.warn(`[AI Tools] unknown tool requested: ${tool}`);
      sendEvent({ error: 'Unknown AI tool' });
    } else {
      logger.error(`[AI Tools] run failed for ${tool}: ${err.message}`);
      sendEvent({ error: err.message || 'Failed to generate a response' });
    }
    return res.end();
  }

  if (!fullText.trim()) {
    sendEvent({ error: 'The model returned an empty response. Please try again.' });
    return res.end();
  }

  sendEvent({ done: true, content: fullText.trim() });
  res.end();
}

module.exports = { getTools, run };
