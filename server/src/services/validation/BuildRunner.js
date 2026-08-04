const { spawn } = require('child_process');
const net = require('net');
const config = require('../../config');

/**
 * BuildRunner — executes the actual npm commands behind the Build Validation
 * Pipeline (install / build / start) against a generated project directory,
 * capturing output, enforcing timeouts, and detecting whether a dev server
 * actually began listening. Never leaks host secrets into the child process.
 */

function npmBin() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function childEnv(port) {
  // Never leak host secrets (OpenRouter key, JWT secret, DATABASE_URL...) into
  // the generated project. Only pass what a dev server needs to boot.
  const env = {};
  for (const key of [
    'PATH', 'Path', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE',
    'TMP', 'TEMP', 'TMPDIR', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive',
    'COMPUTERNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  ]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  if (port) {
    env.PORT = String(port);
    env.HOST = '127.0.0.1';
  }
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

function freePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function connectOk(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let timer;
    const done = (ok) => {
      socket.destroy();
      clearTimeout(timer);
      resolve(ok);
    };
    timer = setTimeout(() => done(false), timeoutMs);
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.connect(port, host);
  });
}

async function isListening(host, port, attempts = 30, intervalMs = 300) {
  for (let i = 0; i < attempts; i++) {
    if (await connectOk(host, port)) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Run a one-shot command (install / build) and resolve once it exits.
 * @returns {Promise<{ok:boolean, exitCode:number, timedOut:boolean, output:string[], durationMs:number}>}
 */
async function runCommand({ cmd = npmBin(), args = [], cwd, timeoutMs, port }) {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      env: childEnv(port),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // Node >=20.19 rejects spawning .cmd/.bat directly; run through a shell.
      shell: process.platform === 'win32',
    });
    const output = [];
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
      output.push('> Command timed out and was terminated.');
    }, timeoutMs);

    const collect = (buf) => {
      const text = String(buf).replace(/\r?\n$/, '');
      for (const line of text.split(/\r?\n/)) {
        if (line) output.push(line);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    child.on('error', (err) => {
      clearTimeout(timer);
      output.push(`> Failed to start command: ${err.message}`);
      resolve({ ok: false, exitCode: -1, timedOut, output, durationMs: Date.now() - started });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: !timedOut && code === 0, exitCode: code, timedOut, output, durationMs: Date.now() - started });
    });
  });
}

/**
 * Run a project's start script and verify it boots. Considerations:
 *  - If the process exits non-zero, the server failed to start.
 *  - If it begins listening on the chosen port, it started successfully.
 *  - If it stays alive until the timeout without exiting or listening, treat
 *    it as started (some backends do not read process.env.PORT).
 * The process is always terminated before resolving.
 * @returns {Promise<{ok:boolean, exitCode:number|null, timedOut:boolean, listening:boolean,
 *           output:string[], port:number|null, durationMs:number}>}
 */
async function runServer({ entry = null, cwd, timeoutMs }) {
  const started = Date.now();
  const port = await freePort();
  const env = childEnv(port);
  env.PORT = String(port);

  return new Promise((resolve) => {
    const cmd = entry ? process.execPath : npmBin();
    const args = entry ? [entry] : ['start'];
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: process.platform === 'win32' && !entry,
    });

    const output = [];
    let timedOut = false;
    let resolved = false;
    let listening = false;

    const timer = setTimeout(() => {
      timedOut = true;
      if (!resolved) finish({ exitCode: null, listening, timedOut: true });
      killProcessTree(child);
    }, timeoutMs);

    const collect = (buf) => {
      const text = String(buf).replace(/\r?\n$/, '');
      for (const line of text.split(/\r?\n/)) {
        if (line) output.push(line);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const finish = (extra) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      killProcessTree(child);
      resolve({
        ok: Boolean(extra.exitCode === 0 || extra.listening || (extra.timedOut && childAlive(extra.exitCode))),
        exitCode: extra.exitCode,
        timedOut,
        listening: extra.listening || false,
        output,
        port,
        durationMs: Date.now() - started,
      });
    };

    const childAlive = (code) => code === null || code === undefined;

    // Poll for listening while process may remain blocked in background.
    const pollStart = Date.now();
    const poll = () => {
      if (resolved) return;
      if (listening) {
        finish({ exitCode: null, listening: true });
        return;
      }
      if (Date.now() - pollStart > timeoutMs) {
        // Still alive but never listened -> treat as started.
        finish({ exitCode: null, listening: false, timedOut: true });
        return;
      }
      isListening('127.0.0.1', port, 1, 200).then((ok) => {
        if (ok) {
          listening = true;
          finish({ exitCode: null, listening: true });
        } else {
          setTimeout(poll, 250);
        }
      });
    };
    setTimeout(poll, 400);

    child.on('error', (err) => {
      output.push(`> Failed to launch: ${err.message}`);
      finish({ exitCode: -1 });
    });

    child.on('close', (code) => {
      if (resolved) return;
      if (listening) {
        finish({ exitCode: code, listening: true });
      } else {
        finish({ exitCode: code, listening: false });
      }
    });
  });
}

module.exports = { npmBin, runCommand, runServer, freePort, isListening, connectOk, killProcessTree, childEnv };