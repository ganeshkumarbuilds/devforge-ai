const BASE_URL = 'https://devforge-ai-mcmt.onrender.com/api';

export function apiOrigin() {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return '';
  }
}

let accessToken = null;
let sessionToken = null;

export function setTokens(token, session) {
  accessToken = token || null;
  sessionToken = session || null;
}

export function getTokens() {
  return { accessToken, sessionToken };
}

export function clearTokens() {
  accessToken = null;
  sessionToken = null;
}

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch(path, { method = 'GET', body, headers = {}, timeout = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const finalHeaders = { ...headers };
  if (body && typeof body !== 'string') {
    finalHeaders['Content-Type'] = 'application/json';
  }
  if (accessToken) {
    finalHeaders.Authorization = `Bearer ${accessToken}`;
  }
  if (sessionToken) {
    finalHeaders['X-Session-Token'] = sessionToken;
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body && typeof body !== 'string' ? JSON.stringify(body) : body,
      signal: controller.signal,
    });

    const session = res.headers.get('x-session-token');
    if (session) sessionToken = session;

    if (res.status === 401) {
      clearTokens();
    }

    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      const message = data && typeof data === 'object' && data.error
        ? data.error
        : `Request failed (${res.status})`;
      throw new ApiError(res.status, message);
    }

    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError(408, 'Request timed out');
    throw new ApiError(0, 'Network error — is the server running?');
  } finally {
    clearTimeout(timer);
  }
}

export { ApiError };

export async function apiBlob(path, { method = 'GET', timeout = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const finalHeaders = {};
  if (accessToken) {
    finalHeaders.Authorization = `Bearer ${accessToken}`;
  }
  if (sessionToken) {
    finalHeaders['X-Session-Token'] = sessionToken;
  }

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      signal: controller.signal,
    });

    if (res.status === 401) clearTokens();

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch { /* keep default */ }
      throw new ApiError(res.status, message);
    }

    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : 'download';

    return { blob: await res.blob(), filename };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError(408, 'Request timed out');
    throw new ApiError(0, 'Network error — is the server running?');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Stream a Server-Sent Events (SSE) endpoint. Invokes `onEvent` with each parsed
 * payload object and resolves once the stream ends or is aborted.
 */
export async function apiStream(path, { method = 'POST', body, onEvent, signal, timeout = 120000 } = {}) {
  const controller = new AbortController();
  const externalSignal = signal || null;
  const timer = setTimeout(() => controller.abort(), timeout);

  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }

  const finalHeaders = { Accept: 'text/event-stream' };
  if (body) finalHeaders['Content-Type'] = 'application/json';
  if (accessToken) finalHeaders.Authorization = `Bearer ${accessToken}`;
  if (sessionToken) finalHeaders['X-Session-Token'] = sessionToken;

  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: finalHeaders,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const session = res.headers.get('x-session-token');
    if (session) sessionToken = session;

    if (res.status === 401) clearTokens();

    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const data = await res.json();
        if (data && data.error) message = data.error;
      } catch { /* keep default */ }
      throw new ApiError(res.status, message);
    }

    if (!res.body) {
      throw new ApiError(0, 'Streaming is not supported by this browser');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleFrame = (frame) => {
      const lines = frame.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          onEvent(JSON.parse(raw));
        } catch { /* ignore malformed event */ }
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop();
      for (const frame of frames) handleFrame(frame);
    }
    if (buffer.trim()) handleFrame(buffer);
  } catch (err) {
    if (externalSignal && externalSignal.aborted) {
      throw new ApiError(499, 'Stream aborted');
    }
    if (err instanceof ApiError) throw err;
    if (err.name === 'AbortError') throw new ApiError(408, 'Request timed out');
    throw new ApiError(0, 'Network error — is the server running?');
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}
