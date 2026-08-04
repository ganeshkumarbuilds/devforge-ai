/**
 * Prepare an Express response for Server-Sent Events.
 *
 * Sets the correct headers, flushes them, and wires up client-disconnect
 * detection. Returns a send helper plus an AbortController you can pass to
 * long-running upstream calls so they are cancelled when the client leaves.
 *
 * @param {import('express').Response} res
 * @returns {{ sendEvent: (payload: object) => void, signal: AbortSignal, closed: () => boolean }}
 */
function prepareSse(res) {
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
  res.on('close', () => {
    clientGone = true;
    abortController.abort();
  });

  const sendEvent = (payload) => {
    if (clientGone || res.writableEnded) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  return {
    sendEvent,
    signal: abortController.signal,
    closed: () => clientGone,
  };
}

/**
 * Throttle a stream of values, emitting at most one every `ms` milliseconds.
 * The latest value is always flushed once the source stream ends.
 */
async function* throttle(iterable, ms = 40) {
  const wait = (t) => new Promise((resolve) => setTimeout(resolve, t));
  let pending = null;
  let lastEmit = 0;

  for await (const value of iterable) {
    pending = value;
    const now = Date.now();
    if (now - lastEmit >= ms) {
      lastEmit = now;
      yield pending;
      pending = null;
    } else {
      const delay = ms - (now - lastEmit);
      await wait(delay);
      if (pending !== null) {
        lastEmit = Date.now();
        yield pending;
        pending = null;
      }
    }
  }

  if (pending !== null) yield pending;
}

module.exports = { prepareSse, throttle };
