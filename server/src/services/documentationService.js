const { inspect } = require('./deploymentService');
const { slugify, hasFile } = require('../utils/fileUtils');

/**
 * Deterministic, structure-aware project documentation generator.
 *
 * Inspects the generated file set (client/server dirs, package.json, database
 * schema, detected API routes) and emits a complete documentation bundle:
 *   - README.md
 *   - docs/API.md           (endpoint reference)
 *   - docs/openapi.yaml     (Swagger / OpenAPI 3.0)
 *   - docs/STRUCTURE.md     (folder tree)
 *   - docs/ARCHITECTURE.md  (layered architecture + mermaid diagram)
 *   - docs/ER-DIAGRAM.md    (entity-relationship diagram)
 *   - docs/SETUP.md         (local setup guide)
 *   - docs/DEPLOYMENT.md    (deployment guide)
 */

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function formatDb(a) {
  if (!a.db || a.db.type === 'none') return 'None';
  const provider = a.db.provider ? a.db.provider : 'database';
  return a.db.prisma ? `${provider} (Prisma)` : provider;
}

// ---------------------------------------------------------------------------
// API route extraction
// ---------------------------------------------------------------------------

const ROUTE_RE = /(?:app|router)\.(get|post|put|patch|delete|head|options)\(\s*['"`]([^'"`]*)['"`]/g;

function extractRoutes(files, serverDir) {
  const routes = [];
  const seen = new Set();
  const keys = Object.keys(files || {}).filter(
    (p) => p.endsWith('.js') || p.endsWith('.ts') || p.endsWith('.mjs') || p.endsWith('.cjs')
  );
  for (const key of keys) {
    if (serverDir && !key.startsWith(`${serverDir}/`) && key !== serverDir) continue;
    const content = files[key];
    if (typeof content !== 'string') continue;
    let match;
    ROUTE_RE.lastIndex = 0;
    while ((match = ROUTE_RE.exec(content)) !== null) {
      const method = match[1].toUpperCase();
      const route = match[2];
      const dedupeKey = `${method} ${route}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      routes.push({ method, path: route, file: key });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

function describeRoute(route) {
  const { method, path } = route;
  const last = path.split(/[\/:]/).filter(Boolean).pop() || 'resource';
  const hasParam = path.includes(':');
  if (method === 'GET' && hasParam) return `Retrieve a ${last.replace('_', ' ')} by identifier`;
  if (method === 'GET') return `List / fetch ${last.replace(/_/g, ' ')} resources`;
  if (method === 'POST') return `Create a new ${last.replace(/_/g, ' ')} resource`;
  if (method === 'PUT' || method === 'PATCH') return `Update an existing ${last.replace(/_/g, ' ')} resource`;
  if (method === 'DELETE') return `Delete a ${last.replace(/_/g, ' ')} resource`;
  return `Perform ${method} operation on ${last.replace(/_/g, ' ')}`;
}

// ---------------------------------------------------------------------------
// Data model extraction (Prisma or SQL) -> ER diagram
// ---------------------------------------------------------------------------

function stripTable(name) {
  return name.replace(/[`"[\]]/g, '');
}

function extractPrismaModels(files, serverDir) {
  const candidate =
    (serverDir && hasFile(files, `${serverDir}/prisma/schema.prisma`) && `${serverDir}/prisma/schema.prisma`) ||
    hasFile(files, 'prisma/schema.prisma') && 'prisma/schema.prisma';
  if (!candidate) return null;
  const schema = files[candidate];
  const models = [];
  const MODEL_RE = /model\s+(\w+)\s*\{([\s\S]*?)\}/g;
  let m;
  while ((m = MODEL_RE.exec(schema)) !== null) {
    const name = m[1];
    const body = m[2];
    const fields = [];
    const namesFound = new Set();
    const FIELD_RE = /^\s*(\w+)\s+([\w\[\]?]+)(\s+@[\w():.,_"\[\] *]+)?\s*$/gm;
    let f;
    while ((f = FIELD_RE.exec(body)) !== null) {
      const fieldName = f[1];
      if (namesFound.has(fieldName)) continue;
      namesFound.add(fieldName);
      const fieldType = f[2];
      const attrs = f[3] || '';
      fields.push({
        name: fieldName,
        type: fieldType,
        isPk: /@id/.test(attrs),
        isUnique: /@unique/.test(attrs),
        isRelation: /@relation/.test(attrs),
      });
    }
    models.push({ name, fields });
  }
  return models;
}

function extractSqlTables(files, serverDir) {
  let schema = null;
  const candidates = [];
  if (serverDir) candidates.push(`${serverDir}/db/schema.sql`, `${serverDir}/schema.sql`, `${serverDir}/database/schema.sql`);
  candidates.push('db/schema.sql', 'schema.sql', 'database/schema.sql');
  for (const c of candidates) {
    if (hasFile(files, c)) { schema = files[c]; break; }
  }
  if (!schema) return null;

  const tables = [];
  const TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\)\s*(?:ENGINE|;|$)/gi;
  let t;
  while ((t = TABLE_RE.exec(schema)) !== null) {
    const name = stripSqlQuotes(t[1]);
    const body = t[2];
    const columns = [];
    const COL_RE = /^\s*[`"]?(\w+)[`"]?\s+([A-Z_]+(?:\([^)]*\))?(?:[^,\n]*)?)\s*,?\s*$/gm;
    let c;
    const seen = new Set();
    while ((c = COL_RE.exec(body)) !== null) {
      const colName = stripSqlQuotes(c[1]);
      if (seen.has(colName)) continue;
      seen.add(colName);
      const typeLine = c[2].trim().split(/\s+/)[0];
      const isPk = /\bPRIMARY\b/i.test(c[2]) || /\bAUTO_INCREMENT\b/i.test(c[2]);
      const isUnique = /\bUNIQUE\b/i.test(c[2]);
      const isFk = /\bREFERENCES\b/i.test(c[2]);
      columns.push({ name: colName, type: typeLine, isPk, isUnique, isFk });
    }
    const FK_RE = /FOREIGN\s+KEY\s*\([`"\[]?(\w+)[`"\]]?\)\s*REFERENCES\s+[`"]?(\w+)[`"]?/gi;
    let f;
    while ((f = FK_RE.exec(body)) !== null) {
      columns.push({ name: stripSqlQuotes(f[1]), type: 'FK', isPk: false, isUnique: false, isFk: true, references: stripSqlQuotes(f[2]) });
    }
    tables.push({ name, columns });
  }
  return tables;
}

function stripSqlQuotes(name) {
  return name.replace(/[`"[\]]/g, '');
}

function mermaidType(type) {
  const t = String(type || '').replace(/\[\]$|\?$/, '').toLowerCase();
  if (/int|float|double|decimal|number|bigint/i.test(t)) return 'number';
  if (/bool/i.test(t)) return 'boolean';
  if (/date|time/i.test(t)) return 'date';
  if (/json/i.test(t)) return 'object';
  return 'string';
}

function buildErDiagram(models) {
  if (!models || models.length === 0) return null;
  const lines = [];
  lines.push('```mermaid');
  lines.push('erDiagram');
  const modelNames = new Set(models.map((m) => m.name.toLowerCase()));
  const fieldsOf = (m) => m.fields || m.columns || [];

  // relationships
  for (const model of models) {
    for (const field of fieldsOf(model)) {
      if (field.isRelation || field.type.includes('@')) continue;
      const target = String(field.type || '').replace(/\[\]$|\?$/g, '');
      if (!modelNames.has(target.toLowerCase()) || target.toLowerCase() === model.name.toLowerCase()) continue;
      const many = String(field.type || '').includes('[]');
      const optional = String(field.type || '').includes('?');
      const left = model.name;
      const right = target;
      let edge;
      if (many) edge = `${left} ||--o{ ${right}`;
      else if (optional) edge = `${left} o|--o| ${right}`;
      else edge = `${left} ||--|| ${right}`;
      lines.push(`    ${edge} : "has"`);
    }
  }

  // entity field blocks
  for (const model of models) {
    lines.push(`    ${model.name} {`);
    for (const field of fieldsOf(model)) {
      if (field.isRelation || String(field.type || '').includes('?')) continue;
      const markers = [];
      if (field.isPk) markers.push('PK');
      if (field.isUnique && !field.isPk) markers.push('UK');
      if (field.isFk) markers.push('FK');
      const suffix = markers.length ? ` ${markers.join(',')}` : '';
      lines.push(`        ${mermaidType(field.type)} ${field.name}${suffix}`);
    }
    lines.push(`    }`);
  }
  lines.push('```');
  return { diagram: lines.join('\n'), models };
}

// ---------------------------------------------------------------------------
// Folder tree
// ---------------------------------------------------------------------------

function buildTree(paths) {
  const root = {};
  for (const p of paths) {
    const parts = p.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      if (isLast) {
        node[part] = null;
      } else {
        node[part] = node[part] || {};
        node = node[part];
      }
    }
  }
  const render = (node, prefix, isRoot) => {
    const out = [];
    const isDir = (v) => v !== null;
    const entries = Object.entries(node).sort(([a, av], [b, bv]) => {
      if (av === null && bv === null) return a.localeCompare(b);
      return Number(bv === null) - Number(av === null) || a.localeCompare(b);
    });
    entries.forEach(([name, child], i) => {
      const last = i === entries.length - 1;
      const connector = last ? '└── ' : '├── ';
      out.push(`${prefix}${connector}${name}${isDir(child) ? '/' : ''}`);
      if (isDir(child)) {
        out.push(...render(child, `${prefix}${last ? '    ' : '│   '}`, last));
      }
    });
    return out;
  };
  return ['.'].concat(render(root, '', true)).join('\n');
}

// ---------------------------------------------------------------------------
// Doc building
// ---------------------------------------------------------------------------

function readme(a) {
  const lines = [];
  lines.push(`# ${a.title}`, '');
  lines.push(`> ${a.summary || 'Generated project.'}`.trim().replace(/^> $/, ''), '');
  lines.push('', '## Overview', '', '- **Stack:** ' + (a.stack || 'Auto-generated'), '');
  lines.push(`- **Runtime:** ${a.hasServer ? 'Node.js API (' + (a.serverDir || 'server') + ')' : 'Frontend only'}`);
  lines.push(`- **Frontend:** ${a.hasClient ? (a.isVite ? 'Vite + React' : 'React (CRA)') : 'None'}`);
  lines.push(`- **Database:** ${formatDb(a)}`);
  lines.push('- **Build port:** ' + a.port, '');
  if (a.features.length) {
    lines.push('## Features', '');
    for (const f of a.features) lines.push(`- ${f}`);
    lines.push('');
  }
  lines.push('## Documentation', '', 'This project ships with a full documentation bundle:');
  lines.push('',
    '- [API Reference](docs/API.md)',
    '- [Swagger / OpenAPI](docs/openapi.yaml)',
    '- [Folder Structure](docs/STRUCTURE.md)',
    '- [Architecture](docs/ARCHITECTURE.md)',
    '- [ER Diagram](docs/ER-DIAGRAM.md)',
    '- [Setup Guide](docs/SETUP.md)',
    '- [Deployment Guide](docs/DEPLOYMENT.md)',
    '');
  lines.push('## Quick Start', '', '```bash', 'npm install', '# if a monorepo (client + server)', 'npm install --prefix server', 'npm install --prefix client', '', '# start the API', 'npm start', '```', '');
  lines.push(`> See [SETUP.md](docs/SETUP.md) for a complete local setup guide and [DEPLOYMENT.md](docs/DEPLOYMENT.md) to go to production.`);
  return lines.join('\n');
}

function apiMd(a) {
  const lines = [];
  lines.push('# API Reference', '', `Base path: **${a.apiBase}**`, '');
  if (a.routes.length === 0) {
    lines.push('No routes were auto-detected in the generated source. This project may be frontend-only or expose routes through a framework that is not pattern-matched here.');
    lines.push('', 'Look for framework-level route files (e.g. `*Controller.js`, `routes/*.js`) and document your endpoints accordingly.');
    return lines.join('\n');
  }
  lines.push('| Method | Path | Description |', '| --- | --- | --- |');
  for (const r of a.routes) {
    lines.push(`| ${r.method} | \`${r.path}\` | ${describeRoute(r)} |`);
  }
  lines.push('', '## Conventions', '', `- All requests and responses use **JSON**.`, `- The base URL is \`${a.apiBase}\` (see \`${a.serverEntry || 'server index'}\`).`, '- Protected routes expect an `Authorization: Bearer <token>` header when auth is enabled.', '- Errors are returned as `{ "error": "<message>" }` with an appropriate status code.', '');
  const grouped = {};
  for (const r of a.routes) (grouped[r.path] = grouped[r.path] || []).push(r);
  for (const path of Object.keys(grouped).sort()) {
    lines.push(`## ${path}`, '');
    for (const r of grouped[path]) {
      lines.push(`### \`${r.method} ${path}\``, '', describeRoute(r), '', '**Parameters**', '', '| Name | In | Type | Required | Description |', '| --- | --- | --- | --- | --- |');
      lines.push(`| \`id\` | path | string | no | The resource identifier (populated in \`${path}\`). |`);
      lines.push('', '**Response**', '', '```json', '{ "ok": true, "data": {} }', '```', '');
    }
  }
  return lines.join('\n');
}

function openapi(a) {
  const lines = [];
  lines.push(`openapi: 3.0.0`);
  lines.push(`info:`);
  lines.push(`  title: ${JSON.stringify(a.title)}`);
  lines.push(`  description: ${JSON.stringify(a.summary || 'API for ' + a.title)}`);
  lines.push(`  version: 1.0.0`);
  lines.push(`servers:`);
  lines.push(`  - url: ${JSON.stringify(a.serverBase)}`);
  lines.push(`paths:`);
  if (a.routes.length === 0) {
    lines.push(`  /health:`);
    lines.push(`    get:`);
    lines.push(`      summary: Health check`);
    lines.push(`      responses:`);
    lines.push(`        '200':`);
    lines.push(`          description: Service is up`);
  }
  const grouped = {};
  for (const r of a.routes) (grouped[r.path] = grouped[r.path] || []).push(r);
  for (const path of Object.keys(grouped).sort()) {
    lines.push(`  ${JSON.stringify(path)}:`);
    for (const r of grouped[path]) {
      lines.push(`    ${r.method.toLowerCase()}:`);
      lines.push(`      summary: ${JSON.stringify(describeRoute(r))}`);
      lines.push(`      responses:`);
      lines.push(`        '200':`);
      lines.push(`          description: Successful response`);
      lines.push(`        '400':`);
      lines.push(`          description: Bad request`);
      lines.push(`        '404':`);
      lines.push(`          description: Not found`);
      lines.push(`        '500':`);
      lines.push(`          description: Internal server error`);
    }
  }
  lines.push(`components:`);
  lines.push(`  schemas:`);
  lines.push(`    Error:`);
  lines.push(`      type: object`);
  lines.push(`      properties:`);
  lines.push(`        error:`);
  lines.push(`          type: string`);
  lines.push(`          description: Error message`);
  lines.push(`  securitySchemes:`);
  lines.push(`    bearerAuth:`);
  lines.push(`      type: http`);
  lines.push(`      scheme: bearer`);
  return lines.join('\n');
}

function structureMd(a) {
  const extra = [
    'docs/README.md istru',
    'docs/API.md', 'docs/openapi.yaml', 'docs/STRUCTURE.md', 'docs/ARCHITECTURE.md',
    'docs/ER-DIAGRAM.md', 'docs/SETUP.md', 'docs/DEPLOYMENT.md',
  ];
  const all = [...Object.keys(a.files), ...extra.filter((x) => !x.startsWith('docs/README'))];
  const lines = [];
  lines.push('# Folder Structure', '', '> This project is a generated monorepo. The tree below reflects the files on disk.', '', '```');
  lines.push(buildTree(all));
  lines.push('```', '');
  lines.push('## Top-level layout', '');
  if (a.hasClient && a.clientDir) lines.push(`- \`${a.clientDir}/\` — the user-facing frontend (${a.isVite ? 'Vite + React' : 'React'}).`);
  if (a.hasServer && a.serverDir) lines.push(`- \`${a.serverDir}/\` — the API / backend service.`);
  lines.push('- `docs/` — this documentation bundle.');
  if (hasFile(a.files, 'Dockerfile')) {
    lines.push('- `Dockerfile`, `docker-compose.yml`, `nginx/`, `.github/` — production deployment configuration.');
  }
  lines.push('- `package.json` — npm scripts and dependencies.');
  return lines.join('\n');
}

function architectureMd(a) {
  const lines = [];
  lines.push('# Architecture', '', `> ${a.summary || ''}`.trim(), '', '## Layers', '');
  if (a.hasClient && a.hasServer) {
    lines.push(
      'This project follows a **three-tier architecture**:',
      '',
      '| Layer | Location | Responsibility |',
      '| --- | --- | --- |',
      `| **Client** | \`${a.clientDir}/\` | Renders UI, calls the API |`,
      `| **Server** | \`${a.serverDir}/\` | Business logic + REST API |`,
      `| **Data** | ${a.db.label} | Persistence |`,
      '');
  } else if (a.hasServer) {
    lines.push('This is a **server API** with a layered design:', '', '| Layer | Responsibility |', '| --- | --- |', '| **Routes** | HTTP surface / request handling |', '| **Services** | Business logic |', `| **Data** | ${a.db.label} |`, '');
  } else {
    lines.push('This is a **frontend application**. It talks to an external or bundled API.');
  }
  lines.push('', '## Request flow', '', '```mermaid', 'flowchart TD', '    A[Browser / Client] -->|HTTP request| B[Server Router]');
  if (a.hasClient && a.hasServer) lines.push('    A -->|Build output served / API calls| B');
  lines.push('    B --> C[Controllers / Services]');
  lines.push('    C --> D[(Database)]');
  lines.push('```', '');
  if (a.architectureText) {
    lines.push('## Notes from the Architect', '', `> ${a.architectureText}`);
  }
  return lines.join('\n');
}

function erDiagramMd(a) {
  const lines = [];
  lines.push('# ER Diagram', '', '> Entity-relationship model for this project, rendered with Mermaid.', '');
  if (a.er) {
    lines.push(a.er.diagram, '');
    for (const model of a.er.models) {
      lines.push(`## ${model.name}`, '');
      lines.push('| Field | Type | Attributes |', '| --- | --- | --- |');
      for (const f of (model.fields || model.columns || [])) {
        const attrs = [];
        if (f.isPk) attrs.push('PK');
        if (f.isUnique) attrs.push('UNIQUE');
        if (f.isFk) attrs.push('FK');
        lines.push(`| \`${f.name}\` | ${f.type} | ${attrs.join(', ') || ''} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('No database models were detected in this project, so an entity-relationship diagram cannot be rendered.');
    lines.push('', 'The data layer is either not present or defined in a schema this generator could not parse (e.g. file-based storage).');
  }
  return lines.join('\n');
}

function setupMd(a) {
  const lines = [];
  const dbReq = a.db.provider ? `\`${a.db.provider}\` database` : 'No external database required';
  lines.push('# Setup Guide', '', '## Prerequisites', '', '- [Node.js](https://nodejs.org) 18+ (Node 20 recommended)', '- npm (ships with Node.js)', `- ${dbReq}.`, '');
  lines.push('## 1. Install dependencies', '', '```bash');
  if (a.hasServer && a.serverDir) lines.push(`npm install --prefix ${a.serverDir}`);
  if (a.hasClient && a.clientDir) lines.push(`npm install --prefix ${a.clientDir}`);
  if (a.hasServer && a.serverDir) lines.push('');
  lines.push('```', '', '## 2. Configure environment', '', '```bash', 'cp .env.example .env    # edit values as needed', '```');
  lines.push('', 'Common variables:');
  lines.push('', '```', `PORT=${a.port}`, `DATABASE_URL=${a.db.provider ? '…' : '(not required)'}`, 'JWT_SECRET=…', '```', '');
  if (a.db.prisma || a.db.provider) {
    lines.push('## 3. Database', '', '```bash', 'npx prisma migrate dev   # if using Prisma', '```');
  }
  lines.push(`## ${a.db.provider ? '4' : '2'}. Run locally`, '');
  lines.push('```bash');
  if (a.hasServer && a.serverDir) lines.push(`npm start --prefix ${a.serverDir}`);
  if (a.hasClient && a.clientDir) lines.push(`npm run dev --prefix ${a.clientDir}`);
  lines.push('```', '', `The API listens on port ${a.port}, the frontend on its Vite/React dev port.`, '');
  lines.push('## Run tests', '', '```bash', 'npm test', '```');
  return lines.join('\n');
}

function deploymentMd(a) {
  const lines = [];
  lines.push('# Deployment Guide', '', `Complete production deployment walkthrough for **${a.title}**.`);
  lines.push('', 'The project includes ready-to-use deployment configuration (see [Folder Structure](STRUCTURE.md)):', '', '- `Dockerfile` — multi-stage production image', '- `docker-compose.yml` — app + database stack', '- `.github/workflows/` — CI & CD', '- `nginx/nginx.conf` — reverse proxy', '- `render.yaml`, `nixpacks.toml`, `client/vercel.json`, `client/netlify.toml`');
  lines.push('', '## 1. Docker (any host)', '', '```bash', 'npm install', 'cp .env.production.example .env   # real secrets', 'docker compose up -d --build', 'docker compose logs -f app', '```', '');
  lines.push('## 2. Render', '', '1. Push the repository to GitHub/GitLab/Bitbucket.', '2. In Render, create a **Blueprint** and point it at the repo root.', '3. `render.yaml` provisions a web service and database automatically.', '4. Set `JWT_SECRET` under the service Environment tab.', '', '## 3. Railway', '', '1. Connect the repo and create a **Service**.', '2. Railway uses Nixpacks — `nixpacks.toml` is applied automatically.', '3. Add a Postgres plugin and set `DATABASE_URL` on the service.', '', '## 4. Vercel (frontend)', '', '1. Import the repo, **Root Directory**: `client`.', '2. Replace `YOUR_BACKEND_URL` in `client/vercel.json`.', '3. Deploy — the SPA is built and `/api/*` is rewritten to your backend.', '', '## 5. Netlify (frontend)', '', '1. Import the repo, **Base directory**: `client`, **Build**: `npm run build`, **Publish**: `dist`.', '2. Update `YOUR_BACKEND_URL` in `client/netlify.toml`.', '3. Deploy.');
  lines.push('', '## Environment variables', '', '```', `PORT=${a.port}`, `DATABASE_URL=${a.db.provider ? '…database connection string…' : '(not required)'}`, 'JWT_SECRET=…', '```', '', '> Local run hint: `npm install --prefix server && npm start --prefix server`.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function analyze(files, meta) {
  const a = inspect(files || {});
  const serverDir = a.serverDir && a.hasServer ? a.serverDir : null;
  const routes = extractRoutes(files, serverDir);

  // DB models for ER diagram
  let er = null;
  const models = extractPrismaModels(files, serverDir) || extractSqlTables(files, serverDir);
  er = buildErDiagram(models);

  const serverBase = serverDir ? `/${serverDir}` : '';
  const apiBase = (routes[0] && routes[0].path.startsWith('/api')) ? '/api' : '/';

  return {
    ...a,
    title: meta.title || 'Generated App',
    summary: meta.summary || '',
    stack: meta.stack || 'Auto',
    features: meta.features && Array.isArray(meta.features) ? meta.features : [],
    architectureText: meta.architecture || '',
    paths: Object.keys(files || {}),
    routes,
    er,
    serverDir,
    serverBase,
    apiBase,
  };
}

function generate(files, meta = {}) {
  const a = analyze(files, meta);
  const bundle = [
    { path: 'README.md', content: readme(a) },
    { path: 'docs/API.md', content: apiMd(a) },
    { path: 'docs/openapi.yaml', content: openapi(a) + '\n' },
    { path: 'docs/STRUCTURE.md', content: structureMd(a) },
    { path: 'docs/ARCHITECTURE.md', content: architectureMd(a) },
    { path: 'docs/ER-DIAGRAM.md', content: erDiagramMd(a) },
    { path: 'docs/SETUP.md', content: setupMd(a) },
    { path: 'docs/DEPLOYMENT.md', content: deploymentMd(a) },
  ];
  return {
    files: bundle,
    summary: `Generated a complete documentation bundle for ${slugify(a.title)} — README, API reference, OpenAPI spec, folder structure, architecture, ER diagram, setup guide and deployment guide.`,
    analysis: {
      routes: a.routes.map((r) => `${r.method} ${r.path}`),
      models: a.er ? a.er.models.map((m) => m.name) : [],
      clientDir: a.clientDir,
      serverDir: a.serverDir,
      db: a.db,
    },
  };
}

module.exports = { generate, analyze, extractRoutes, buildTree };