const logger = require('../utils/logger');
const config = require('../config');

// OpenRouter returns 429 for rate limits and 529 when the upstream provider is
// overloaded. Both are transient by definition and must never surface as a
// "Failed" project/agent — the scheduler keeps retrying until the slot clears.
const RETRYABLE_STATUSES = new Set([429, 529]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(err) {
  if (!err || typeof err !== 'object') return null;
  if (typeof err.status === 'number') return err.status;
  if (err.response && typeof err.response.status === 'number') return err.response.status;
  return null;
}

/**
 * True when the error is a transient OpenRouter rate limit / overload signal.
 * Checks the raw SDK status as well as the wrapped code string.
 */
function isRateLimitError(err) {
  if (!err || typeof err !== 'object') return false;
  if (typeof err.code === 'string' && (err.code === '429' || err.code === '529')) return true;
  return RETRYABLE_STATUSES.has(statusOf(err));
}

/**
 * Honor the `Retry-After` header when the provider sends one. Accepts both
 * delta-seconds and absolute HTTP dates, and caps the wait at the configured
 * maximum backoff so a malicious/broken header cannot stall the queue forever.
 */
function extractRetryAfterMs(err) {
  try {
    const res = err && err.response;
    const read = (name) => {
      if (!res || !res.headers) return null;
      if (typeof res.headers.get === 'function') return res.headers.get(name);
      if (res.headers[name] != null) return res.headers[name];
      return null;
    };
    const fallback = err && err.headers && (err.headers['retry-after'] || err.headers.retry_after);
    const raw = read('retry-after') || fallback;
    if (!raw) return null;
    const value = String(raw).trim();
    if (/^\d+$/.test(value)) {
      return Math.min(parseInt(value, 10) * 1000, config.openrouterRetryMaxDelayMs);
    }
    const date = Date.parse(value);
    if (!Number.isNaN(date)) {
      const ms = date - Date.now();
      return ms > 0 ? Math.min(ms, config.openrouterRetryMaxDelayMs) : null;
    }
    return null;
  } catch {
    return null;
  }
}

function abortError() {
  const err = new Error('Request aborted while waiting for an OpenRouter slot');
  err.code = 'ABORTED';
  err.aborted = true;
  return err;
}

/**
 * Global LLM request scheduler.
 *
 * Every model request (agents, chat, AI tools, code review, migrations,
 * self-healing repairs) is serialized through a single queue so free-tier
 * OpenRouter models never see more than `maxConcurrent` simultaneous requests.
 * HTTP 429/529 responses are retried automatically with exponential backoff
 * (honoring `Retry-After` when present) — a project or agent is never marked
 * failed because of a temporary rate limit.
 *
 * Status flow reported through `onStatus` / `getStatus(id)`:
 *   { type: 'queued', position }        – waiting for a free request slot
 *   { type: 'running', attempt }        – slot acquired, request in flight
 *   { type: 'rate_limited', attempt, retryInSec, retryAfterMs, waitingUntil } – backing off
 */
class LLMScheduler {
  constructor() {
    this.maxConcurrent = Math.max(1, config.openrouterMaxConcurrency);
    // 0 (default) means "retry indefinitely" so temporary rate limits can
    // never turn into a manual retry or a failed build. Operators may still
    // bound the wait with OPENROUTER_MAX_RETRIES.
    this.maxRetries = config.openrouterMaxRetries > 0 ? config.openrouterMaxRetries : Infinity;
    this.baseDelayMs = Math.max(100, config.openrouterRetryBaseDelayMs);
    this.maxDelayMs = Math.max(this.baseDelayMs, config.openrouterRetryMaxDelayMs);
    this.active = 0;
    this.queue = [];
    this.pumping = false;
    this.statuses = new Map();
  }

  getStats() {
    return { active: this.active, queued: this.queue.length, maxConcurrent: this.maxConcurrent };
  }

  /**
   * Latest scheduler status for a request id (e.g. an agentRun id). `null`
   * when the request is not currently scheduled. `retryInSec` is a live
   * countdown computed from `waitingUntil`, so polling consumers show an
   * accurate "retrying in Ns" message.
   */
  getStatus(id) {
    if (!id) return null;
    const s = this.statuses.get(id);
    if (!s) return null;
    const out = { ...s };
    if (s.type === 'rate_limited' && s.waitingUntil) {
      out.retryInSec = Math.max(0, Math.ceil((s.waitingUntil - Date.now()) / 1000));
    }
    return out;
  }

  /**
   * Run `fn` (a Promise factory) under the global concurrency gate. The slot
   * is held until `fn` settles, so the whole request — including token
   * streaming — counts against the concurrency limit.
   */
  run(fn, { id, onStatus, signal } = {}) {
    return new Promise((resolve, reject) => {
      const job = { kind: 'run', fn, id, onStatus, signal, resolve, reject };
      if (!this._enqueue(job, () => reject(abortError()))) return;
      this._pump();
    });
  }

  /**
   * Reserve a slot and create a streamed request. Unlike `run`, the slot stays
   * held until the returned `release()` is called, so the caller can stream the
   * response without another request sneaking into the same slot.
   * Resolves `{ stream, release }`.
   */
  acquire({ id, create, onStatus, signal } = {}) {
    return new Promise((resolve, reject) => {
      const job = { kind: 'acquire', create, id, onStatus, signal, resolve, reject, released: false };
      if (!this._enqueue(job, () => reject(abortError()))) return;
      this._pump();
    });
  }

  _enqueue(job, onAbortReject) {
    this.queue.push(job);
    this._notify(job, { type: 'queued', position: this.queue.length });
    if (!job.signal) return true;
    if (job.signal.aborted) {
      const idx = this.queue.indexOf(job);
      if (idx !== -1) this.queue.splice(idx, 1);
      this._clearStatus(job.id);
      onAbortReject();
      return false;
    }
    job._onAbort = () => {
      const idx = this.queue.indexOf(job);
      if (idx !== -1) {
        this.queue.splice(idx, 1);
        this._clearStatus(job.id);
        onAbortReject();
      }
    };
    job.signal.addEventListener('abort', job._onAbort, { once: true });
    return true;
  }

  _notify(job, status) {
    if (job.onStatus) {
      try {
        job.onStatus({ ...status });
      } catch {
        // Listener errors must never break the scheduler.
      }
    }
    if (job.id) this.statuses.set(job.id, { ...status, updatedAt: Date.now() });
  }

  _clearStatus(id) {
    if (id) this.statuses.delete(id);
  }

  async _pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0 && this.active < this.maxConcurrent) {
        const job = this.queue.shift();
        if (job._onAbort) job.signal.removeEventListener('abort', job._onAbort);
        this.active++;
        this._dispatch(job).catch((err) => {
          logger.error(`[LLM Scheduler] Unhandled dispatch error: ${err && err.message}`);
        });
      }
    } finally {
      this.pumping = false;
    }
  }

  async _dispatch(job) {
    if (job.kind === 'run') {
      try {
        const result = await this._withRetry(job, job.fn);
        job.resolve(result);
      } catch (err) {
        job.reject(err);
      } finally {
        this._complete(job);
      }
      return;
    }
    try {
      const stream = await this._withRetry(job, job.create);
      job.resolve({
        stream,
        release: () => {
          if (job.released) return;
          job.released = true;
          this._complete(job);
        },
      });
    } catch (err) {
      job.reject(err);
      this._complete(job);
    }
  }

  async _withRetry(job, fn) {
    let attempt = 1;
    for (;;) {
      try {
        this._notify(job, { type: 'running', attempt });
        return await fn();
      } catch (err) {
        if (!isRateLimitError(err)) throw err;
        if (attempt > this.maxRetries) {
          logger.error(`[LLM Scheduler] Rate limit persisted after ${attempt} attempts for ${job.id || 'request'} — giving up.`);
          throw err;
        }
        const retryAfterMs = extractRetryAfterMs(err);
        const delay =
          retryAfterMs != null
            ? retryAfterMs
            : Math.min(this.baseDelayMs * Math.pow(2, attempt - 1), this.maxDelayMs);
        const jitter = Math.round(Math.random() * Math.min(delay, 2000) * 0.2);
        const totalDelay = delay + jitter;
        const waitingUntil = Date.now() + totalDelay;
        this._notify(job, {
          type: 'rate_limited',
          attempt,
          retryAfterMs: totalDelay,
          retryInSec: Math.ceil(totalDelay / 1000),
          waitingUntil,
        });
        logger.warn(
          `[LLM Scheduler] HTTP ${statusOf(err) || '429'} rate limit${job.id ? ` for ${job.id}` : ''} — retry #${attempt} in ${Math.round(totalDelay / 1000)}s`
        );
        await this._sleepWithSignal(totalDelay, job.signal);
        attempt++;
      }
    }
  }

  _sleepWithSignal(ms, signal) {
    if (!signal) return sleep(ms);
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(abortError());
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        reject(abortError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  _complete(job) {
    if (job.completed) return;
    job.completed = true;
    this.active = Math.max(0, this.active - 1);
    this._clearStatus(job.id);
    this._pump();
  }
}

// Single process-wide scheduler shared by every model consumer.
const scheduler = new LLMScheduler();

module.exports = {
  scheduler,
  LLMScheduler,
  isRateLimitError,
  extractRetryAfterMs,
  sleep,
};
