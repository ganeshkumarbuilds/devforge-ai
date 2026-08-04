const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');
const { runCommand } = require('./BuildRunner');

/**
 * DependencyInstaller — ensures a generated project's package.json is valid
 * and carries the scripts/dependencies required to run and build, then runs
 * `npm install`.
 */

/** Read + parse a package.json from disk. Returns parsed object or null. */
function readPackage(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  } catch (err) {
    logger.warn(`[DependencyInstaller] Invalid package.json at ${pkgPath}: ${err.message}`);
    return null;
  }
}

/** Parse a package.json from a file map. Returns parsed object or null. */
function parsePackageJson(fileMap, relPath) {
  const raw = fileMap.get(relPath);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function validScriptValue(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Ensure the manifest has dev/start scripts pointing at the server entry.
 * Prefers `server.js` as the entry (matching the standard DevForge contract),
 * but falls back to whatever entry file actually exists.
 */
function ensureBackendScripts(pkg, entry) {
  if (!pkg || typeof pkg !== 'object') return pkg;
  const nodeEntry = entry || 'server.js';
  const dbg = pkg.devDependencies || {};
  let needsNodemon = false;

  if (!validScriptValue(pkg.scripts?.dev)) {
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.dev = `nodemon ${nodeEntry}`;
    needsNodemon = true;
  }
  if (!validScriptValue(pkg.scripts?.start)) {
    pkg.scripts = pkg.scripts || {};
    pkg.scripts.start = `node ${nodeEntry}`;
  }
  if (needsNodemon && !dbg.nodemon) {
    pkg.devDependencies = { ...(pkg.devDependencies || {}), nodemon: '^3.1.7' };
  }
  return pkg;
}

/** Ensure a frontend manifest has dev/build/preview/start scripts for Vite. */
function ensureFrontendScripts(pkg) {
  if (!pkg || typeof pkg !== 'object') return pkg;
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  if (!validScriptValue(scripts.dev)) scripts.dev = 'vite';
  if (!validScriptValue(scripts.build)) scripts.build = 'vite build';
  if (!validScriptValue(scripts.preview)) scripts.preview = 'vite preview';
  if (!validScriptValue(scripts.start)) scripts.start = 'vite preview';
  pkg.scripts = scripts;

  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  if (!deps.react) deps.react = '^18.3.1';
  if (!deps['react-dom']) deps['react-dom'] = '^18.3.1';
  if (!devDeps.vite) devDeps.vite = '^5.4.0';
  if (!devDeps['@vitejs/plugin-react']) devDeps['@vitejs/plugin-react'] = '^4.3.1';
  pkg.dependencies = deps;
  pkg.devDependencies = devDeps;
  return pkg;
}

/** Ensure an Express backend manifest has the http framework + supporting deps. */
function ensureBackendDeps(pkg) {
  if (!pkg || typeof pkg !== 'object') return pkg;
  const deps = pkg.dependencies || {};
  if (!deps.express) deps.express = '^4.21.1';
  if (!deps.cors) deps.cors = '^2.8.5';
  if (!deps.dotenv) deps.dotenv = '^16.4.5';
  pkg.dependencies = deps;
  return pkg;
}

/**
 * Install dependencies for a project directory. Returns the runner result.
 */
async function install(dir) {
  const result = await runCommand({
    args: ['install', '--no-audit', '--no-fund', '--loglevel=error'],
    cwd: dir,
    timeoutMs: config.validationCommandTimeoutMs,
  });
  logger.info(`[DependencyInstaller] npm install for ${path.basename(dir)} -> ${result.ok ? 'ok' : 'failed'} (${result.durationMs}ms)`);
  return result;
}

module.exports = {
  readPackage,
  parsePackageJson,
  ensureBackendScripts,
  ensureFrontendScripts,
  ensureBackendDeps,
  install,
};