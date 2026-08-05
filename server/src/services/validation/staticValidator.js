const logger = require('../../utils/logger');

/**
 * StaticValidator — the static ("structure") stage of the Build Validation
 * Pipeline. It verifies that a generated project contains every file DevForge
 * considers required before it may be shipped:
 *
 *   - package.json + required npm scripts (dev / start / build)
 *   - frontend entrypoints (index.html, src/main.*, vite config)
 *   - backend entrypoint + controllers + routes + middleware
 *   - database schema, environment files, documentation, deployment files
 *
 * A missing file fails the stage. The deterministic repair layer
 * (ProjectRepairService.repairAll) regenerates whatever it can beforehand, so
 * this validator only reports what is genuinely still absent.
 */

const BACKEND_ENTRY_CANDIDATES = ['server.js', 'index.js', 'app.js', 'main.js', 'src/index.js', 'src/server.js', 'src/app.js'];
const FRONTEND_ENTRY_CANDIDATES = ['src/main.jsx', 'src/main.tsx', 'src/index.jsx', 'src/index.tsx', 'src/App.jsx', 'src/App.tsx'];
const VITE_CONFIG_CANDIDATES = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'];
const DEPLOYMENT_FILES = ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', 'render.yaml', 'vercel.json', 'netlify.toml', 'railway.json', 'nixpacks.toml'];
const SCHEMA_FILES = ['prisma/schema.prisma', 'db/schema.sql', 'database/schema.sql', 'models/index.js', 'models/index.ts'];
const DOC_FILES = ['README.md', 'readme.md'];

function exists(files, p) {
  return Object.prototype.hasOwnProperty.call(files, p) && typeof files[p] === 'string' && files[p].trim().length > 0;
}

function hasDir(files, dir) {
  const prefix = `${dir.replace(/\/+$/, '')}/`;
  return Object.keys(files).some((p) => p.startsWith(prefix) && p.length > prefix.length);
}

function rel(dir, file) {
  return dir ? `${dir}/${file}` : file;
}

function parsePkg(files, pkgPath) {
  try {
    return JSON.parse(files[pkgPath]);
  } catch {
    return null;
  }
}

function checkRequiredScripts(files, dir, missing, scripts) {
  const pkgPath = rel(dir, 'package.json');
  if (!exists(files, pkgPath)) {
    missing.push({ category: 'manifest', path: pkgPath, hint: 'package.json is missing — the project cannot be installed or built.' });
    return;
  }
  const pkg = parsePkg(files, pkgPath);
  if (!pkg || typeof pkg !== 'object') {
    missing.push({ category: 'manifest', path: pkgPath, hint: 'package.json is not valid JSON — fix it before validation can continue.' });
    return;
  }
  for (const script of scripts) {
    const value = pkg.scripts && pkg.scripts[script];
    if (typeof value !== 'string' || !value.trim()) {
      missing.push({
        category: 'script',
        path: `${pkgPath}#scripts.${script}`,
        hint: `Required npm script "${script}" is missing from ${pkgPath}.`,
      });
    }
  }
}

function anyExists(files, candidates) {
  return candidates.some((c) => exists(files, c));
}

/**
 * Run the static validation against the file map.
 * @param {Object<string,string>} files path -> content
 * @param {{clientDir?: string, serverDir?: string}} layout detected directories
 * @returns {{ ok: boolean, missing: {category:string, path:string, hint:string}[] }}
 */
function validate(files, layout = {}) {
  const missing = [];

  if (layout.clientDir !== null && layout.clientDir !== undefined) {
    const dir = layout.clientDir;
    checkRequiredScripts(files, dir, missing, ['dev', 'start', 'build']);

    if (!anyExists(files, [rel(dir, 'index.html'), rel(dir, 'src/index.html')])) {
      missing.push({ category: 'frontend-entry', path: rel(dir, 'index.html'), hint: 'Frontend HTML entrypoint is missing.' });
    }
    if (!anyExists(files, FRONTEND_ENTRY_CANDIDATES.map((c) => rel(dir, c)))) {
      missing.push({ category: 'frontend-entry', path: rel(dir, 'src/main.jsx'), hint: 'Frontend application entry (src/main.jsx) is missing.' });
    }
    if (!anyExists(files, VITE_CONFIG_CANDIDATES.map((c) => rel(dir, c)))) {
      missing.push({ category: 'frontend-config', path: rel(dir, 'vite.config.js'), hint: 'Vite config is missing — the frontend cannot be built.' });
    }
    if (!anyExists(files, [rel(dir, '.env.example'), rel(dir, '.env')])) {
      missing.push({ category: 'env', path: rel(dir, '.env.example'), hint: 'Frontend environment file (.env / .env.example) is missing.' });
    }
  }

  if (layout.serverDir !== null && layout.serverDir !== undefined) {
    const dir = layout.serverDir;
    checkRequiredScripts(files, dir, missing, ['dev', 'start']);

    if (!exists(files, rel(dir, 'package.json'))) {
      // already reported above
    } else if (!anyExists(files, BACKEND_ENTRY_CANDIDATES.map((c) => rel(dir, c)))) {
      missing.push({ category: 'backend-entry', path: rel(dir, 'server.js'), hint: 'Backend entrypoint (server.js / index.js / app.js) is missing.' });
    }
    if (!hasDir(files, rel(dir, 'controllers'))) {
      missing.push({ category: 'controllers', path: rel(dir, 'controllers/'), hint: 'Backend controllers directory is missing.' });
    }
    if (!hasDir(files, rel(dir, 'routes'))) {
      missing.push({ category: 'routes', path: rel(dir, 'routes/'), hint: 'Backend routes directory is missing.' });
    }
    if (!hasDir(files, rel(dir, 'middleware'))) {
      missing.push({ category: 'middleware', path: rel(dir, 'middleware/'), hint: 'Backend middleware directory is missing.' });
    }
    if (!anyExists(files, SCHEMA_FILES.map((c) => rel(dir, c)))) {
      missing.push({ category: 'schema', path: rel(dir, 'prisma/schema.prisma'), hint: 'Database schema (prisma/schema.prisma or db/schema.sql) is missing.' });
    }
    if (!anyExists(files, [rel(dir, '.env.example'), rel(dir, '.env')])) {
      missing.push({ category: 'env', path: rel(dir, '.env.example'), hint: 'Backend environment file (.env / .env.example) is missing.' });
    }
  }

  if (!anyExists(files, DOC_FILES)) {
    missing.push({ category: 'documentation', path: 'README.md', hint: 'Project documentation (README.md) is missing.' });
  }
  if (!anyExists(files, DEPLOYMENT_FILES)) {
    missing.push({ category: 'deployment', path: 'Dockerfile', hint: 'Deployment files (Dockerfile / docker-compose.yml / render.yaml) are missing.' });
  }

  const ok = missing.length === 0;
  if (!ok) {
    logger.warn(`[StaticValidator] ${missing.length} required file(s) missing: ${missing.map((m) => m.path).join(', ')}`);
  }
  return { ok, missing };
}

module.exports = { validate, DEPLOYMENT_FILES, SCHEMA_FILES };
