const { slugify, hasFile, parsePkg } = require('../utils/fileUtils');

/**
 * Deterministic, production-ready deployment configuration generator.
 *
 * Inspects the generated project's file set (client/server dirs, package.json
 * scripts, database provider) and emits a coherent deployment bundle:
 *   - Dockerfile + .dockerignore
 *   - docker-compose.yml (app + database)
 *   - GitHub Actions (CI + deploy)
 *   - NGINX reverse proxy config
 *   - Environment files (.env.production.example)
 *   - Deployment scripts (build / start / deploy)
 *   - Render (render.yaml), Railway (nixpacks.toml),
 *     Vercel (client/vercel.json), Netlify (client/netlify.toml)
 */

const CLIENT_DIRS = ['client', 'web', 'frontend', 'front'];
const SERVER_DIRS = ['server', 'api', 'backend'];

function analyze(files) {
  const rootPkg = parsePkg(files, 'package.json');
  const findDir = (dirs) =>
    dirs.find((d) => {
      const base = `${d}/`;
      return Object.keys(files).some((p) => p.startsWith(base) && p !== base);
    });

  const clientDir = findDir(CLIENT_DIRS);
  const serverDir = findDir(SERVER_DIRS);

  const clientPkg = clientDir ? parsePkg(files, `${clientDir}/package.json`) : rootPkg;
  const serverPkg = serverDir ? parsePkg(files, `${serverDir}/package.json`) : rootPkg;

  const hasClient = Boolean(clientDir || (rootPkg && (rootPkg.dependencies?.react || rootPkg.devDependencies?.vite)));
  const hasServer = Boolean(serverDir || (rootPkg && (rootPkg.dependencies?.express || rootPkg.dependencies?.fastify)));

  // ---- Frontend framework ----
  const hasViteConfig =
    (clientDir && hasFile(files, `${clientDir}/vite.config.js`)) ||
    (clientDir && hasFile(files, `${clientDir}/vite.config.ts`));
  const isVite = Boolean(
    clientPkg?.devDependencies?.vite ||
    hasViteConfig ||
    (clientPkg?.dependencies?.react && !clientPkg?.dependencies?.['react-scripts'])
  );
  const clientBuildDir = isVite ? 'dist' : 'build';

  // ---- Server entry (root-relative) ----
  let serverEntry = null;
  let serverStartScript = null;
  if (serverPkg && serverPkg.scripts && serverPkg.scripts.start) {
    serverStartScript = serverPkg.scripts.start;
    const match = String(serverStartScript).match(/node\s+([^\s&|;]+)/);
    if (match) serverEntry = match[1].replace(/^\.\//, '');
  }
  if (!serverEntry && serverDir) {
    const candidates = ['index.js', 'app.js', 'server.js', 'main.js'];
    for (const c of candidates) {
      if (hasFile(files, `${serverDir}/${c}`)) {
        serverEntry = `${serverDir}/${c}`;
        break;
      }
    }
  }
  if (!serverEntry && rootPkg && hasFile(files, 'index.js')) serverEntry = 'index.js';

  // Entry relative to the server directory (for WORKDIR /app/server).
  let serverEntryInDir = serverEntry;
  if (serverDir && serverEntry) {
    serverEntryInDir = serverEntry.startsWith(`${serverDir}/`) ? serverEntry.slice(serverDir.length + 1) : serverEntry;
  }

  // ---- Database ----
  const serverDeps = {
    ...(serverPkg?.dependencies || {}),
    ...(serverPkg?.devDependencies || {}),
    ...(rootPkg?.dependencies || {}),
  };
  const prismaSchema = (serverDir && hasFile(files, `${serverDir}/prisma/schema.prisma`)) || hasFile(files, 'prisma/schema.prisma');
  const db = { type: 'none', provider: null, prisma: Boolean(prismaSchema) };
  if (prismaSchema || serverDeps['@prisma/client']) {
    db.type = 'prisma';
    db.provider = 'postgresql';
  } else if (serverDeps.pg || serverDeps['pg-promise']) {
    db.type = 'raw';
    db.provider = 'postgresql';
  } else if (serverDeps.mysql || serverDeps.mysql2) {
    db.type = 'raw';
    db.provider = 'mysql';
  } else if (serverDeps.mongodb || serverDeps.mongoose) {
    db.type = 'raw';
    db.provider = 'mongodb';
  } else if (serverDeps.sqlite3 || serverDeps['better-sqlite3']) {
    db.type = 'raw';
    db.provider = 'sqlite';
  }

  const port = 3000;

  return {
    files,
    rootPkg,
    clientDir: clientDir || (hasClient ? 'client' : null),
    serverDir,
    clientPkg,
    serverPkg,
    hasClient,
    hasServer,
    isVite,
    clientBuildDir,
    serverEntry,
    serverEntryInDir,
    serverStartScript,
    db,
    port,
    entryRoot: serverEntry || 'index.js',
  };
}

function indentBlock(content, spaces) {
  const pad = ' '.repeat(spaces);
  return String(content)
    .split('\n')
    .map((l) => (l.trim() ? `${pad}${l}` : l))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function dockerfile(a) {
  const clientDir = a.hasClient && a.clientDir ? a.clientDir : null;
  const serverDir = a.hasServer && a.serverDir ? a.serverDir : null;
  const prismaGen = a.db.prisma ? 'RUN npx prisma generate\n' : '';
  const migrate = a.db.prisma && a.db.provider === 'postgresql'
    ? 'npx prisma migrate deploy && '
    : '';

  const stages = [];
  if (clientDir) {
    stages.push(`FROM node:20-alpine AS client-deps
WORKDIR /app/${clientDir}
COPY ${clientDir}/package.json ${clientDir}/package-lock.json* ./
RUN npm ci || npm install

FROM node:20-alpine AS client-build
WORKDIR /app/${clientDir}
COPY --from=client-deps /app/${clientDir}/node_modules ./node_modules
COPY ${clientDir}/ ./
RUN npm run build
`);
  }
  if (serverDir) {
    stages.push(`FROM node:20-alpine AS server-deps
WORKDIR /app/${serverDir}
COPY ${serverDir}/package.json ${serverDir}/package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

FROM node:20-alpine AS server-build
WORKDIR /app/${serverDir}
COPY --from=server-deps /app/${serverDir}/node_modules ./node_modules
COPY ${serverDir}/ ./
${prismaGen}`);
  } else {
    stages.push(`FROM node:20-alpine AS server-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . ./
${prismaGen}`);
  }

  const copies = [];
  if (serverDir) {
    copies.push(`COPY --from=server-build /app/${serverDir} /app/${serverDir}`);
  } else {
    copies.push(`COPY --from=server-build /app /app`);
  }
  if (clientDir) {
    copies.push(`COPY --from=client-build /app/${clientDir}/${a.clientBuildDir} /app/${clientDir}/${a.clientBuildDir}`);
  }

  const workdir = serverDir ? `WORKDIR /app/${serverDir}` : 'WORKDIR /app';
  const entry = a.serverEntryInDir || 'index.js';

  return `# syntax=docker/dockerfile:1
#
# Multi-stage production image for the generated ${slugify(a.title || 'app')} application.
# Stages: client build -> server build -> slim runtime.

FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production

${stages.join('\n')}
FROM node:20-alpine AS runtime
ENV NODE_ENV=production \\
    PORT=${a.port}
${workdir}
${copies.join('\n')}
# Drop dev dependencies from the runtime image.
RUN npm prune --omit=dev || true
USER node
EXPOSE ${a.port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \\
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||${a.port})+'/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))" || exit 1
CMD ["sh", "-c", "${migrate}node ${entry}"]
`;
}

function dockerignore() {
  return `node_modules
npm-debug.log
.git
.gitignore
.env
.env.*
!.env.example
!.env.production.example
client/dist
client/node_modules
server/node_modules
*.log
.DS_Store
`;
}

function compose(a) {
  const hasDb = a.db.provider && a.db.provider !== 'sqlite';
  const dbEnv =
    a.db.provider === 'mysql'
      ? 'DATABASE_URL=${DATABASE_URL:-mysql://app:app@db:3306/app}'
      : 'DATABASE_URL=${DATABASE_URL:-postgresql://app:app@db:5432/app}';
  const dbImage =
    a.db.provider === 'mysql' ? 'mysql:8' : a.db.provider === 'mongodb' ? 'mongo:7' : 'postgres:16-alpine';

  const dbService = hasDb
    ? `
  db:
    image: ${dbImage}
    restart: unless-stopped
    environment:
      ${a.db.provider === 'mysql'
        ? 'MYSQL_ROOT_PASSWORD: ${DB_PASSWORD:-app}\n      MYSQL_DATABASE: ${DB_NAME:-app}\n      MYSQL_USER: ${DB_USER:-app}\n      MYSQL_PASSWORD: ${DB_PASSWORD:-app}'
        : a.db.provider === 'mongodb'
        ? 'MONGO_INITDB_ROOT_USERNAME: ${DB_USER:-root}\n      MONGO_INITDB_ROOT_PASSWORD: ${DB_PASSWORD:-app}'
        : 'POSTGRES_USER: ${DB_USER:-app}\n      POSTGRES_PASSWORD: ${DB_PASSWORD:-app}\n      POSTGRES_DB: ${DB_NAME:-app}'}
    volumes:
      - dbdata:/var/lib/postgresql/data${a.db.provider === 'mysql' ? 'l' : ''}
    healthcheck:
      test: ["CMD-SHELL", ${a.db.provider === 'mysql' ? '"mysqladmin ping -h 127.0.0.1 -u$$MYSQL_USER -p$$MYSQL_PASSWORD"' : a.db.provider === 'mongodb' ? '"echo db.runCommand(\\"ping\\").ok || exit 1"' : '"pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"'}]
      interval: 10s
      timeout: 5s
      retries: 5`
    : '';

  const dependsOn = hasDb
    ? `
    depends_on:
      db:
        condition: service_healthy`
    : '';

  return `# Production compose stack for ${slugify(a.title || 'app')}.
# Usage: docker compose up -d --build
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "\${PORT:-${a.port}}:${a.port}"
    environment:
      NODE_ENV: production
      PORT: ${a.port}
${hasDb ? indentBlock(dbEnv, 6) : ''}
      JWT_SECRET: \${JWT_SECRET:-please-change-me}
${dependsOn}
    healthcheck:
      test: ["CMD-SHELL", "node -e \\"require('http').get('http://127.0.0.1:'+(process.env.PORT||${a.port})+'/health',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))\\""]
      interval: 30s
      timeout: 5s
      start_period: 15s
      retries: 3
${dbService}
volumes:
  dbdata:
`;
}

function envProduction(a) {
  const dbLine =
    a.db.provider === 'mysql'
      ? 'DATABASE_URL=mysql://app:app@localhost:3306/app'
      : a.db.provider === 'mongodb'
      ? 'DATABASE_URL=mongodb://root:app@localhost:27017/app?authSource=admin'
      : a.db.provider === 'sqlite'
      ? 'DATABASE_URL=file:./data/app.db'
      : 'DATABASE_URL=postgresql://app:app@localhost:5432/app';
  return `# ── Production environment ─────────────────────────────────────────────
# Copy to .env, fill in real values, and NEVER commit the resulting file.

# Server
NODE_ENV=production
PORT=${a.port}
${a.db.provider ? `${dbLine}` : ''}

# Auth
JWT_SECRET=generate-a-long-random-string
SESSION_SECRET=generate-a-different-long-random-string

# Public API base used by the frontend at build time
# (leave "/api" when served behind the same origin / reverse proxy)
VITE_API_URL=/api

# ── Platform-specific ──────────────────────────────────────────────────────
# Render / Railway / Vercel / Netlify commonly inject these at the platform
# level instead of shipping them in the repo. See DEPLOYMENT.md.
`;
}

function envExample(a) {
  const dbLine =
    a.db.provider === 'mysql'
      ? 'DATABASE_URL=mysql://app:app@localhost:3306/app'
      : a.db.provider === 'mongodb'
      ? 'DATABASE_URL=mongodb://root:app@localhost:27017/app?authSource=admin'
      : a.db.provider === 'sqlite'
      ? 'DATABASE_URL=file:./data/app.db'
      : 'DATABASE_URL=postgresql://app:app@localhost:5432/app';
  return `# Local development environment (copy to .env)
NODE_ENV=development
PORT=${a.port}
${a.db.provider ? `${dbLine}` : ''}
JWT_SECRET=dev-secret-change-me
SESSION_SECRET=dev-session-secret-change-me
VITE_API_URL=http://localhost:${a.port}/api
`;
}

function githubActions(a) {
  const clientSteps = a.hasClient
    ? `
      - name: Install frontend dependencies
        run: npm ci --prefix ${a.clientDir} || npm install --prefix ${a.clientDir}
      - name: Build frontend
        run: npm run build --prefix ${a.clientDir}
`
    : '';
  const serverInstall = a.hasServer
    ? `      - name: Install backend dependencies
        run: npm ci --prefix ${a.serverDir} || npm install --prefix ${a.serverDir}
`
    : '';
  const serverTest = a.hasServer && a.serverPkg?.scripts?.test
    ? `      - name: Run backend tests
        run: npm test --prefix ${a.serverDir}
`
    : '';

  return `name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
${clientSteps}${serverInstall}${serverTest}
`;
}

function githubDeploy(a) {
  const app = slugify(a.title || 'app');
  return `name: Deploy

on:
  push:
    branches: [main]

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          file: Dockerfile
          push: true
          tags: ghcr.io/\${{ github.repository }}/${app}:latest,\${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Deploy over SSH
        run: |
          echo "Connecting to \${{ secrets.DEPLOY_HOST }}"
          ssh -o StrictHostKeyChecking=no \${{ secrets.DEPLOY_USER }}@\${{ secrets.DEPLOY_HOST }} \\
            "cd \${{ secrets.DEPLOY_DIR }} && git pull && docker compose pull && docker compose up -d --build"
        env:
          GIT_SSH_COMMAND: "ssh -i \${{ github.workspace }}/deploy_key"
`;
}

function nginxConf(a) {
  return `# NGINX reverse proxy for ${slugify(a.title || 'app')}.
#
# Serves the built frontend from the shared volume /static and proxies /api
# to the Node backend service. Wire it up in docker-compose as an extra
# service:
#
#   nginx:
#     image: nginx:alpine
#     ports: ["80:80"]
#     volumes:
#       - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
#       - ./nginx/conf.d:/etc/nginx/conf.d:ro
#       - client_dist:/app/client/dist:ro
#     depends_on: [app]

events {}

http {
  include /etc/nginx/mime.types;
  sendfile on;
  gzip on;

  upstream backend {
    server app:${a.port};
  }

  server {
    listen 80;
    server_name _;

    root /app/client/${a.clientBuildDir};
    index index.html;

    location /api/ {
      proxy_pass http://backend;
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
    }

    location / {
      try_files $uri $uri/ /index.html;
    }

    location ~* \\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?)$ {
      expires 30d;
      add_header Cache-Control "public, immutable";
    }
  }
}
`;
}

function renderYaml(a) {
  const app = slugify(a.title || 'app');
  const start = a.hasServer ? `npm start --prefix ${a.serverDir}` : 'npm start';
  const build = [];
  if (a.hasClient) build.push(`npm install --prefix ${a.clientDir}`, `npm run build --prefix ${a.clientDir}`);
  if (a.hasServer) build.push(`npm install --prefix ${a.serverDir}`);
  const hasDb = a.db.provider && a.db.provider !== 'sqlite';
  const dbRef = hasDb ? `\n      - key: DATABASE_URL\n        fromDatabase:\n          name: ${app}-db\n          property: connectionString` : '';
  return `# Render blueprint (https://render.com/docs/blueprint-spec)
services:
  - type: web
    name: ${app}
    runtime: node
    plan: free
    buildCommand: ${build.join(' && ')}
    startCommand: ${start}
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: ${a.port}
      - key: JWT_SECRET
        sync: false
${dbRef}
databases:
  - name: ${app}-db
    plan: free
`;
}

function nixpacksToml(a) {
  const buildCmds = [];
  if (a.hasClient) buildCmds.push(`npm install --prefix ${a.clientDir}`, `npm run build --prefix ${a.clientDir}`);
  if (a.hasServer) buildCmds.push(`npm install --prefix ${a.serverDir}`);
  return `# Railway deployment via Nixpacks (https://railway.app).
# Deploy by connecting the repo and adding a Service with "Deploy" — Nixpacks
# will pick this up automatically.

[phases.setup]
nixPkgs = ["nodejs"]

[phases.install]
cmds = ${JSON.stringify(buildCmds)}

[start]
cmd = ${JSON.stringify(a.hasServer ? `npm start --prefix ${a.serverDir}` : 'npm start')}
`;
}

function vercelJson(a) {
  return {
    framework: a.isVite ? 'vite' : undefined,
    buildCommand: 'npm run build',
    outputDirectory: a.clientBuildDir,
    rewrites: [
      {
        source: '/api/:path*',
        destination: 'https://YOUR_BACKEND_URL/api/:path*',
      },
    ],
  };
}

function netlifyToml(a) {
  return `# Netlify configuration (frontend hosting).
[build]
  command = "npm run build"
  publish = "${a.clientBuildDir}"

# Proxy API calls to your backend (set to your live backend URL).
[[redirects]]
  from = "/api/*"
  to = "https://YOUR_BACKEND_URL/api/:splat"
  status = 200
  force = true

# SPA fallback — let React Router handle client-side routes.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
`;
}

function buildScript(a) {
  const lines = ['#!/usr/bin/env bash', 'set -euo pipefail', ''];
  if (a.hasClient) lines.push(`echo "Building frontend..."`, `(cd ${a.clientDir} && npm ci && npm run build)`, '');
  if (a.hasServer) lines.push(`echo "Installing backend dependencies..."`, `(cd ${a.serverDir} && npm ci --omit=dev)`, '');
  lines.push('echo "Build complete."');
  return lines.join('\n');
}

function startScript(a) {
  const start = a.hasServer ? `npm start --prefix ${a.serverDir}` : 'npm start';
  return `#!/usr/bin/env bash
set -euo pipefail
export NODE_ENV=production
${a.db.prisma ? `(cd ${a.serverDir || '.'} && npx prisma migrate deploy)\n` : ''}exec ${start}
`;
}

function deployScript(a) {
  return `#!/usr/bin/env bash
set -euo pipefail
# Production deploy helper for ${slugify(a.title || 'app')}.
# 1. docker compose up -d --build   -> build & start stack (app + database)
# 2. docker compose logs -f app     -> follow app logs
# 3. docker compose down            -> stop and remove containers

echo "==> Building and starting production stack"
docker compose up -d --build

echo "==> Following app logs (Ctrl+C to stop following)"
docker compose logs -f app
`;
}

function deploymentMd(a) {
  const app = slugify(a.title || 'app');
  const serverDir = a.hasServer ? ` \`--prefix ${a.serverDir}\`` : '';
  const lines = [];
  lines.push(`# Deploying "${a.title || 'App'}"`, '');
  lines.push(`Production-ready deployment configuration is included in this project.`, '');
  lines.push('', '## Files included', '', '```', 'Dockerfile                  Multi-stage production image', '.dockerignore', 'docker-compose.yml          App + database stack', `.env.production.example     Production env template`, '.github/workflows/ci.yml    CI (build + tests)', '.github/workflows/deploy.yml CD (build image, SSH deploy)', 'nginx/                      NGINX reverse proxy config', 'render.yaml                 Render blueprint', 'nixpacks.toml               Railway (Nixpacks)', `${a.clientDir ? `${a.clientDir}/vercel.json   Vercel frontend config\n${a.clientDir}/netlify.toml   Netlify frontend config` : ''}`, 'scripts/build.sh            Build everything', 'scripts/start.sh            Start the server in production', 'scripts/deploy.sh           Deploy with docker compose', '```', '');
  lines.push('## 1. Docker (any host)', '', '```bash', 'cp .env.production.example .env   # fill in real values', 'docker compose up -d --build', 'docker compose logs -f app', '```', '');
  lines.push('## 2. Render', '', '1. Push the repo to GitHub/GitLab.', '2. In Render, create a **Blueprint** and point it at the repository root.', `3. Render will read \`render.yaml\` automatically (web service + database).`, `4. Set \`JWT_SECRET\` in the service Environment tab.`, '');
  lines.push('## 3. Railway', '', '1. Connect the repository and create a **Service**.', '2. Railway uses Nixpacks — the included `nixpacks.toml` is applied automatically.', `3. Add a Postgres plugin and set \`DATABASE_URL\` on the service.`, '');
  lines.push('## 4. Vercel (frontend)', '', '1. Import the repository, **Root Directory**: `client` (Vercel reads `client/vercel.json`).', '2. Replace `YOUR_BACKEND_URL` in `client/vercel.json` with your live API URL.', '3. Deploy — the SPA is built and `/api/*` is rewritten to your backend.', '');
  lines.push('## 5. Netlify (frontend)', '', '1. Import the repository, **Base directory**: `client`, **Build command**: `npm run build`, **Publish directory**: `dist`.', '2. Update `YOUR_BACKEND_URL` in `client/netlify.toml`.', '3. Deploy. Netlify rewrites `/api/*` to your backend.', '');
  lines.push('## Environment', '', 'The server reads standard environment variables:', '', '```', `PORT=${a.port}`, `DATABASE_URL=${a.db.provider ? '…database connection string…' : '(not required)'}`, 'JWT_SECRET=…', 'VITE_API_URL=/api', '```', '', 'Generate secrets with `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"`.', '');
  lines.push(`> Hint: run the server locally with \`npm start${serverDir}\` after \`npm install${serverDir}\`.`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate the deployment bundle for a given file map.
 * @param {Object<string,string>} files path -> content
 * @param {{title?: string, stack?: string}} meta
 * @returns {{ files: {path:string, content:string}[], summary: string, analysis: object }}
 */
function generate(files, meta = {}) {
  const a = analyze(files || {});
  a.title = meta.title || 'Generated App';
  a.stack = meta.stack || 'Auto';
  const app = slugify(a.title);

  const bundle = [
    { path: 'Dockerfile', content: dockerfile(a) },
    { path: '.dockerignore', content: dockerignore() },
    { path: 'docker-compose.yml', content: compose(a) },
    { path: '.env.example', content: envExample(a) },
    { path: '.env.production.example', content: envProduction(a) },
    { path: '.github/workflows/ci.yml', content: githubActions(a) },
    { path: '.github/workflows/deploy.yml', content: githubDeploy(a) },
    { path: 'nginx/nginx.conf', content: nginxConf(a) },
    { path: 'render.yaml', content: renderYaml(a) },
    { path: 'nixpacks.toml', content: nixpacksToml(a) },
    { path: 'scripts/build.sh', content: buildScript(a) },
    { path: 'scripts/start.sh', content: startScript(a) },
    { path: 'scripts/deploy.sh', content: deployScript(a) },
    { path: 'DEPLOYMENT.md', content: deploymentMd(a) },
  ];

  if (a.hasClient && a.clientDir) {
    bundle.push({ path: `${a.clientDir}/vercel.json`, content: JSON.stringify(vercelJson(a), null, 2) + '\n' });
    bundle.push({ path: `${a.clientDir}/netlify.toml`, content: netlifyToml(a) });
  }

  return {
    files: bundle,
    summary: `Generated production-ready deployment config for ${app} — Docker, GitHub Actions, NGINX, env files and scripts, plus Render, Railway, Vercel and Netlify.`,
    analysis: {
      clientDir: a.clientDir,
      serverDir: a.serverDir,
      serverEntry: a.serverEntry,
      db: a.db,
      port: a.port,
      hasClient: a.hasClient,
      hasServer: a.hasServer,
      isVite: a.isVite,
    },
  };
}

/**
 * Analyze an existing project's file map without generating files.
 */
function inspect(files) {
  return analyze(files || {});
}

module.exports = { generate, inspect, slugify };
