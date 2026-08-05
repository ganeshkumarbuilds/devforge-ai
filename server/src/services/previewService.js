const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const config = require('../config');
const { generatedDir } = require('../config');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

const preview = config.preview;
const usedPorts = new Set();
const portCooldown = new Set();
const sessions = new Map();
// Guards concurrent start() calls for the same project so two requests cannot
// race — each would stop the other's freshly spawned server.
const startInFlight = new Map();

const LOG_LEVELS = ['system', 'install', 'run', 'error', 'warn'];

const FRAMEWORK_LABELS = {
  next: 'Next.js',
  nest: 'NestJS',
  vite: 'Vite (React/Vue/Svelte)',
  cra: 'Create React App',
  angular: 'Angular',
  sveltekit: 'SvelteKit',
  express: 'Express (Node)',
  node: 'Node.js',
};

// Subdirectories that may hold the runnable package when the root has none
// (e.g. full-stack projects with a separate client/ and server/).
const SUBDIR_CANDIDATES = ['client', 'web', 'frontend', 'front', 'server', 'api', 'backend', 'app'];

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function safeProjectDir(projectId) {
  const root = path.resolve(generatedDir);
  const dir = path.resolve(path.join(generatedDir, projectId));
  if (dir !== root && !dir.startsWith(root + path.sep)) {
    throw new Error('Invalid project directory');
  }
  return dir;
}

function allocatePort() {
  const start = preview.portStart;
  const end = start + preview.portCount - 1;
  for (let p = start; p <= end; p++) {
    if (!usedPorts.has(p) && !portCooldown.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  return null;
}

function releasePort(port) {
  if (!port) return;
  usedPorts.delete(port);
  // Briefly hold the port so a fast restart does not hit EADDRINUSE while the
  // previous process is still tearing down.
  portCooldown.add(port);
  setTimeout(() => portCooldown.delete(port), 5000).unref();
}

// Build the Host header for a connection, bracketing IPv6 literals.
function hostHeader(host, port) {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

function buildChildEnv(port, { production = false } = {}) {
  // Never leak host secrets (OpenRouter key, JWT secret, database URL…) into
  // the generated project. Pass only what a dev server needs to boot.
  const env = {};
  for (const key of [
    'PATH', 'Path', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE',
    'TMP', 'TEMP', 'TMPDIR', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive',
    'COMPUTERNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.PORT = String(port);
  env.HOST = preview.host;
  env.NODE_ENV = production ? 'production' : 'development';
  return env;
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  const pid = proc.pid;
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
    } catch { /* ignore */ }
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        proc.kill('SIGTERM');
      } catch { /* ignore */ }
    }
    setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch { /* ignore */ }
    }, 3000).unref();
  }
}

function tcpConnectOk(host, port, timeoutMs = 700) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.connect(port, host);
  });
}

// The generated server may bind to 127.0.0.1, ::1, or 0.0.0.0 depending on the
// framework/host configuration — probe every loopback host before giving up.
async function probeHosts(port) {
  if (port == null) return null;
  const hosts = [preview.host];
  if (!hosts.includes('::1')) hosts.push('::1');
  if (!hosts.includes('localhost')) hosts.push('localhost');
  const results = await Promise.all(hosts.map((h) => tcpConnectOk(h, port).then((ok) => (ok ? h : null))));
  return results.find(Boolean) || null;
}

// Best-effort HTTP health probe. Any HTTP status means the right kind of
// server is up; a hang or connection error means it is not (yet) ready.
function httpProbe(host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host,
        port,
        method: 'GET',
        path: '/',
        timeout: timeoutMs,
        headers: { host: hostHeader(host, port), accept: '*/*', 'user-agent': 'DevForge-Preview' },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode || 200);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

function waitForPort(session, timeoutMs, onTick) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (session.stopping) return resolve({ ok: false, host: null });
      // If the process exited while we were waiting, the close handler already
      // released the port — fail fast instead of probing an invalid port.
      if (session.port == null) return resolve({ ok: false, host: null });
      const host = await probeHosts(session.port);
      if (host) {
        session.push('system', `Health check: port ${session.port} is reachable on ${host}.`);
        const status = await httpProbe(host, session.port);
        if (status) {
          session.push('system', `Health check: HTTP GET / responded with status ${status}.`);
          logger.info(`[Preview] ${session.projectId}: health check OK (HTTP ${status}) on ${host}:${session.port}.`);
        } else {
          session.push('system', `Health check: TCP open on ${host}:${session.port} (no HTTP response on GET / — accepted).`);
          logger.info(`[Preview] ${session.projectId}: health check OK (TCP only) on ${host}:${session.port}.`);
        }
        return resolve({ ok: true, host });
      }
      if (Date.now() - start > timeoutMs) return resolve({ ok: false, host: null });
      if (onTick) onTick();
      setTimeout(tick, 400);
    };
    tick();
  });
}

class PreviewSession {
  constructor(projectId, dir) {
    this.projectId = projectId;
    this.dir = dir;
    this.state = 'idle'; // idle | installing | starting | running | failed
    this.port = null;
    this.host = null;
    this.pid = null;
    this.process = null;
    this.stopping = false;
    this.buildId = 0;
    this.startedAt = null;
    this.script = null;
    this.framework = null;
    this.error = null;
    this.logs = [];
    this._subscribers = new Set();
  }

  push(level, message) {
    const line = {
      ts: new Date().toISOString(),
      level: LOG_LEVELS.includes(level) ? level : 'run',
      message: String(message).replace(/\u0000/g, ''),
    };
    this.logs.push(line);
    if (this.logs.length > preview.maxLogLines) {
      this.logs.splice(0, this.logs.length - preview.maxLogLines);
    }
    this._emit({ type: 'log', line });
  }

  setState(state, error = null) {
    this.state = state;
    if (error) this.error = error;
    else if (state === 'running') this.error = null;
    if (state === 'running' && !this.startedAt) this.startedAt = new Date().toISOString();
    if (state === 'running') this.buildId += 1;
    this._emit({ type: 'state', state, error: this.error, buildId: this.buildId });
  }

  bump() {
    this.buildId += 1;
    this._emit({ type: 'state', state: this.state, error: this.error, buildId: this.buildId });
  }

  subscribe(cb) {
    this._subscribers.add(cb);
    return () => this._subscribers.delete(cb);
  }

  _emit(payload) {
    for (const cb of this._subscribers) {
      try {
        cb(payload);
      } catch { /* ignore */ }
    }
  }
}

function getSession(projectId) {
  if (!sessions.has(projectId)) {
    const dir = safeProjectDir(projectId);
    sessions.set(projectId, new PreviewSession(projectId, dir));
  }
  return sessions.get(projectId);
}

function getStatus(projectId) {
  if (!preview.enabled) return { state: 'disabled', enabled: false };
  const session = sessions.get(projectId);
  if (!session) {
    return { state: 'idle', enabled: true, port: null, host: null, buildId: 0, running: false };
  }
  return {
    enabled: true,
    state: session.state,
    port: session.port,
    host: session.host || null,
    pid: session.pid,
    buildId: session.buildId,
    running: session.state === 'running',
    startedAt: session.startedAt,
    script: session.script,
    framework: session.framework || null,
    error: session.error,
    logCount: session.logs.length,
  };
}

function getLogs(projectId, after = 0) {
  const session = sessions.get(projectId);
  if (!session) return [];
  return session.logs.slice(after);
}

function subscribe(projectId, cb) {
  return getSession(projectId).subscribe(cb);
}

async function stop(projectId) {
  const session = sessions.get(projectId);
  if (!session) return { ok: true, wasRunning: false };
  if (session.process) {
    session.stopping = true;
    killProcessTree(session.process);
  }
  releasePort(session.port);
  session.port = null;
  session.host = null;
  session.pid = null;
  session.process = null;
  session.stopping = false;
  if (session.state === 'running' || session.state === 'starting' || session.state === 'installing') {
    session.setState('idle');
  }
  sessions.delete(projectId);
  return { ok: true, wasRunning: true };
}

function tryReadPackage(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Framework detection — React (Vite), Next.js, NestJS, Express, CRA, Angular,
// SvelteKit and plain Node each boot differently. Instead of blindly appending
// "--port", we pick the right script and the right way to pass the port.
// ---------------------------------------------------------------------------

function detectFramework(pkg) {
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const scripts = pkg.scripts || {};
  const joined = Object.values(scripts).filter(Boolean).join(' ');

  if (deps.next || /(^|\s)next\s+(dev|start|build|server)\b/.test(joined)) return 'next';
  if (deps['@nestjs/core'] || deps['@nestjs/common']) return 'nest';
  if (deps['@sveltejs/kit']) return 'sveltekit';
  if (deps.vite || /(^|\s)vite\b/.test(joined)) return 'vite';
  if (deps['react-scripts'] || deps['@craco/craco'] || /react-scripts\s+start/.test(joined)) return 'cra';
  if (deps['@angular/core'] || /(^|\s)ng\s+serve/.test(joined)) return 'angular';
  if (deps.express || deps.koa || deps.fastify || deps.hapi || deps['@hapi/hapi']) return 'express';
  return 'node';
}

function buildRunPlan(pkg) {
  const framework = detectFramework(pkg);
  const scripts = pkg.scripts || {};
  const has = (s) => typeof scripts[s] === 'string' && scripts[s].trim().length > 0;
  const devCandidates = ['dev', 'start:dev', 'serve', 'preview', 'develop'];

  const plan = { framework, script: null, buildScript: null, devServer: false };
  const startFirst = (has('start') && 'start') || devCandidates.find(has) || null;
  const devFirst = devCandidates.find(has) || (has('start') && 'start') || null;

  switch (framework) {
    case 'next':
      // Prefer the on-the-fly dev server (works even when `.next` was wiped by
      // an ephemeral filesystem). Fall back to production `start` — with a
      // build step — when no dev script exists.
      plan.script = devFirst;
      if (plan.script === 'start') {
        if (has('build')) plan.buildScript = 'build';
      } else if (plan.script) {
        plan.devServer = true;
      }
      break;
    case 'vite':
    case 'sveltekit':
      plan.script = devFirst;
      plan.devServer = true;
      break;
    case 'nest':
      plan.script = devFirst;
      break;
    case 'cra':
      // react-scripts reads PORT/HOST from the environment.
      plan.script = startFirst;
      plan.devServer = true;
      break;
    case 'angular':
      plan.script = startFirst;
      plan.devServer = true;
      break;
    default: // express, node, generic — these read process.env.PORT.
      plan.script = startFirst;
      break;
  }
  return plan;
}

// The CLI flags each framework understands for the chosen port/host. Returned
// as extra args passed to `npm run <script> -- <args>`.
function cliPortArgs(framework, port) {
  switch (framework) {
    case 'vite':
    case 'sveltekit':
      return ['--port', String(port), '--host', preview.host];
    case 'next':
      return ['-p', String(port), '-H', preview.host];
    case 'angular':
      return ['--port', String(port)];
    default:
      return [];
  }
}

function hasRunnableScript(pkg) {
  return Boolean(pkg && buildRunPlan(pkg).script);
}

// Locate the directory that actually contains a runnable package. Prefers the
// root, but falls back to known subdirectories for full-stack projects and
// workspace roots whose own manifest has no runnable script.
function resolveRunDir(dir) {
  if (hasRunnableScript(tryReadPackage(dir))) return dir;
  for (const sub of SUBDIR_CANDIDATES) {
    const candidate = path.join(dir, sub);
    if (hasRunnableScript(tryReadPackage(candidate))) return candidate;
  }
  return dir;
}

async function installDependencies(session) {
  session.setState('installing');
  session.push('system', `Installing dependencies with npm… (this can take a while)`);
  const ok = await runChild(session, {
    cmd: npmBin(),
    args: ['install', '--no-audit', '--no-fund', '--loglevel=error'],
    source: 'install',
    timeoutMs: preview.installTimeoutMs,
    timeoutMessage: 'Dependency installation timed out.',
  });
  if (!ok) return false;
  session.push('system', 'Dependencies installed.');
  return true;
}

function runChild(session, { cmd, args, source, timeoutMs, timeoutMessage, production = false }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: session.dir,
      env: buildChildEnv(session.port, { production }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Node >=20.19 rejects spawning .cmd/.bat directly; run through a shell.
      shell: process.platform === 'win32',
    });

    const timer = setTimeout(() => {
      session.push('error', timeoutMessage);
      killProcessTree(child);
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      const text = String(d).replace(/\r?\n$/, '');
      for (const line of text.split(/\r?\n/)) {
        if (line) session.push(source, line);
      }
    });
    child.stderr.on('data', (d) => {
      const text = String(d).replace(/\r?\n$/, '');
      for (const line of text.split(/\r?\n/)) {
        if (line) session.push('error', line);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      session.push('error', `Failed to start: ${err.message}`);
      resolve(false);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      logger.info(`[Preview] ${session.projectId}: "${cmd} ${args.join(' ')}" finished with code ${code}.`);
      resolve(code === 0);
    });
  });
}

async function startInternal(projectId, { install = true } = {}) {
  // Stop any existing session first so a re-run always starts fresh.
  await stop(projectId);

  const root = safeProjectDir(projectId);
  const session = getSession(projectId);

  // -------------------------------------------------------------------------
  // Stage 1 — restore: generated projects live in the database; the on-disk
  // copy can be wiped by a server restart or Render's ephemeral filesystem.
  // If the directory (or its manifest) is missing, rebuild it from the DB.
  // -------------------------------------------------------------------------
  const dirExists = fs.existsSync(root);
  const pkgExists = fs.existsSync(path.join(root, 'package.json'));
  if (!dirExists || !pkgExists) {
    session.push('system', `Generated project directory missing${dirExists ? ' (no package.json)' : ''} — restoring from the database…`);
    logger.info(`[Preview] ${projectId}: on-disk project missing, restoring from database.`);
    try {
      const count = await syncProjectToDisk(projectId);
      if (count === 0) {
        session.push('system', 'The database holds no generated files for this project.');
        logger.warn(`[Preview] ${projectId}: restore found 0 files in the database.`);
      } else {
        session.push('system', `Restored ${count} file(s) from the database.`);
        logger.info(`[Preview] ${projectId}: restored ${count} file(s) from the database.`);
      }
    } catch (err) {
      logger.error(`[Preview] ${projectId}: restore from database failed: ${err.message}`);
      session.setState('failed', `Failed to restore the project from the database: ${err.message}`);
      return { ok: false, error: session.error };
    }
  } else {
    session.push('system', 'Project files already present on disk.');
  }

  if (!fs.existsSync(path.join(root, 'package.json'))) {
    session.setState('failed', 'The project has no package.json and could not be restored from the database.');
    return { ok: false, error: session.error };
  }

  const port = allocatePort();
  if (!port) {
    session.setState('failed', 'No preview ports available. Increase PREVIEW_PORT_COUNT or stop other previews.');
    return { ok: false, error: session.error };
  }
  session.port = port;

  try {
    // Resolve the runnable package (root, or a client/server subdirectory).
    const runDir = resolveRunDir(root);
    if (runDir !== root) {
      session.dir = runDir;
      const rel = path.relative(root, runDir) || '.';
      session.push('system', `Found runnable package in "${rel}".`);
      logger.info(`[Preview] ${projectId}: running from subdirectory "${rel}".`);
    }
    const pkg = tryReadPackage(session.dir);
    if (!pkg) {
      session.setState('failed', 'No package.json found in the generated project. The project may not be a Node.js app.');
      releasePort(port);
      session.port = null;
      return { ok: false, error: session.error };
    }

    const plan = buildRunPlan(pkg);
    if (!plan.script) {
      session.setState('failed', 'package.json has no start/dev/serve script to run.');
      releasePort(port);
      session.port = null;
      return { ok: false, error: session.error };
    }
    session.script = plan.script;
    session.framework = plan.framework;
    const label = FRAMEWORK_LABELS[plan.framework] || plan.framework;
    session.push('system', `Detected ${label}. Starting via "npm run ${plan.script}"${plan.buildScript ? ` (with "npm run ${plan.buildScript}" first)` : ''}.`);
    logger.info(`[Preview] ${projectId}: framework=${plan.framework} script=${plan.script}${plan.buildScript ? ` build=${plan.buildScript}` : ''}.`);

    // -----------------------------------------------------------------------
    // Stage 2 — install: only when requested or when dependencies are missing
    // (node_modules is not persisted on Render's ephemeral filesystem).
    // -----------------------------------------------------------------------
    const needsInstall = install || !fs.existsSync(path.join(session.dir, 'node_modules'));
    if (needsInstall) {
      logger.info(`[Preview] ${projectId}: installing dependencies in ${session.dir}.`);
      if (!await installDependencies(session)) {
        session.setState('failed', 'Dependency installation failed. See the preview terminal for details.');
        releasePort(port);
        session.port = null;
        return { ok: false, error: session.error };
      }
    } else {
      session.push('system', 'Dependencies already installed — skipping npm install.');
      logger.info(`[Preview] ${projectId}: dependencies present, skipping install.`);
    }

    // Some frameworks (e.g. Next.js production `start`) need a build first.
    if (plan.buildScript) {
      session.push('system', `Running "npm run ${plan.buildScript}" before start…`);
      logger.info(`[Preview] ${projectId}: running pre-build script "${plan.buildScript}".`);
      const built = await runChild(session, {
        cmd: npmBin(),
        args: ['run', plan.buildScript],
        source: 'build',
        timeoutMs: preview.startTimeoutMs,
        timeoutMessage: 'Pre-build timed out.',
        production: true,
      });
      if (!built) {
        session.setState('failed', `Pre-build ("${plan.buildScript}") failed. See the preview terminal for details.`);
        releasePort(port);
        session.port = null;
        return { ok: false, error: session.error };
      }
    }

    // -----------------------------------------------------------------------
    // Stage 3 — start: launch with framework-appropriate CLI flags + env vars
    // (no more blind "--port" injection into scripts that don't understand it).
    // -----------------------------------------------------------------------
    session.setState('starting');
    session.push('system', `Starting "npm run ${plan.script}" on http://${preview.host}:${port}`);
    logger.info(`[Preview] ${projectId}: starting "${plan.script}" (${plan.framework}) on port ${port}.`);

    // Production mode is only meaningful when compiled output is being served
    // (Next.js `start` after a build). Dev servers keep NODE_ENV=development.
    const productionMode = Boolean(plan.buildScript) || (plan.framework === 'next' && plan.script === 'start');
    const extraArgs = cliPortArgs(plan.framework, port);
    const spawnArgs = ['run', plan.script, ...(extraArgs.length ? ['--', ...extraArgs] : [])];
    session.process = spawn(npmBin(), spawnArgs, {
      cwd: session.dir,
      env: buildChildEnv(port, { production: productionMode }),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Node >=20.19 rejects spawning .cmd/.bat directly; run through a shell.
      shell: process.platform === 'win32',
    });
    session.pid = session.process.pid;

    session.process.stdout.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        if (line) session.push('run', line);
      }
    });
    session.process.stderr.on('data', (d) => {
      for (const line of String(d).split(/\r?\n/)) {
        if (line) session.push('error', line);
      }
    });
    session.process.on('error', (err) => {
      session.push('error', `Failed to launch process: ${err.message}`);
    });
    session.process.on('close', (code) => {
      // Only treat an exit as a failure when it wasn't an intentional stop
      // (stop() nulls session.process, so a racing close is ignored).
      const stillOwned = session.process !== null && !session.stopping;
      releasePort(session.port);
      session.port = null;
      session.host = null;
      session.pid = null;
      logger.info(`[Preview] ${projectId}: preview process exited${code == null ? '' : ` with code ${code}`}.`);
      if (stillOwned) {
        session.push('error', `Preview server exited${code == null ? '' : ` with code ${code}`}.`);
        session.setState('failed', code == null ? 'Preview server stopped unexpectedly.' : `Preview server exited with code ${code}.`);
      }
    });

    // -----------------------------------------------------------------------
    // Stage 4 — health check: wait until the server accepts connections (and
    // ideally answers an HTTP request) on the allocated port.
    // -----------------------------------------------------------------------
    let lastWaitLog = 0;
    const health = await waitForPort(session, preview.startTimeoutMs, () => {
      const now = Date.now();
      if (now - lastWaitLog > 3000) {
        lastWaitLog = now;
        session.push('system', 'Waiting for the preview server to accept connections…');
      }
    });

    if (session.stopping) {
      killProcessTree(session.process);
      return { ok: true, stopped: true };
    }

    if (health.ok) {
      session.host = health.host;
      session.setState('running');
      session.push('system', `Preview is live at http://${hostHeader(health.host, port)} (${label}).`);
      logger.info(`[Preview] ${projectId}: preview live on http://${hostHeader(health.host, port)} (${plan.framework}).`);
      return { ok: true, port, host: health.host };
    }

    session.setState('failed', `The app did not listen on port ${port} within ${Math.round(preview.startTimeoutMs / 1000)}s. Make sure the server reads process.env.PORT (or runs on a configurable port).`);
    killProcessTree(session.process);
    releasePort(port);
    session.port = null;
    return { ok: false, error: session.error };
  } catch (err) {
    releasePort(port);
    session.port = null;
    session.setState('failed', err.message);
    return { ok: false, error: err.message };
  }
}

async function start(projectId, options = {}) {
  if (!preview.enabled) {
    return { ok: false, error: 'Live preview is disabled on this server.' };
  }
  if (startInFlight.has(projectId)) return startInFlight.get(projectId);
  const promise = startInternal(projectId, options);
  startInFlight.set(projectId, promise);
  try {
    return await promise;
  } finally {
    startInFlight.delete(projectId);
  }
}

async function restart(projectId, { reinstall = false } = {}) {
  const session = sessions.get(projectId);
  if (session && session.process) {
    session.stopping = true;
    killProcessTree(session.process);
    await new Promise((r) => setTimeout(r, 600));
  }
  await stop(projectId);
  return start(projectId, { install: reinstall });
}

/**
 * Sync the project's files from the database onto disk so the preview server
 * serves the current (possibly restored) state. Called automatically whenever
 * the on-disk copy is missing (server restart, Render ephemeral filesystem).
 */
async function syncProjectToDisk(projectId) {
  const root = safeProjectDir(projectId);
  await fsp.mkdir(root, { recursive: true });
  const files = await prisma.projectFile.findMany({
    where: { projectId },
    select: { path: true, content: true },
  });
  for (const f of files) {
    const absolute = path.resolve(path.join(root, f.path));
    if (absolute !== root && !absolute.startsWith(root + path.sep)) continue;
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, f.content, 'utf8');
  }
  logger.info(`[Preview] syncProjectToDisk(${projectId}): wrote ${files.length} file(s) to ${root}.`);
  return files.length;
}

async function cleanupAll() {
  const ids = [...sessions.keys()];
  await Promise.all(ids.map((id) => stop(id)));
}

module.exports = {
  getStatus,
  getLogs,
  subscribe,
  start,
  stop,
  restart,
  cleanupAll,
  safeProjectDir,
  syncProjectToDisk,
  hostHeader,
};
