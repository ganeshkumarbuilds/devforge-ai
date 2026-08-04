const config = require('../../config');
const logger = require('../../utils/logger');
const { chat, isConfigured } = require('../openrouterService');
const { parseJsonResponse, normalizeFiles } = require('../../agents/baseAgent');
const deploymentService = require('../deploymentService');

/**
 * ProjectRepairService — the "AI Self-Healing" layer of the Build Validation
 * Pipeline. Repairs a generated project before re-validating:
 *
 *  1. Deterministic repairs (templates): missing React/Vite entrypoints,
 *     missing backend scaffold, missing env templates, invalid package.json,
 *     missing documentation, invalid/missing Docker + Prisma config.
 *  2. AI self-healing: asks the model to fix broken imports, syntax errors
 *     and build failures, applying only the files it returns.
 */

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function frontendPackageJson() {
  return JSON.stringify(
    {
      name: 'frontend',
      private: true,
      version: '1.0.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        preview: 'vite preview',
        start: 'vite preview',
      },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.4.0' },
    },
    null,
    2
  );
}

function viteConfig() {
  return `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
});
`;
}

function frontendIndexHtml(title = 'DevForge App') {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`;
}

function frontendMainJsx() {
  return `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`;
}

function frontendAppJsx() {
  return `export default function App() {
  return (
    <main style={{ minHeight: '100vh', fontFamily: 'system-ui, sans-serif', display: 'grid', placeItems: 'center', background: '#0f172a', color: '#e2e8f0' }}>
      <section style={{ textAlign: 'center', padding: '2rem' }}>
        <h1>Welcome to your DevForge project</h1>
        <p>Your React app is running. Start editing <code>src/App.jsx</code>.</p>
      </section>
    </main>
  );
}
`;
}

function frontendIndexCss() {
  return `* { margin: 0; padding: 0; box-sizing: border-box; }
body { min-height: 100vh; background: #0f172a; }
`;
}

function backendPackageJson() {
  return JSON.stringify(
    {
      name: 'backend',
      version: '1.0.0',
      main: 'server.js',
      scripts: { dev: 'nodemon server.js', start: 'node server.js' },
      dependencies: { express: '^4.21.1', cors: '^2.8.5', dotenv: '^16.4.5' },
      devDependencies: { nodemon: '^3.1.7' },
    },
    null,
    2
  );
}

function backendServerJs() {
  return `require('dotenv').config();
const express = require('express');
const cors = require('cors');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`);
});
`;
}

function backendRoutesIndex() {
  return `const router = require('express').Router();
const { health } = require('../controllers/healthController');

router.get('/health', health);

module.exports = router;
`;
}

function backendHealthController() {
  return `exports.health = (req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
};
`;
}

function backendErrorHandler() {
  return `function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { notFound, errorHandler };
`;
}

function backendConfigEnv() {
  return `require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
};
`;
}

function serverEnvExample() {
  return `# Local development environment (copy to .env)
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://app:app@localhost:5432/app
JWT_SECRET=dev-secret-change-me
`;
}

function clientEnvExample() {
  return `# Public API base URL used by the frontend
VITE_API_URL=/api
`;
}

function readme(title = 'Generated App') {
  return `# ${title}

Generated by **DevForge AI**.

## Structure

\`\`\`
client/   React + Vite frontend
server/   Express backend
\`\`\`

## Getting started

\`\`\`bash
# Frontend
cd client
npm install
npm run dev

# Backend
cd server
npm install
npm start
\`\`\`
`;
}

// ---------------------------------------------------------------------------
// Deterministic repair helpers
// ---------------------------------------------------------------------------

function hasFiles(files) {
  return files && typeof files === 'object';
}

function exists(files, p) {
  return Object.prototype.hasOwnProperty.call(files, p) && typeof files[p] === 'string' && files[p].trim().length > 0;
}

/** Join a directory and relative path without producing a leading slash for root dirs. */
function relPath(dir, rel) {
  return dir ? `${dir}/${rel}` : rel;
}

/**
 * Deterministically repair the frontend portion of a project.
 * @param {Object<string,string>} files path -> content
 * @param {string} clientDir detected frontend directory ('' for project root)
 * @returns {string[]} list of paths added or changed
 */
function repairFrontend(files, clientDir) {
  const added = [];
  const put = (rel, content) => {
    const p = relPath(clientDir, rel);
    if (!exists(files, p)) {
      files[p] = content;
      added.push(p);
    }
  };

  put('package.json', frontendPackageJson());
  put('vite.config.js', viteConfig());
  put('index.html', frontendIndexHtml());
  put('src/main.jsx', frontendMainJsx());
  put('src/App.jsx', frontendAppJsx());
  put('src/index.css', frontendIndexCss());

  return added;
}

/**
 * Deterministically repair the backend portion of a project.
 * @param {Object<string,string>} files
 * @param {string} serverDir detected backend directory ('' for project root)
 * @returns {string[]} list of paths added or changed
 */
function repairBackend(files, serverDir) {
  const added = [];
  const put = (rel, content) => {
    const p = relPath(serverDir, rel);
    if (!exists(files, p)) {
      files[p] = content;
      added.push(p);
    }
  };

  put('package.json', backendPackageJson());
  put('server.js', backendServerJs());
  put('routes/index.js', backendRoutesIndex());
  put('controllers/healthController.js', backendHealthController());
  put('middleware/errorHandler.js', backendErrorHandler());
  put('config/env.js', backendConfigEnv());
  put('.env.example', serverEnvExample());

  return added;
}

/** Fix scripts + dependencies inside an existing (valid) package.json. */
function repairPackageJsonScripts(files, dir, kind, entry) {
  const pkgPath = relPath(dir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(files[pkgPath]);
  } catch {
    return [];
  }
  if (!pkg || typeof pkg !== 'object') return [];

  const changed = [];
  const scripts = pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  let mutated = false;

  if (kind === 'frontend') {
    if (!scripts.dev) { scripts.dev = 'vite'; mutated = true; }
    if (!scripts.build) { scripts.build = 'vite build'; mutated = true; }
    if (!scripts.preview) { scripts.preview = 'vite preview'; mutated = true; }
    const deps = pkg.dependencies || {};
    const devDeps = pkg.devDependencies || {};
    if (!deps.react) { deps.react = '^18.3.1'; mutated = true; }
    if (!deps['react-dom']) { deps['react-dom'] = '^18.3.1'; mutated = true; }
    if (!devDeps.vite) { devDeps.vite = '^5.4.0'; mutated = true; }
    if (!devDeps['@vitejs/plugin-react']) { devDeps['@vitejs/plugin-react'] = '^4.3.1'; mutated = true; }
    pkg.dependencies = deps;
    pkg.devDependencies = devDeps;
  } else {
    // Prefer an entry file that actually exists; rewrite start/dev when they
    // point at a file that is missing from the project.
    const entryCandidates = ['server.js', 'index.js', 'app.js', 'main.js'];
    const findExistingEntry = () => {
      for (const e of entryCandidates) {
        if (exists(files, relPath(dir, e))) return e;
      }
      return entry || 'server.js';
    };
    const nodeEntry = findExistingEntry();

    const startTargetOk = (() => {
      const m = String(scripts.start || '').match(/node\s+([^\s&|;]+)/);
      return Boolean(m && exists(files, relPath(dir, m[1].replace(/^\.\//, ''))));
    })();

    if (!scripts.start || !startTargetOk) { scripts.start = `node ${nodeEntry}`; mutated = true; }
    if (!scripts.dev || !startTargetOk) { scripts.dev = `nodemon ${nodeEntry}`; mutated = true; }
    const deps = pkg.dependencies || {};
    const devDeps = pkg.devDependencies || {};
    if (!deps.express) { deps.express = '^4.21.1'; mutated = true; }
    if (!devDeps.nodemon) { devDeps.nodemon = '^3.1.7'; mutated = true; }
    pkg.dependencies = deps;
    pkg.devDependencies = devDeps;
  }

  if (mutated) {
    pkg.scripts = scripts;
    files[pkgPath] = JSON.stringify(pkg, null, 2);
    changed.push(pkgPath);
  }
  return changed;
}

/** If the project uses Prisma, make sure the schema + env template are sane. */
function repairPrisma(files, serverDir) {
  const changed = [];
  const schemaPaths = [relPath(serverDir, 'prisma/schema.prisma'), 'prisma/schema.prisma'];
  const schemaPath = schemaPaths.find((p) => exists(files, p));
  if (!schemaPath) return changed;

  // Ensure .env.example carries a DATABASE_URL when one is not already present.
  for (const candidate of [relPath(serverDir, '.env.example'), '.env.example']) {
    if (exists(files, candidate)) {
      if (!/DATABASE_URL/.test(files[candidate])) {
        files[candidate] += `DATABASE_URL=postgresql://app:app@localhost:5432/app\n`;
        changed.push(candidate);
      }
      break;
    }
  }

  // Ensure schema.prisma declares both a generator and a datasource.
  const schema = files[schemaPath];
  const hasGenerator = /generator\s+client/.test(schema);
  const hasDatasource = /datasource\s+db/.test(schema);
  if (!hasGenerator || !hasDatasource) {
    const provider = /postgres(ql)?/i.test(schema) ? 'postgresql' : 'sqlite';
    const urlLine = provider === 'sqlite' ? 'url      = "file:./dev.db"' : 'url      = env("DATABASE_URL")';
    const prefix = `// Generated by DevForge AI validation.\n\ngenerator client {\n  provider = "prisma-client-js"\n}\n\ndatasource db {\n  provider = "${provider}"\n  ${urlLine}\n}\n\n`;
    files[schemaPath] = prefix + schema;
    changed.push(schemaPath);
  }

  return changed;
}

/** Regenerate the deterministic Docker/deployment bundle when it is missing. */
function repairDeployment(files, meta) {
  const hasDeployment =
    exists(files, 'Dockerfile') || exists(files, 'docker-compose.yml') || exists(files, 'render.yaml');
  if (hasDeployment) return [];

  const added = [];
  try {
    const result = deploymentService.generate(files, meta);
    for (const f of result.files) {
      if (!exists(files, f.path)) {
        files[f.path] = f.content;
        added.push(f.path);
      }
    }
  } catch (err) {
    logger.warn(`[ProjectRepair] deployment regeneration failed: ${err.message}`);
  }
  return added;
}

/** Ensure a root README documents how to run the project. */
function repairDocumentation(files, title) {
  if (exists(files, 'README.md')) return [];
  files['README.md'] = readme(title);
  return ['README.md'];
}

/** Replace a package.json that exists but is not valid JSON/object. */
function ensureValidManifest(files, dir, kind) {
  const p = relPath(dir, 'package.json');
  if (!exists(files, p)) return [];
  let pkg;
  try {
    pkg = JSON.parse(files[p]);
  } catch {
    pkg = null;
  }
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    files[p] = kind === 'frontend' ? frontendPackageJson() : backendPackageJson();
    return [p];
  }
  return [];
}

/**
 * Run all deterministic repairs against a file map.
 * @param {Object<string,string>} files
 * @param {{clientDir?: string, serverDir?: string, title?: string, entry?: string}} layout
 * @returns {string[]} paths added or changed
 */
function repairAll(files, layout = {}) {
  const changed = [];

  if (layout.clientDir !== null && layout.clientDir !== undefined) {
    changed.push(...repairFrontend(files, layout.clientDir));
    changed.push(...ensureValidManifest(files, layout.clientDir, 'frontend'));
    changed.push(...repairPackageJsonScripts(files, layout.clientDir, 'frontend'));
  }
  if (layout.serverDir !== null && layout.serverDir !== undefined) {
    changed.push(...repairBackend(files, layout.serverDir));
    changed.push(...ensureValidManifest(files, layout.serverDir, 'backend'));
    changed.push(...repairPackageJsonScripts(files, layout.serverDir, 'backend', layout.entry));
    changed.push(...repairPrisma(files, layout.serverDir));
  }

  // Always keep env templates + documentation + deployment bundle present.
  if (layout.clientDir !== null && layout.clientDir !== undefined) {
    const p = relPath(layout.clientDir, '.env.example');
    if (!exists(files, p)) {
      files[p] = clientEnvExample();
      changed.push(p);
    }
  }
  changed.push(...repairDeployment(files, { title: layout.title || 'Generated App' }));
  changed.push(...repairDocumentation(files, layout.title || 'Generated App'));

  return changed;
}

// ---------------------------------------------------------------------------
// Diagnostics helpers
// ---------------------------------------------------------------------------

/**
 * Lightweight scan for obvious unresolved relative imports.
 * @returns {string[]} human-readable hints
 */
function findUnresolvedImports(files) {
  const hints = [];
  const existsPath = (base, target) => {
    const candidates = [target, `${target}.js`, `${target}.jsx`, `${target}.ts`, `${target}.tsx`, `${target}.mjs`, `${target}/index.js`, `${target}/index.jsx`];
    return candidates.some((c) => exists(files, c));
  };

  for (const [p, content] of Object.entries(files)) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(p)) continue;
    const re = /(?:from\s+|import\s*\()\s*['"](\.{1,2}\/[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(content))) {
      const target = m[1];
      const base = p.split('/').slice(0, -1).join('/');
      const resolved = [base, target].filter(Boolean).join('/').replace(/\/+/g, '/');
      if (!existsPath(files, resolved)) {
        hints.push(`${p} -> ${target}`);
      }
    }
  }
  return [...new Set(hints)].slice(0, 40);
}

// ---------------------------------------------------------------------------
// AI self-healing
// ---------------------------------------------------------------------------

const REPAIR_SYSTEM_PROMPT = `You are the AI Self-Healing agent inside DevForge AI. A generated project failed validation (missing files, broken imports, syntax errors, missing dependencies, build or startup failure). Fix the project so it builds and runs.

Return ONLY a single JSON object, no markdown fences, no explanations:
{
  "files": [
    { "path": "client/src/App.jsx", "content": "full corrected file content" },
    { "path": "server/index.js", "content": "full corrected file content" }
  ]
}

Rules:
- Include the COMPLETE corrected content for every file you change.
- Fix syntax errors, broken imports, missing requires, invalid JSX, invalid routes, wrong package.json scripts, and missing dependencies.
- Prefer minimal changes; do not rewrite healthy files.
- Keep React/Vite entrypoints standard: client/index.html must load /src/main.jsx, and src/main.jsx must render App.
- Escape all newlines as \\n and double quotes as \\\" inside JSON string content.
- Return STRICT JSON ONLY.`;

/**
 * Ask the model to repair the project based on the latest validation failure.
 * @param {Object<string,string>} files
 * @param {{step?: string, dir?: string, logs?: string[], error?: string, unresolved?: string[]}} diagnostics
 * @returns {Promise<{path:string, content:string}[]>} files to apply (possibly empty)
 */
async function aiRepair(files, diagnostics = {}) {
  if (!config.validationAiFixEnabled || !isConfigured()) {
    logger.info('[ProjectRepair] AI self-healing disabled or OpenRouter not configured — deterministic repairs only.');
    return [];
  }

  const error = String(diagnostics.error || 'Unknown validation error').slice(0, 1500);
  const logs = Array.isArray(diagnostics.logs) ? diagnostics.logs.slice(-80).join('\n').slice(0, 4000) : '';
  const unresolved = Array.isArray(diagnostics.unresolved) ? diagnostics.unresolved.slice(0, 40).join('\n') : '';

  // Curate the most relevant files for the model (package manifests + entry
  // points + anything the error message mentions).
  const prioritized = ['package.json', 'vite.config.js', 'index.html', 'src/main.jsx', 'src/App.jsx', 'server.js', 'index.js', 'app.js', 'src/index.js'];
  const mentioned = new Set();
  const dirPrefix = diagnostics.dir ? `${diagnostics.dir}/` : '';
  const body = String(logs || error).toLowerCase();
  for (const token of body.split(/[^a-z0-9_.\-/]+/i)) {
    if (token.includes('.') && /\.(js|jsx|ts|tsx|json|css)$/i.test(token)) {
      mentioned.add(token);
    }
  }

  const included = new Set();
  const selected = [];
  const pushFile = (p) => {
    if (included.has(p)) return;
    included.add(p);
    if (Object.prototype.hasOwnProperty.call(files, p)) {
      selected.push({ path: p, content: String(files[p]).slice(0, 12000) });
    }
  };
  for (const rel of prioritized) {
    for (const p of Object.keys(files)) {
      const base = dirPrefix ? p.startsWith(dirPrefix) ? p.slice(dirPrefix.length) : null : p;
      if (base === rel) pushFile(p);
    }
  }
  for (const mention of mentioned) {
    for (const p of Object.keys(files)) {
      if (p === mention || p.endsWith(`/${mention}`)) pushFile(p);
    }
    if (selected.length >= 12) break;
  }
  if (selected.length === 0) {
    for (const p of Object.keys(files)) {
      if (p.includes('.') && !p.includes('node_modules')) {
        pushFile(p);
        if (selected.length >= 6) break;
      }
    }
  }

  const fileText = selected.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n');

  const userPrompt = `The following files failed validation:\n${fileText}

Validation error:
${error}

Build logs (tail):
${logs}

Unresolved imports detected:
${unresolved || '(none detected)'}

Return the corrected files as JSON.`;

  try {
    const { content } = await chat({
      messages: [
        { role: 'system', content: REPAIR_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      options: { temperature: 0.1 },
    });
    const parsed = parseJsonResponse(content);
    const fixed = normalizeFiles(parsed);
    logger.info(`[ProjectRepair] AI self-healing returned ${fixed.length} file(s) to apply.`);
    return fixed;
  } catch (err) {
    logger.warn(`[ProjectRepair] AI self-healing failed: ${err.message}`);
    return [];
  }
}

module.exports = {
  repairAll,
  aiRepair,
  findUnresolvedImports,
  repairFrontend,
  repairBackend,
  repairPackageJsonScripts,
  frontendPackageJson,
  backendPackageJson,
  backendServerJs,
  readme,
};