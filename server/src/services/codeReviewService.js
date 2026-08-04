const AdmZip = require('adm-zip');
const { chat, isConfigured } = require('./openrouterService');
const { parseJsonResponse, AgentError } = require('../agents/baseAgent');
const { languageOf, isSourceFile } = require('../utils/fileUtils');
const logger = require('../utils/logger');

const CATEGORIES = [
  { key: 'bugs', label: 'Bugs & Errors' },
  { key: 'performance', label: 'Performance' },
  { key: 'security', label: 'Security' },
  { key: 'best_practices', label: 'Best Practices' },
  { key: 'complexity', label: 'Complexity' },
  { key: 'code_smells', label: 'Code Smells' },
];

const SEVERITIES = ['critical', 'high', 'medium', 'low'];

// Analysis budget to stay within model context limits.
const MAX_FILES = 30;
const MAX_FILE_CHARS = 6000;
const MAX_TOTAL_CHARS = 50000;

function sanitizePath(raw) {
  let p = String(raw || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  if (p.startsWith('/')) p = p.slice(1);
  const segments = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') continue;
    if (/^[a-zA-Z]:/.test(seg)) continue;
    segments.push(seg);
  }
  return segments.join('/');
}

function isZip(buffer) {
  if (!buffer || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Normalize uploaded files (individual files, folders, ZIP archives) into a list
 * of source files ready for analysis.
 */
function extractSourceFiles(uploaded) {
  const files = [];
  const pushSource = (p, content) => {
    const cleanPath = sanitizePath(p);
    if (!cleanPath || !isSourceFile(cleanPath)) return;
    if (content.length > MAX_FILE_CHARS) content = content.slice(0, MAX_FILE_CHARS);
    files.push({ path: cleanPath, content, language: languageOf(cleanPath) });
  };

  for (const item of uploaded) {
    const buffer = Buffer.isBuffer(item.buffer) ? item.buffer : Buffer.from(item.content || '');
    const rawPath = item.path || item.originalname || 'file';
    const isArchive = item.mimetype === 'application/zip' || rawPath.toLowerCase().endsWith('.zip') || isZip(buffer);

    if (isArchive && buffer.length > 4) {
      try {
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.isDirectory) continue;
          if (entry.entryName.includes('__MACOSX')) continue;
          let content = '';
          try {
            content = entry.getData().toString('utf8');
          } catch {
            continue; // binary entry
          }
          pushSource(entry.entryName, content);
        }
      } catch (err) {
        logger.warn(`[Review] failed to extract zip ${rawPath}: ${err.message}`);
      }
      continue;
    }

    pushSource(rawPath, buffer.toString('utf8'));
  }

  // Deduplicate by path, keeping the first occurrence.
  const seen = new Set();
  const unique = [];
  for (const f of files) {
    if (seen.has(f.path)) continue;
    seen.add(f.path);
    unique.push(f);
  }
  return unique.slice(0, MAX_FILES);
}

function buildContext(files) {
  const used = [];
  let total = 0;
  for (const f of files) {
    const remaining = MAX_TOTAL_CHARS - total;
    if (remaining <= 0) break;
    const content = f.content.slice(0, remaining);
    used.push({ path: f.path, content });
    total += content.length + f.path.length;
  }
  return used;
}

const SYSTEM_PROMPT = `You are the Senior Code Reviewer agent inside the DevForge AI platform. Analyze the provided source files for bugs, performance issues, security vulnerabilities, best-practice violations, complexity problems and code smells.

You MUST respond with ONLY a single valid JSON object (no markdown fences, no extra text):

{
  "summary": "2-3 sentence overall assessment of the codebase",
  "categories": {
    "bugs": [
      { "file": "relative/path", "line": 12, "severity": "high", "title": "Short title", "explanation": "Why this is a problem", "fix": "Concrete suggested fix" }
    ],
    "performance": [],
    "security": [],
    "best_practices": [],
    "complexity": [],
    "code_smells": []
  }
}

Rules:
- severity must be one of: "critical", "high", "medium", "low".
- "line" may be null if unknown.
- Be precise and reference the actual file path and line number where possible.
- Only report genuine issues; prefer a few high-quality findings over many weak ones.
- Escape all double quotes and newlines inside string values.
- Return STRICT JSON ONLY.`;

function validateFindings(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new AgentError('Response is not a JSON object');
  if (typeof parsed.summary !== 'string') parsed.summary = '';
  if (!parsed.categories || typeof parsed.categories !== 'object') {
    parsed.categories = {};
  }
  for (const [key, list] of Object.entries(parsed.categories)) {
    if (!Array.isArray(list)) {
      parsed.categories[key] = [];
      continue;
    }
    for (const finding of list) {
      if (!finding || typeof finding !== 'object') continue;
      if (!finding.title) finding.title = 'Untitled finding';
      if (!SEVERITIES.includes(finding.severity)) finding.severity = 'medium';
      if (typeof finding.explanation !== 'string') finding.explanation = '';
      if (typeof finding.fix !== 'string') finding.fix = '';
      if (finding.file && typeof finding.file !== 'string') finding.file = '';
      if (finding.line != null && typeof finding.line !== 'number') {
        const n = parseInt(finding.line, 10);
        finding.line = Number.isFinite(n) ? n : null;
      }
    }
  }
}

/**
 * Run the AI analysis over the extracted files and normalize the result into a
 * flat list of findings plus per-category severity scores.
 */
async function analyzeCode(files) {
  if (!isConfigured()) {
    throw new AgentError(
      'OpenRouter is not configured',
      'Set OPENROUTER_API_KEY and OPENROUTER_MODEL in server/.env and restart the server.'
    );
  }
  if (!files || files.length === 0) {
    throw new AgentError('No source files were provided for analysis');
  }

  const contextFiles = buildContext(files);
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Analyze the following ${contextFiles.length} file(s):\n${JSON.stringify(contextFiles)}` },
  ];

  const { content } = await chat({
    messages,
    options: { temperature: 0.2 },
  });

  const parsed = parseJsonResponse(content, validateFindings);

  const findings = [];
  for (const { key, label } of CATEGORIES) {
    const list = parsed.categories[key] || [];
    for (const f of list) {
      findings.push({
        category: key,
        categoryLabel: label,
        file: f.file || '',
        line: f.line ?? null,
        severity: f.severity || 'medium',
        title: f.title,
        explanation: f.explanation,
        fix: f.fix,
      });
    }
  }

  const scores = {
    total: findings.length,
    bySeverity: { critical: 0, high: 0, medium: 0, low: 0 },
    categories: {},
  };
  for (const f of findings) {
    scores.bySeverity[f.severity] = (scores.bySeverity[f.severity] || 0) + 1;
  }
  for (const { key, label } of CATEGORIES) {
    const bucket = findings.filter((f) => f.category === key);
    const counts = { count: bucket.length, critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of bucket) counts[f.severity] += 1;
    scores.categories[key] = { label, ...counts };
  }

  return { summary: parsed.summary || '', findings, scores };
}

function findingsToMarkdown(review) {
  const lines = [];
  lines.push(`# AI Code Review — ${review.name}`);
  lines.push('');
  lines.push(`- **Status:** ${review.status}`);
  lines.push(`- **Reviewed files:** ${Array.isArray(review.files) ? review.files.length : 0}`);
  lines.push(`- **Findings:** ${review.scores?.total ?? 0}`);
  lines.push(`- **Generated:** ${new Date(review.createdAt).toISOString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(review.summary || 'No summary available.');
  lines.push('');
  lines.push('## Findings');
  lines.push('');

  const results = review.results || [];
  const severities = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
  for (const f of results) {
    lines.push(`### ${severities[f.severity] || '·'} [${f.categoryLabel}] ${f.title}`);
    lines.push('');
    if (f.file) lines.push(`- **File:** \`${f.file}\`${f.line ? `:${f.line}` : ''}`);
    lines.push(`- **Severity:** ${f.severity}`);
    if (f.explanation) lines.push('');
    if (f.explanation) lines.push(`**Explanation:** ${f.explanation}`);
    if (f.fix) lines.push('');
    if (f.fix) lines.push(`**Suggested fix:** ${f.fix}`);
    lines.push('');
  }

  if (results.length === 0) {
    lines.push('No issues found in the analyzed files. Well done!');
    lines.push('');
  }

  lines.push('---');
  lines.push('Generated by DevForge AI Code Review.');
  return lines.join('\n');
}

module.exports = {
  CATEGORIES,
  SEVERITIES,
  extractSourceFiles,
  analyzeCode,
  findingsToMarkdown,
  isSourceFile,
  languageOf,
};
