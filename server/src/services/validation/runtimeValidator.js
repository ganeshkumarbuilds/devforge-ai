const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const http = require('http');
const config = require('../../config');
const logger = require('../../utils/logger');
const BuildRunner = require('./BuildRunner');
const DependencyInstaller = require('./DependencyInstaller');
const previewService = require('../previewService');

/**
 * RuntimeValidator — stage 4 of the Build Validation Pipeline. Executes the
 * generated project and proves it actually runs:
 *
 *   1. install dependencies (npm install)
 *   2. build the frontend (npm run build) and the backend when it has a build
 *   3. start the backend and require GET /api/health to answer HTTP 200
 *   4. serve the built frontend and require it to load (HTTP 200 + root node)
 *
 * The backend is left running (keepAlive) so the E2E stage can reuse it; the
 * caller is responsible for stopping it.
 */

function packageExists(dir) {
  return fs.existsSync(path.join(dir, 'package.json'));
}

function readPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

async function installAll(projectId, layout) {
  const steps = [];
  const dirs = [];
  if (layout.clientDir !== null && layout.clientDir !== undefined) dirs.push({ dir: layout.clientDir, label: 'client' });
  if (layout.serverDir !== null && layout.serverDir !== undefined) dirs.push({ dir: layout.serverDir, label: 'server' });

  if (dirs.length === 0) {
    steps.push({ name: 'install', status: 'passed', message: 'No Node.js package directories found.', detail: null, durationMs: 0 });
    return steps;
  }

  const root = previewService.safeProjectDir(projectId);
  for (const d of dirs) {
    const dir = path.join(root, d.dir);
    const t0 = Date.now();
    if (!packageExists(dir)) {
      steps.push({ name: 'install', status: 'failed', message: `No package.json found in ${d.dir}.`, detail: null, durationMs: 0, dir: d.dir });
      continue;
    }
    const res = await DependencyInstaller.install(dir);
    steps.push({
      name: 'install',
      status: res.ok ? 'passed' : 'failed',
      message: res.ok ? `Dependencies installed for ${d.dir}.` : `npm install failed for ${d.dir} (exit ${res.exitCode}).`,
      detail: res.ok ? null : res.output.slice(-60).join('\n'),
      durationMs: res.durationMs,
      dir: d.dir,
    });
  }
  return steps;
}

async function buildFrontend(projectId, layout) {
  if (layout.clientDir === null || layout.clientDir === undefined) return null;
  const clientPath = path.join(previewService.safeProjectDir(projectId), layout.clientDir);
  const t0 = Date.now();
  const res = await BuildRunner.runCommand({
    args: ['run', 'build'],
    cwd: clientPath,
    timeoutMs: config.validationCommandTimeoutMs,
  });
  return {
    name: 'build',
    status: res.ok ? 'passed' : 'failed',
    message: res.ok ? 'Frontend build succeeded.' : `Frontend build failed (exit ${res.exitCode}).`,
    detail: res.ok ? null : res.output.slice(-80).join('\n'),
    durationMs: res.durationMs,
    dir: layout.clientDir,
    ok: res.ok,
  };
}

async function buildBackend(projectId, layout) {
  if (layout.serverDir === null || layout.serverDir === undefined) return null;
  const serverPath = path.join(previewService.safeProjectDir(projectId), layout.serverDir);
  const pkg = readPackage(serverPath);
  const hasBuild = pkg && pkg.scripts && typeof pkg.scripts.build === 'string' && pkg.scripts.build.trim();
  if (!hasBuild) {
    return {
      name: 'backend-build',
      status: 'passed',
      message: 'Backend has no build script — skipped.',
      detail: null,
      durationMs: 0,
      dir: layout.serverDir,
      ok: true,
    };
  }
  const t0 = Date.now();
  const res = await BuildRunner.runCommand({
    args: ['run', 'build'],
    cwd: serverPath,
    timeoutMs: config.validationCommandTimeoutMs,
  });
  return {
    name: 'backend-build',
    status: res.ok ? 'passed' : 'failed',
    message: res.ok ? 'Backend build succeeded.' : `Backend build failed (exit ${res.exitCode}).`,
    detail: res.ok ? null : res.output.slice(-80).join('\n'),
    durationMs: res.durationMs,
    dir: layout.serverDir,
    ok: res.ok,
  };
}

/**
 * Start the backend and require GET /api/health to answer 200.
 * @returns {{ step: object, ok: boolean, backend: { port, host, child, base }|null }}
 */
async function startBackendLive(projectId, layout) {
  if (layout.serverDir === null || layout.serverDir === undefined) {
    return { ok: true, step: { name: 'start', status: 'passed', message: 'No backend detected — skipped.', detail: null, durationMs: 0 }, backend: null };
  }

  const serverPath = path.join(previewService.safeProjectDir(projectId), layout.serverDir);
  const entry = layout.entry || resolveEntry(layout.serverDir, serverPath);
  const t0 = Date.now();
  const res = await BuildRunner.runServer({
    entry,
    cwd: serverPath,
    timeoutMs: config.validationStartTimeoutMs,
    keepAlive: true,
  });

  if (!res.ok) {
    return {
      ok: false,
      step: {
        name: 'start',
        status: 'failed',
        message: `Backend failed to start${res.exitCode != null ? ` (exit ${res.exitCode})` : ''}.`,
        detail: res.output.slice(-80).join('\n'),
        durationMs: res.durationMs,
        dir: layout.serverDir,
      },
      backend: null,
    };
  }

  const backend = { port: res.port, host: '127.0.0.1', child: res.child, base: `http://127.0.0.1:${res.port}` };

  // Health probe: GET /api/health must answer 200.
  const health = await BuildRunner.httpGet(backend.host, backend.port, '/api/health', config.validationHealthTimeoutMs);
  const healthOk = Boolean(health && health.status === 200);
  if (!healthOk) {
    return {
      ok: false,
      step: {
        name: 'start',
        status: 'failed',
        message: 'Backend started but GET /api/health did not return HTTP 200.',
        detail: health ? `GET /api/health returned HTTP ${health.status}.` : 'GET /api/health did not respond in time.',
        durationMs: Date.now() - t0,
        dir: layout.serverDir,
      },
      backend,
    };
  }

  return {
    ok: true,
    step: {
      name: 'start',
      status: 'passed',
      message: 'Backend started and GET /api/health returned HTTP 200.',
      detail: null,
      durationMs: Date.now() - t0,
      dir: layout.serverDir,
    },
    backend,
  };
}

function resolveEntry(serverDir, serverPath) {
  const pkg = readPackage(serverPath);
  if (pkg && pkg.scripts && typeof pkg.scripts.start === 'string') {
    const m = pkg.scripts.start.match(/node\s+([^\s&|;]+)/);
    if (m) {
      const rel = m[1].replace(/^\.\//, '');
      const abs = path.join(serverPath, rel);
      if (fs.existsSync(abs)) return rel;
    }
  }
  for (const e of ['server.js', 'index.js', 'app.js', 'main.js', 'src/index.js', 'src/server.js', 'src/app.js']) {
    if (fs.existsSync(path.join(serverPath, e))) return e;
  }
  return 'server.js';
}

/**
 * Serve the built frontend (dist/) and verify it loads.
 * @returns {{ step: object, ok: boolean, server: { port, url, close }|null }}
 */
async function verifyFrontendLoads(projectId, layout) {
  if (layout.clientDir === null || layout.clientDir === undefined) {
    return { ok: true, step: { name: 'frontend-load', status: 'passed', message: 'No frontend detected — skipped.', detail: null, durationMs: 0 }, server: null };
  }

  const t0 = Date.now();
  const clientPath = path.join(previewService.safeProjectDir(projectId), layout.clientDir);
  const distDir = path.join(clientPath, 'dist');
  if (!fs.existsSync(distDir)) {
    return {
      ok: false,
      step: {
        name: 'frontend-load',
        status: 'failed',
        message: 'Frontend build output (dist/) is missing.',
        detail: null,
        durationMs: Date.now() - t0,
        dir: layout.clientDir,
      },
      server: null,
    };
  }

  const server = await serveStatic(distDir);
  const result = await BuildRunner.httpGet('127.0.0.1', server.port, '/', config.validationFrontendHealthTimeoutMs);

  let html = '';
  if (result && result.status === 200) {
    html = await httpGetText('127.0.0.1', server.port, '/').catch(() => '');
  }
  const hasRoot = /id\s*=\s*["']root["']/.test(html);
  const ok = Boolean(result && result.status === 200 && hasRoot);

  return {
    ok,
    step: {
      name: 'frontend-load',
      status: ok ? 'passed' : 'failed',
      message: ok
        ? 'Frontend build loaded successfully (HTTP 200).'
        : `Frontend load check failed${result ? ` (HTTP ${result.status})` : ' (no response)'}.`,
      detail: ok ? null : `The built frontend at ${distDir} did not serve a page with a #root element.`,
      durationMs: Date.now() - t0,
      dir: layout.clientDir,
    },
    server,
  };
}

function serveStatic(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/index.html';
      const abs = path.resolve(path.join(rootDir, `.${urlPath}`));
      if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      fs.readFile(abs, (err, data) => {
        if (err) {
          res.writeHead(404);
          return res.end('Not found');
        }
        res.writeHead(200, { 'content-type': mimeFor(abs) });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function httpGetText(host, port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: pathname, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

function mimeFor(abs) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.woff2': 'font/woff2',
    '.ico': 'image/x-icon',
  };
  return map[path.extname(abs).toLowerCase()] || 'application/octet-stream';
}

module.exports = { installAll, buildFrontend, buildBackend, startBackendLive, verifyFrontendLoads, serveStatic };
