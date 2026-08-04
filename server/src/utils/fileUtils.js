const path = require('path');

const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', 'target', 'coverage',
  '__pycache__', '.venv', 'venv', 'env', '.next', '.nuxt', '.cache', 'vendor', 'bin', 'obj',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.bmp',
  '.zip', '.gz', '.tar', '.rar', '.7z', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.woff', '.woff2', '.ttf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.ogg', '.wasm', '.map',
]);

const LANGUAGE_MAP = {
  '.js': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
  '.py': 'python', '.html': 'html', '.css': 'css', '.scss': 'scss', '.json': 'json',
  '.md': 'markdown', '.sql': 'sql', '.yml': 'yaml', '.yaml': 'yaml', '.sh': 'shell',
  '.dockerfile': 'docker', '.java': 'java', '.go': 'go', '.rs': 'rust', '.rb': 'ruby',
  '.php': 'php', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cs': 'csharp', '.swift': 'swift',
  '.kt': 'kotlin', '.xml': 'xml', '.toml': 'toml', '.ini': 'ini', '.env': 'shell',
  '.vue': 'vue', '.svelte': 'svelte', '.graphql': 'graphql', '.proto': 'protobuf',
};

function languageOf(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  if (ext === '.dockerfile') return LANGUAGE_MAP['.dockerfile'];
  if (path.basename(filePath || '').toLowerCase() === 'dockerfile') return 'docker';
  return LANGUAGE_MAP[ext] || '';
}

function slugify(text) {
  return String(text || 'app')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'app';
}

function hasFile(files, filePath) {
  return Object.prototype.hasOwnProperty.call(files, filePath);
}

function parsePkg(files, filePath) {
  const raw = files[filePath];
  if (raw === undefined || raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isSourceFile(filePath) {
  if (!filePath) return false;
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  if (parts.some((p) => IGNORED_DIRS.has(p))) return false;
  if (/\.(min|bundle)\.(js|css)$/.test(normalized)) return false;
  const ext = path.extname(normalized).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return false;
  const basename = path.basename(normalized);
  if (basename.startsWith('.') && ext === '') return false;
  if (languageOf(normalized)) return true;
  if (['.txt', '.log'].includes(ext)) return false;
  return /\.(module|config|spec|test|rc)$/.test(normalized) || basename === 'dockerfile';
}

function normalizeFilePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function safeJoin(base, ...segments) {
  const parts = segments
    .filter(Boolean)
    .map((s) => String(s).replace(/^[/\\]+|[/\\]+$/g, ''));
  return [String(base).replace(/^[/\\]+|[/\\]+$/g, ''), ...parts].filter(Boolean).join('/');
}

module.exports = {
  IGNORED_DIRS,
  BINARY_EXTENSIONS,
  languageOf,
  slugify,
  hasFile,
  parsePkg,
  isSourceFile,
  normalizeFilePath,
  safeJoin,
};
