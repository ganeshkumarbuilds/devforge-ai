const { chat, extractCodeBlock } = require('../services/openrouterService');
const { agentMaxTokens } = require('../config');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AgentError extends Error {
  constructor(message, cause) {
    super(message);
    this.cause = cause;
  }
}

/**
 * Replace unescaped control characters (newlines, tabs, etc.) inside JSON string literals
 * while preserving valid JSON syntax outside strings.
 */
function sanitizeControlCharacters(text) {
  let clean = '';
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        clean += ch;
        escaped = false;
      } else if (ch === '\\') {
        clean += ch;
        escaped = true;
      } else if (ch === '"') {
        clean += ch;
        inString = false;
      } else if (ch === '\n') {
        clean += '\\n';
      } else if (ch === '\r') {
        clean += '\\r';
      } else if (ch === '\t') {
        clean += '\\t';
      } else {
        clean += ch;
      }
    } else {
      if (ch === '"') {
        inString = true;
      }
      clean += ch;
    }
  }
  return clean;
}

/**
 * Attempt to repair a truncated JSON string by closing open strings,
 * arrays and objects at the end of the text.
 */
function repairJson(text) {
  if (!text || typeof text !== 'string') return null;
  let result = text.trim();
  const stack = [];
  let inString = false;
  let escaped = false;
  let lastSignificantIndex = -1;

  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      lastSignificantIndex = i;
      continue;
    }
    if (ch === '"') {
      inString = true;
      lastSignificantIndex = i;
      continue;
    }
    if (ch === '{' || ch === '[') {
      stack.push(ch === '{' ? '}' : ']');
      lastSignificantIndex = i;
    } else if (ch === '}' || ch === ']') {
      if (stack.length && stack[stack.length - 1] === ch) {
        stack.pop();
      }
      lastSignificantIndex = i;
    } else if (!/\s/.test(ch)) {
      lastSignificantIndex = i;
    }
  }

  // Drop trailing garbage that cannot be part of the last token.
  if (lastSignificantIndex >= 0 && lastSignificantIndex < result.length - 1) {
    result = result.slice(0, lastSignificantIndex + 1);
  }

  // If we ended inside a string, close it safely.
  if (inString) {
    if (result.endsWith('\\')) {
      result = result.slice(0, -1);
    }
    result += '"';
  }

  // Close unclosed brackets/braces.
  while (stack.length) {
    result += stack.pop();
  }

  if (lastSignificantIndex === -1) return null;
  try {
    return JSON.parse(result);
  } catch {
    return null;
  }
}

/**
 * Extract and parse a valid JSON object from LLM output.
 * Strips markdown code fences, removes surrounding text, sanitizes control characters,
 * and validates schema if a validator function is provided.
 */
function parseJsonResponse(text, validateFn = null) {
  if (!text || typeof text !== 'string') {
    const err = new AgentError('Empty response received from LLM');
    err.raw = text || '';
    throw err;
  }

  // 1. Log raw AI response before parsing
  logger.info(`[JSON Parse] Raw AI response (${text.length} chars):`);
  logger.info(`[JSON Parse] ${text}`);

  // 2. Strip ```json and ``` markdown fences
  let clean = text
    .replace(/^```json\\s*/gm, '')
    .replace(/^```\\s*/gm, '')
    .replace(/```$/gm, '')
    .trim();

  // 3. Remove any text before the first { and after the last }
  const firstBrace = clean.indexOf('{');
  const lastBrace = clean.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    clean = clean.slice(firstBrace, lastBrace + 1);
  }

  const candidates = [clean];
  const codeBlock = extractCodeBlock(text);
  if (codeBlock && codeBlock !== clean) {
    candidates.push(codeBlock);
  }
  candidates.push(text.trim());

  let lastError = null;

  for (const candidate of candidates) {
    if (!candidate) continue;

    // Direct JSON.parse
    try {
      const parsed = JSON.parse(candidate);
      if (validateFn) validateFn(parsed);
      return parsed;
    } catch (e) {
      lastError = e;
    }

    // Sanitize unescaped control characters in strings
    try {
      const sanitized = sanitizeControlCharacters(candidate);
      const parsed = JSON.parse(sanitized);
      if (validateFn) validateFn(parsed);
      return parsed;
    } catch (e) {
      lastError = e;
    }

    // Repair truncated JSON
    try {
      const repaired = repairJson(candidate);
      if (repaired) {
        if (validateFn) validateFn(repaired);
        return repaired;
      }
    } catch (e) {
      lastError = e;
    }

    // Sanitize + Repair combined
    try {
      const sanitized = sanitizeControlCharacters(candidate);
      const repaired = repairJson(sanitized);
      if (repaired) {
        if (validateFn) validateFn(repaired);
        return repaired;
      }
    } catch (e) {
      lastError = e;
    }
  }

  logger.warn(`[JSON Parse Error] ${lastError ? lastError.message : 'Invalid JSON'} | Sample: ${text.slice(0, 200)}`);
  const err = new AgentError(`Agent returned invalid JSON: ${lastError ? lastError.message : 'Parse failed'}`);
  err.raw = text;
  err.cause = lastError;
  throw err;
}

/**
 * Post-parse validation: ensure JSON in file contents is valid if provided.
 */
function validateFileContents(parsed) {
  if (!parsed || !Array.isArray(parsed.files)) return parsed;

  const validatedFiles = [];
  for (const file of parsed.files) {
    if (!file || !file.path || typeof file.content !== 'string') {
      validatedFiles.push(file);
      continue;
    }

    // Validate JSON files
    if (file.path.endsWith('.json')) {
      try {
        let content = file.content;

        // Try to parse as JSON - if it fails, try to fix it
        try {
          const parsedContent = JSON.parse(content);
          // If successful, re-stringify with proper formatting
          content = JSON.stringify(parsedContent, null, 2);
        } catch (parseErr) {
          // If parsing fails, check if it's an escaped JSON string
          // by removing surrounding quotes and trying again
          if (content.startsWith('"') && content.endsWith('"')) {
            try {
              const unescaped = content.slice(1, -1);
              const parsedContent = JSON.parse(unescaped);
              content = JSON.stringify(parsedContent, null, 2);
            } catch (unescapedErr) {
              // Both attempts failed, throw error
              logger.error(`[JSON Parse] Invalid JSON in file ${file.path}: ${unescapedErr.message}`);
              logger.error(`[JSON Parse] Content: ${file.content.substring(0, 500)}...`);
              throw new AgentError(`Invalid JSON in file ${file.path}: ${parseErr.message}`);
            }
          } else {
            logger.error(`[JSON Parse] Invalid JSON in file ${file.path}: ${parseErr.message}`);
            logger.error(`[JSON Parse] Content: ${file.content.substring(0, 500)}...`);
            throw new AgentError(`Invalid JSON in file ${file.path}: ${parseErr.message}`);
          }
        }

        validatedFiles.push({ ...file, content });
      } catch (jsonErr) {
        logger.error(`[JSON Parse] Invalid JSON in file ${file.path}: ${jsonErr.message}`);
        throw new AgentError(`Invalid JSON in file ${file.path}: ${jsonErr.message}`);
      }
    } else {
      validatedFiles.push(file);
    }
  }

  // Create a new parsed object with validated files
  return {
    ...parsed,
    files: validatedFiles,
  };
}

/**
 * Validate a generated relative file path for safety (no traversal/absolute).
 */
function isSafePath(p) {
  if (!p || typeof p !== 'string') return false;
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) {
    return false;
  }
  return true;
}

/**
 * Normalize a parsed `files` array into a safe array of {path, content}.
 */
function normalizeFiles(parsed) {
  const files = [];
  if (!parsed || !Array.isArray(parsed.files)) return files;
  for (const f of parsed.files) {
    if (!f || !f.path || typeof f.path !== 'string') continue;
    if (!isSafePath(f.path)) {
      logger.warn('[Agent] Skipping unsafe path:', f.path);
      continue;
    }
    files.push({ path: f.path.replace(/\\/g, '/'), content: String(f.content ?? '') });
  }
  return files;
}

class BaseAgent {
  constructor({ role, displayName, icon, color }) {
    this.role = role;
    this.displayName = displayName;
    this.icon = icon;
    this.color = color;
  }

  async callModel({ messages, temperature, onProgress }) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await chat({
          messages,
          options: {
            temperature: temperature ?? 0.7,
            num_predict: agentMaxTokens,
          },
          onProgress,
        });
      } catch (err) {
        lastError = err;
        logger.warn(`[Agent ${this.role}] Call attempt ${attempt} failed: ${err.message}`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BASE_DELAY_MS * attempt);
        }
      }
    }
    const detail = lastError && lastError.message ? `: ${lastError.message}` : '';
    throw new AgentError(`Model call failed after ${MAX_ATTEMPTS} attempts${detail}`, lastError);
  }

  /**
   * Run the model with retry + JSON output contract and optional schema validation.
   */
  async runJson({ messages, temperature, validateFn, onProgress, onOutput }) {
    let lastError = null;
    let lastRaw = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { content } = await this.callModel({ messages, temperature, onProgress });
        lastRaw = content;
        if (onOutput) onOutput(content);
        let parsed = parseJsonResponse(content, validateFn);
        
        // Validate JSON in file contents
        parsed = validateFileContents(parsed);
        
        return { parsed, raw: content, attempts: attempt };
      } catch (err) {
        lastError = err;
        lastRaw = err && err.raw ? err.raw : lastRaw;
        logger.warn(`[Agent ${this.role}] JSON attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err.message}`);
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BASE_DELAY_MS * attempt);
        }
      }
    }

    // Retry with stricter prompt
    if (lastRaw) {
      logger.info(`[Agent ${this.role}] Retrying with strict JSON-only prompt...`);
      try {
        const retryMessages = [
          ...messages,
          { role: 'assistant', content: lastRaw },
          {
            role: 'user',
            content: 'Return ONLY valid JSON. No markdown, no explanations, no comments.',
          },
        ];
        const { content } = await this.callModel({ messages: retryMessages, temperature: 0.1, onProgress });
        if (onOutput) onOutput(content);
        let parsed = parseJsonResponse(content, validateFn);
        parsed = validateFileContents(parsed);
        return { parsed, raw: content, attempts: MAX_ATTEMPTS + 1, retried: true };
      } catch (retryErr) {
        lastError = retryErr;
      }
    }

    // Last resort repair: ask LLM to output ONLY the valid JSON object
    if (lastRaw) {
      logger.info(`[Agent ${this.role}] Triggering LLM JSON repair prompt...`);
      try {
        const repairMessages = [
          ...messages,
          { role: 'assistant', content: lastRaw },
          {
            role: 'user',
            content:
              'Your previous output contained invalid JSON syntax or missing required fields. ' +
              'Return ONLY a single valid JSON object strictly adhering to the requested schema. ' +
              'Do NOT wrap in markdown fences. Escape all newlines inside code strings with \\n.',
          },
        ];
        const { content } = await this.callModel({ messages: repairMessages, temperature: 0.1, onProgress });
        if (onOutput) onOutput(content);
        let parsed = parseJsonResponse(content, validateFn);
        parsed = validateFileContents(parsed);
        return { parsed, raw: content, attempts: MAX_ATTEMPTS + 1, repaired: true };
      } catch (repairErr) {
        lastError = repairErr;
      }
    }

    const finalErr = lastError instanceof AgentError
      ? lastError
      : new AgentError(`Agent ${this.role} failed after ${MAX_ATTEMPTS} attempts: ${lastError ? lastError.message : 'Unknown error'}`, lastError);
    finalErr.raw = lastRaw || '';
    throw finalErr;
  }
}

module.exports = {
  BaseAgent,
  AgentError,
  parseJsonResponse,
  sanitizeControlCharacters,
  repairJson,
  isSafePath,
  normalizeFiles,
  sleep,
};
