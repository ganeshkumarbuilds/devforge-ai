const logger = require('../../utils/logger');
const { writeLog } = require('../buildLogService');

/**
 * ApiContractValidator — stage 2 of the Build Validation Pipeline.
 *
 * Scans the generated project for the contract between frontend and backend:
 *   1. Frontend API usage  — fetch(), axios.*(), axios({...}) and API-client
 *      base URL constants in every frontend source file.
 *   2. Backend Express routes — app/router.{get,post,put,patch,delete} in
 *      every backend source file (mount prefixes from app.use are folded in).
 *   3. Diff — any frontend call with no matching backend route is a missing
 *      endpoint. Every mismatch is reported and passed to self-healing.
 *   4. Repair — missing endpoints are deterministically regenerated as a
 *      routes/<resource>.js + controllers/<resource>Controller.js pair and
 *      mounted into the backend entrypoint when the entry uses CommonJS.
 */

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function matchParen(str, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < str.length; i++) {
    if (str[i] === '(') depth += 1;
    else if (str[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function matchBrace(str, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < str.length; i++) {
    if (str[i] === '{') depth += 1;
    else if (str[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

const STRING_LITERAL = /(['"`])((?:\\.|(?!\1).)*)\1/g;

function firstString(str) {
  STRING_LITERAL.lastIndex = 0;
  const m = STRING_LITERAL.exec(str);
  return m ? m[2] : null;
}

function methodFromObject(obj) {
  const m = /\bmethod\s*:\s*(['"])(get|post|put|patch|delete|head|options)\1/i.exec(obj);
  return m ? m[2].toLowerCase() : 'get';
}

function methodFromOptions(options) {
  if (!options) return 'get';
  const m = /\bmethod\s*:\s*(['"])(get|post|put|patch|delete|head|options)\1/i.exec(options);
  return m ? m[2].toLowerCase() : 'get';
}

/** Normalize a path for comparison: collapse params, strip trailing slash. */
function normalizePath(p) {
  let s = String(p || '')
    .replace(/\s+/g, '')
    .replace(/\$\{[^}]*\}/g, ':p') // template literal param
    .replace(/\{[^}]*\}/g, ':p')
    .replace(/:[a-zA-Z0-9_]+/g, ':p') // Express params
    .replace(/\/+/g, '/')
    .replace(/\/+$/, '');
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

/** Strip a leading /api mount prefix so both sides can be compared. */
function stripApi(p) {
  const n = normalizePath(p);
  return n.startsWith('/api') ? (n.slice(4) || '/') : n;
}

function segs(p) {
  return stripApi(p).split('/').filter(Boolean);
}

function methodOk(callMethod, routeMethod) {
  if (!routeMethod) return false;
  const c = String(callMethod || 'get').toLowerCase();
  const r = String(routeMethod).toLowerCase();
  if (c === r) return true;
  if (r === 'all' || r === 'use') return true;
  if ((c === 'get' || c === 'head') && (r === 'get' || r === 'head')) return true;
  return false;
}

function pathMatches(callSegs, routeSegs) {
  if (callSegs.length !== routeSegs.length) return false;
  for (let i = 0; i < callSegs.length; i++) {
    if (routeSegs[i] === ':p') continue; // param wildcard
    if (callSegs[i] !== routeSegs[i]) return false;
  }
  return true;
}

function isExternal(url) {
  return /^https?:\/\//i.test(url) || url.startsWith('//') || url.startsWith('data:') || url.startsWith('blob:');
}

function isTemplateLiteral(url) {
  return /[`]/.test(url) || /\$\{/.test(url);
}

/**
 * If the tail of a call contains string concatenation (`"/items/" + id`), the
 * effective URL has an id segment — treat the trailing "/" as a parameter.
 */
function applyConcatSuffix(url, rest) {
  if (!/\+/.test(rest)) return url;
  if (url.endsWith('/')) return `${url}:p`;
  return url;
}

// ---------------------------------------------------------------------------
// Frontend scan
// ---------------------------------------------------------------------------

function scanFetch(content, file, calls) {
  const re = /\bfetch\s*\(/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const open = re.lastIndex - 1;
    const close = matchParen(content, open);
    if (close === -1) continue;
    const inner = content.slice(open + 1, close);
    const first = firstString(inner);
    if (!first || isExternal(first) || isTemplateLiteral(first)) continue;
    const url = applyConcatSuffix(first, inner.slice(inner.indexOf(first) + first.length + 1));
    calls.push({ method: methodFromOptions(inner), url, file });
    re.lastIndex = close + 1;
  }
}

function scanAxios(content, file, calls) {
  // axios.get('/x'), axios.post('/x', body), etc.
  const vre = /\baxios\.(get|post|put|patch|delete|head|options)\s*\(\s*(['"`])/g;
  let m;
  while ((m = vre.exec(content)) !== null) {
    const start = m.index;
    const open = start + m[0].indexOf('(');
    const close = matchParen(content, open);
    if (close === -1) continue;
    const inner = content.slice(open + 1, close);
    const first = firstString(inner);
    if (!first || isExternal(first) || isTemplateLiteral(first)) continue;
    const url = applyConcatSuffix(first, inner.slice(inner.indexOf(first) + first.length + 1));
    calls.push({ method: m[1].toLowerCase(), url, file });
    vre.lastIndex = close + 1;
  }

  // axios({ url: '/x', method: 'POST' })
  const ore = /\baxios\s*\(\s*\{/g;
  while ((m = ore.exec(content)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchBrace(content, open);
    if (close === -1) continue;
    const obj = content.slice(open + 1, close);
    const urlRe = /\burl\s*:\s*(['"`])/;
    const um = urlRe.exec(obj);
    if (!um) continue;
    const first = firstString(obj.slice(um.index + um[0].length));
    if (!first || isExternal(first) || isTemplateLiteral(first)) continue;
    const url = applyConcatSuffix(first, obj.slice(um.index + um[0].length + first.length + 1));
    calls.push({ method: methodFromObject(obj), url, file });
    ore.lastIndex = close + 1;
  }
}

function scanApiBase(content, file, bases) {
  const re = /(?:const|let|var|export\s+const)\s+([A-Za-z0-9_]+)\s*=\s*['"]/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const name = m[1].toLowerCase();
    if (!/base|url|api|endpoint|host/.test(name)) continue;
    const rest = content.slice(re.lastIndex);
    const value = firstString(rest);
    if (!value || isExternal(value) || !value.includes('/api')) continue;
    bases.push({ name: m[1], url: value, file });
  }
}

/**
 * Scan every frontend source file for API calls.
 * @returns {{ calls: {method:string, url:string, file:string}[], bases: string[] }}
 */
function scanFrontend(files, clientDir) {
  const calls = [];
  const bases = [];
  const prefix = clientDir ? `${clientDir}/` : '';
  for (const [p, content] of Object.entries(files)) {
    if (!p.startsWith(prefix)) continue;
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte)$/.test(p)) continue;
    scanApiBase(content, p, bases);
    scanFetch(content, p, calls);
    scanAxios(content, p, calls);
  }
  // Prepend discovered base URLs to any relative call under them.
  const resolved = calls.map((c) => {
    if (c.url.startsWith('/')) return c;
    for (const b of bases) {
      if (c.url === b.url || c.url.startsWith(`${b.url}/`)) return { ...c, url: c.url };
    }
    return c;
  });
  return { calls: resolved, bases };
}

// ---------------------------------------------------------------------------
// Backend scan
// ---------------------------------------------------------------------------

/**
 * Scan every backend source file for Express route definitions.
 * @returns {{ routes: {method:string, path:string, file:string}[], mountPrefixes: string[] }}
 */
function scanBackend(files, serverDir) {
  const routes = [];
  const prefix = serverDir ? `${serverDir}/` : '';
  const mountPrefixes = [];

  // app.use('/api', ...) / router.use('/api', ...) mount prefixes.
  const useRe = /\b(?:app|router)\.use\s*\(\s*(['"`])([^'"`]+)\1/g;

  for (const [p, content] of Object.entries(files)) {
    if (!p.startsWith(prefix)) continue;
    if (!/\.(js|ts|mjs|cjs)$/.test(p)) continue;

    let m;
    useRe.lastIndex = 0;
    while ((m = useRe.exec(content)) !== null) {
      const mp = normalizePath(m[2]);
      if (!isExternal(mp) && mp.startsWith('/')) mountPrefixes.push(mp);
    }

    const routeRe = /\b(?:app|router)\.(get|post|put|patch|delete|head|options|all)\s*\(\s*(['"`])([^'"`]+)\2/g;
    routeRe.lastIndex = 0;
    while ((m = routeRe.exec(content)) !== null) {
      const routePath = normalizePath(m[3]);
      if (isExternal(routePath)) continue;
      routes.push({ method: m[1].toLowerCase(), path: routePath, file: p });
    }

    // router.route('/x').get(...) chaining
    const chainRe = /\brouter\.route\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
    chainRe.lastIndex = 0;
    while ((m = chainRe.exec(content)) !== null) {
      const base = normalizePath(m[2]);
      const block = content.slice(m.index + m[0].length, Math.min(content.length, m.index + m[0].length + 2000));
      for (const verb of HTTP_METHODS) {
        if (new RegExp(`\\.${verb}\\s*\\(`).test(block)) {
          routes.push({ method: verb, path: base, file: p });
        }
      }
    }
  }

  // Fold the most common mount prefix into bare "/" router paths. If a router
  // file only defines relative paths ("/health"), and the entry mounts it at
  // "/api", the effective path is "/api/health". We can't reliably attribute
  // routers to mounts, so we also keep the bare paths — matching is segment
  // based so both are checked.
  return { routes, mountPrefixes };
}

function fullRoutePaths(routes, mountPrefixes) {
  const list = [];
  for (const r of routes) {
    list.push(r);
    const joined = mountPrefixes.map((mp) => normalizePath(`${mp}${r.path === '/' ? '' : r.path}`));
    for (const jp of joined) {
      if (stripApi(jp) !== stripApi(r.path)) list.push({ ...r, path: jp });
    }
  }
  return list;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Compare frontend calls against backend routes.
 * @returns {{ ok: boolean, frontendCalls: number, backendRoutes: number, missing: any[], unused: any[] }}
 */
function validate(files, layout = {}) {
  const { calls } = scanFrontend(files, layout.clientDir);
  const { routes, mountPrefixes } = scanBackend(files, layout.serverDir);
  const allRoutes = fullRoutePaths(routes, mountPrefixes);

  const missing = [];
  for (const call of calls) {
    const matched = allRoutes.some((r) => methodOk(call.method, r.method) && pathMatches(segs(call.url), segs(r.path)));
    if (!matched) {
      missing.push({ method: call.method.toUpperCase(), path: normalizePath(call.url), file: call.file });
    }
  }

  const used = new Set();
  for (const call of calls) {
    for (const r of allRoutes) {
      if (methodOk(call.method, r.method) && pathMatches(segs(call.url), segs(r.path))) used.add(`${r.method} ${r.path}`);
    }
  }
  const unused = allRoutes
    .filter((r) => !used.has(`${r.method} ${r.path}`) && r.method !== 'all')
    .map((r) => ({ method: r.method.toUpperCase(), path: r.path, file: r.file }));

  const ok = missing.length === 0;
  if (!ok) {
    logger.warn(`[ApiContract] ${missing.length} frontend call(s) missing a backend route: ${missing.map((m) => `${m.method} ${m.path}`).join(', ')}`);
  }
  return { ok, frontendCalls: calls.length, backendRoutes: allRoutes.length, missing, unused };
}

// ---------------------------------------------------------------------------
// Deterministic repair
// ---------------------------------------------------------------------------

function resourceNameFromPath(path) {
  const parts = stripApi(path).split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (!last || last === ':p') return parts[parts.length - 2] || 'items';
  return last.replace(/[^a-zA-Z0-9_-]/g, '').replace(/s$/, '') || 'items';
}

/** Collection base path of a missing endpoint, e.g. /api/items for /api/items/:p. */
function basePathFromMissing(path) {
  const n = normalizePath(path);
  const parts = n.split('/').filter(Boolean);
  const idx = parts.indexOf(':p');
  const base = idx === -1 ? parts : parts.slice(0, idx);
  return `/${base.join('/')}`;
}

function genericController(resource) {
  return `const store = [];
let seq = 1;

exports.list = (req, res) => {
  res.json(store);
};

exports.getOne = (req, res) => {
  const item = store.find((i) => String(i.id) === String(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
};

exports.create = (req, res) => {
  const item = { id: seq++, ...(req.body || {}), createdAt: new Date().toISOString() };
  store.push(item);
  res.status(201).json(item);
};

exports.update = (req, res) => {
  const idx = store.findIndex((i) => String(i.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  store[idx] = { ...store[idx], ...(req.body || {}), id: store[idx].id };
  res.json(store[idx]);
};

exports.remove = (req, res) => {
  const idx = store.findIndex((i) => String(i.id) === String(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  store.splice(idx, 1);
  res.json({ ok: true });
};
`;
}

function genericRouter(resource) {
  return `const router = require('express').Router();
const ctrl = require('../controllers/${resource}Controller');

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.put('/:id', ctrl.update);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
`;
}

/**
 * Deterministically generate missing endpoints as routes/<resource>.js +
 * controllers/<resource>Controller.js and mount them into the backend entry.
 * @returns {string[]} paths added or changed
 */
function repair(files, layout, missing) {
  const serverDir = layout.serverDir;
  if (serverDir === null || serverDir === undefined) return [];
  const prefix = serverDir ? `${serverDir}/` : '';

  const entryRel = resolveEntry(files, serverDir);
  if (!entryRel) return [];
  const entry = files[`${prefix}${entryRel}`];
  if (!entry || !/\brequire\s*\(/.test(entry)) return [];

  const added = [];
  const done = new Set();
  const relPath = (rel) => (prefix ? `${prefix}${rel}` : rel);

  for (const m of missing) {
    const basePath = basePathFromMissing(m.path);
    if (done.has(basePath)) continue;
    done.add(basePath);

    const resource = resourceNameFromPath(m.path);
    const controllerPath = relPath(`controllers/${resource}Controller.js`);
    const routesPath = relPath(`routes/${resource}.js`);
    if (!Object.prototype.hasOwnProperty.call(files, controllerPath)) {
      files[controllerPath] = genericController(resource);
      added.push(controllerPath);
    }
    if (!Object.prototype.hasOwnProperty.call(files, routesPath)) {
      files[routesPath] = genericRouter(resource);
      added.push(routesPath);
    }
    // Only mount once per base path per repair pass.
    const mount = `app.use('${basePath}', require('./routes/${resource}'));`;
    if (!files[`${prefix}${entryRel}`].includes(mount)) {
      files[`${prefix}${entryRel}`] = mountEntry(files[`${prefix}${entryRel}`], mount);
      added.push(`${prefix}${entryRel}`);
    }
  }

  if (added.length) {
    logger.info(`[ApiContract] deterministic repair generated ${added.length} file(s) for missing endpoints.`);
  }
  return added;
}

function resolveEntry(files, serverDir) {
  const prefix = serverDir ? `${serverDir}/` : '';
  const candidates = ['server.js', 'index.js', 'app.js', 'main.js', 'src/index.js', 'src/server.js', 'src/app.js'];
  return candidates.find((c) => Object.prototype.hasOwnProperty.call(files, `${prefix}${c}`)) || null;
}

function mountEntry(entry, mountLine) {
  // Insert after `app.use(express.json())` if present, else before app.listen.
  const jsonRe = /app\.use\s*\(\s*express\.json\s*\(\s*\)\s*\)\s*;?/;
  if (jsonRe.test(entry)) {
    return entry.replace(jsonRe, (match) => `${match}\n${mountLine}`);
  }
  const listenRe = /\bapp\.listen\s*\(/;
  if (listenRe.test(entry)) {
    return entry.replace(listenRe, `${mountLine}\n\n$&`);
  }
  return `${entry}\n${mountLine}\n`;
}

// ---------------------------------------------------------------------------
// E2E helpers (auth + CRUD endpoint discovery)
// ---------------------------------------------------------------------------

function isAuthPath(p) {
  const n = stripApi(normalizePath(p));
  return /(auth|account|users?\/?$)/.test(n) || /login|register|signup|sign-in|sign-up|logout|signout|session/.test(n);
}

function findAuthEndpoints(backendRoutes) {
  const routes = backendRoutes.map((r) => ({ ...r, path: stripApi(normalizePath(r.path)) }));
  const pick = (re, method) => {
    const r = routes.find((x) => methodOk(method, x.method) && re.test(x.path));
    return r ? { method: r.method, path: r.path } : null;
  };
  return {
    register: pick(/register|signup|sign-up/, 'post'),
    login: pick(/login|sign-in/, 'post'),
    logout: pick(/logout|signout|sign-out|session/, 'post') || pick(/logout|signout|sign-out|session/, 'delete'),
  };
}

function findCrudResource(backendRoutes) {
  const routes = backendRoutes.map((r) => ({ ...r, path: stripApi(normalizePath(r.path)) }));
  const create = routes.find((r) => methodOk('post', r.method) && !isAuthPath(r.path) && segs(r.path).length >= 1);
  if (!create) return null;
  const base = create.path;
  const withId = `${base}/:p`;
  const update = routes.find((r) => (methodOk('put', r.method) || methodOk('patch', r.method)) && pathMatches(segs(withId), segs(r.path)));
  const remove = routes.find((r) => methodOk('delete', r.method) && pathMatches(segs(withId), segs(r.path)));
  const list = routes.find((r) => methodOk('get', r.method) && pathMatches(segs(base), segs(r.path)));
  if (!update || !remove) return null;
  return {
    base,
    create,
    update: update || create,
    remove,
    list: list || create,
  };
}

module.exports = {
  validate,
  scanFrontend,
  scanBackend,
  repair,
  normalizePath,
  stripApi,
  segs,
  pathMatches,
  methodOk,
  findAuthEndpoints,
  findCrudResource,
  resourceNameFromPath,
};
