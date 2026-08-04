const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const config = require('../config');
const { generatedDir } = require('../config');
const prisma = require('../lib/prisma');
const logger = require('../utils/logger');

const preview = config.preview;
const usedPorts = new Set();
const sessions = new Map();

const LOG_LEVELS = ['system', 'install', 'run', 'error', 'warn'];

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
    if (!usedPorts.has(p)) {
      usedPorts.add(p);
      return p;
    }
  }
  return null;
}

function releasePort(port) {
  if (port) usedPorts.delete(port);
}

function buildChildEnv(port) {
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
  env.NODE_ENV = 'development';
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

function connectOk(port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok) => {
      socket.destroy();
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.connect(port, preview.host);
  });
}

function waitForPort(port, timeoutMs, onTick) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = async () => {
      if (await connectOk(port)) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
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
    this.pid = null;
    this.process = null;
    this.stopping = false;
    this.buildId = 0;
    this.startedAt = null;
    this.script = null;
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
    return { state: 'idle', enabled: true, port: null, buildId: 0, running: false };
  }
  return {
    enabled: true,
    state: session.state,
    port: session.port,
    pid: session.pid,
    buildId: session.buildId,
    running: session.state === 'running',
    startedAt: session.startedAt,
    script: session.script,
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
  session.pid = null;
  session.process = null;
  session.stopping = false;
  if (session.state === 'running' || session.state === 'starting' || session.state === 'installing') {
    session.setState('idle');
  }
  sessions.delete(projectId);
  return { ok: true, wasRunning: true };
}

function readPackage(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`No package.json found in the generated project (${path.basename(dir)}). The project may not be a Node.js app.`);
  }
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch {
    throw new Error('package.json is invalid JSON and cannot be parsed.');
  }
}

const PREFERRED_SCRIPTS = ['start', 'dev', 'serve', 'preview', 'start:dev', 'develop'];
const DEV_SCRIPTS = new Set(['dev', 'serve', 'preview', 'start:dev', 'develop']);

function pickScript(pkg) {
  const scripts = pkg.scripts || {};
  for (const s of PREFERRED_SCRIPTS) {
    if (typeof scripts[s] === 'string' && scripts[s].trim()) return s;
  }
  return null;
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

function runChild(session, { cmd, args, source, timeoutMs, timeoutMessage }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: session.dir,
      env: buildChildEnv(session.port),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
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
      resolve(code === 0);
    });
  });
}

async function start(projectId, { install = true } = {}) {
  if (!preview.enabled) {
    return { ok: false, error: 'Live preview is disabled on this server.' };
  }

  // Stop any existing session first so a re-run always starts fresh.
  await stop(projectId);

  const dir = safeProjectDir(projectId);
  const session = getSession(projectId);

  if (!fs.existsSync(dir)) {
    session.setState('failed', `Generated project directory does not exist on disk (${dir}).`);
    return { ok: false, error: session.error };
  }

  const port = allocatePort();
  if (!port) {
    session.setState('failed', 'No preview ports available. Increase PREVIEW_PORT_COUNT or stop other previews.');
    return { ok: false, error: session.error };
  }
  session.port = port;

  try {
    const pkg = readPackage(dir);
    if (install) {
      if (!await installDependencies(session)) {
        session.setState('failed', 'Dependency installation failed. See the preview terminal for details.');
        releasePort(port);
        session.port = null;
        return { ok: false, error: session.error };
      }
    } else {
      session.push('system', 'Skipping dependency install (restart).');
    }

    const script = pickScript(pkg);
    if (!script) {
      session.setState('failed', 'package.json has no start/dev/serve script to run.');
      releasePort(port);
      session.port = null;
      return { ok: false, error: session.error };
    }
    session.script = script;

    session.setState('starting');
    session.push('system', `Starting "${script}" on http://${preview.host}:${port}`);
    session.process = spawn(npmBin(), ['run', script, ...(DEV_SCRIPTS.has(script) ? ['--', '--port', String(port), '--host', preview.host] : [])], {
      cwd: dir,
      env: buildChildEnv(port),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
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
      if (!session.stopping) {
        session.push('error', `Preview server exited${code == null ? '' : ` with code ${code}`}.`);
        session.setState('failed', code == null ? 'Preview server stopped unexpectedly.' : `Preview server exited with code ${code}.`);
      }
    });

    let lastWaitLog = 0;
    const listening = await waitForPort(port, preview.startTimeoutMs, () => {
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

    if (listening) {
      session.setState('running');
      session.push('system', `Preview is live at http://${preview.host}:${port}`);
      return { ok: true, port };
    }

    session.setState('failed', `The app did not listen on port ${port} within ${Math.round(preview.startTimeoutMs / 1000)}s. Make sure the server reads process.env.PORT (or run it on a fixed port).`);
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
 * serves the current (possibly restored) state.
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
};
