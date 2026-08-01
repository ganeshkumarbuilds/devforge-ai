const BASE_URL = '/api';

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
