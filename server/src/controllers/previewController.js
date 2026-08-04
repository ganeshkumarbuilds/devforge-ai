const http = require('http');
const crypto = require('crypto');
const net = require('net');
const jwt = require('jsonwebtoken');
const config = require('../config');
const previewService = require('../services/previewService');
const logger = require('../utils/logger');
const HttpError = require('../utils/httpError');
const { requireOwnedProject } = require('../utils/projectAccess');

const TOKEN_COOKIE = 'df_preview';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const UPSTREAM_TIMEOUT_MS = 30000;

function signToken(projectId) {
  return jwt.sign({ scope: 'preview', project: projectId }, config.jwtSecret, { expiresIn: config.preview.previewTokenTtl });
}

function verifyToken(token, projectId) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    return payload.scope === 'preview' && payload.project === projectId;
  } catch {
    return false;
  }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

async function getStatus(req, res) {
  const { id } = req.params;
  await requireOwnedProject(id, req.userId);
  const status = previewService.getStatus(id);
  res.json({ status, token: signToken(id), url: `/api/projects/${id}/preview` });
}

async function start(req, res) {
  const { id } = req.params;
  await requireOwnedProject(id, req.userId);
  const result = await previewService.start(id);
  res.json({ ok: true, ...previewService.getStatus(id), error: result.error || undefined });
}

async function stop(req, res) {
  const { id } = req.params;
  await requireOwnedProject(id, req.userId);
  await previewService.stop(id);
  res.json({ ok: true });
}

async function getLogs(req, res) {
  const { id } = req.params;
  await requireOwnedProject(id, req.userId);
  const after = parseInt(req.query.after || '0', 10) || 0;
  const logs = previewService.getLogs(id, after);
  res.json({ logs });
}

/**
 * Lightweight auth for iframe sub-requests (assets, XHR, images). The
 * generated app cannot send the Authorization header, so it carries a short
 * lived, project-scoped token in a cookie (or the ?token= query on first load).
 */
function previewTokenRequired(req, res, next) {
  const { id } = req.params;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const cookieToken = parseCookies(req.headers.cookie)[TOKEN_COOKIE] || null;
  const token = queryToken || cookieToken;
  if (!verifyToken(token, id)) {
    return next(new HttpError(401, 'Invalid or missing preview token'));
  }
  req.previewToken = token;
  return next();
}

function sanitizeHeaders(headers, hostHeader) {
  const allow = [
    'accept', 'accept-encoding', 'accept-language', 'cache-control',
    'content-type', 'origin', 'referer', 'user-agent', 'cookie',
    'range', 'if-none-match', 'if-modified-since', 'sec-fetch-dest',
    'sec-fetch-mode', 'sec-fetch-site', 'sec-ch-ua', 'sec-ch-ua-mobile',
    'sec-ch-ua-platform', 'priority',
  ];
  const out = {};
  for (const h of allow) {
    if (headers[h] !== undefined) out[h] = headers[h];
  }
  out.host = hostHeader;
  return out;
}

function injectBaseTag(html, id) {
  const baseHref = `/api/projects/${id}/preview/`;
  if (!/<base[ >]/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i, (m, attrs) => `<head${attrs}>\n    <base href="${baseHref}">`);
  }
  // Rewrite Vite/React-refresh absolute module URLs so they resolve through the proxy.
  html = html.replace(/(["'`])\/@vite\//g, (m, q) => `${q}${baseHref}@vite/`);
  html = html.replace(/(["'`])\/@react-refresh\//g, (m, q) => `${q}${baseHref}@react-refresh/`);
  return html;
}

async function proxy(req, res) {
  const { id } = req.params;

  if (!['GET', 'HEAD'].includes(req.method)) {
    return res.status(405).json({ error: 'Preview proxy only supports GET/HEAD requests.' });
  }

  const decoded = decodeURIComponent(req.path);
  if (decoded.split(/[/\\]/).includes('..')) {
    return res.status(400).json({ error: 'Invalid path.' });
  }

  const status = previewService.getStatus(id);
  if (status.state !== 'running' || !status.port) {
    return res.status(503).json({
      error: 'The preview server is not running yet.',
      state: status.state,
      detail: status.error || null,
    });
  }

  // First load via ?token= — persist it in an HttpOnly cookie so asset requests
  // and the HMR websocket authenticate without the Authorization header.
  if (req.query.token && !parseCookies(req.headers.cookie)[TOKEN_COOKIE]) {
    const secure = config.nodeEnv === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${TOKEN_COOKIE}=${req.previewToken}; Path=/; HttpOnly; SameSite=Lax${secure}`);
  }

  const prefix = `/api/projects/${id}/preview`;
  let upstreamPath = req.originalUrl.startsWith(prefix) ? req.originalUrl.slice(prefix.length) : req.originalUrl;
  if (!upstreamPath || upstreamPath === '?') upstreamPath = '/';
  if (req.query.token) {
    upstreamPath = upstreamPath.replace(/([?&])token=[^&]*/, '$1');
    upstreamPath = upstreamPath.replace(/\?$/, '');
  }

  const upstream = http.request(
    {
      hostname: config.preview.host,
      port: status.port,
      method: req.method,
      path: upstreamPath || '/',
      headers: sanitizeHeaders(req.headers, `${config.preview.host}:${status.port}`),
      timeout: UPSTREAM_TIMEOUT_MS,
    },
    (upRes) => {
      res.removeHeader('X-Frame-Options');
      res.removeHeader('Content-Security-Policy');
      res.removeHeader('Content-Security-Policy-Report-Only');
      const headers = { ...upRes.headers };
      delete headers['x-frame-options'];
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      res.writeHead(upRes.statusCode || 502, headers);

      const contentType = String(upRes.headers['content-type'] || '');
      if ((upRes.statusCode || 502) < 400 && /text\/html/i.test(contentType)) {
        const chunks = [];
        upRes.on('data', (c) => chunks.push(c));
        upRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          if (html) html = injectBaseTag(html, id);
          res.end(html);
        });
        upRes.on('error', () => res.end());
      } else {
        upRes.pipe(res);
      }
    }
  );

  upstream.on('timeout', () => {
    upstream.destroy();
    if (!res.headersSent) res.status(504).json({ error: 'The preview server took too long to respond.' });
  });
  upstream.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'The preview server is unavailable.' });
    else res.end();
  });
  upstream.end();
}

/**
 * Websocket (HMR) upgrade proxy. The browser connects to the API origin with
 * the df_preview cookie; we look up the project, verify the token, then open a
 * raw TCP tunnel to the sandboxed preview port.
 */
function handleUpgrade(req, socket, head) {
  const token = parseCookies(req.headers.cookie)[TOKEN_COOKIE] || '';
  let projectId = null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    if (payload.scope === 'preview') projectId = payload.project;
  } catch {
    projectId = null;
  }

  const fail = (statusText) => {
    socket.write(`HTTP/1.1 ${statusText}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
  };

  if (!projectId) return fail('401 Unauthorized');

  const status = previewService.getStatus(projectId);
  if (status.state !== 'running' || !status.port) return fail('503 Service Unavailable');

  const key = req.headers['sec-websocket-key'];
  if (!key) return fail('400 Bad Request');

  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');

  const target = net.connect(status.port, config.preview.host, () => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    if (head && head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });

  target.on('error', () => {
    try {
      socket.destroy();
    } catch { /* ignore */ }
  });
  socket.on('error', () => {
    try {
      target.destroy();
    } catch { /* ignore */ }
  });
}

module.exports = {
  getStatus,
  start,
  stop,
  getLogs,
  previewTokenRequired,
  proxy,
  handleUpgrade,
  parseCookies,
  signToken,
};
