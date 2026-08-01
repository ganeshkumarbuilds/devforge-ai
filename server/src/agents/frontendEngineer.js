const { BaseAgent, normalizeFiles } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Frontend Engineer agent inside the DevForge AI platform. Given the product spec and backend API, generate frontend web application files.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "files": [
    { "path": "client/package.json", "content": "..." },
    { "path": "client/index.html", "content": "..." },
    { "path": "client/src/App.jsx", "content": "..." }
  ],
  "summary": "1 sentence summary"
}

Rules:
- Generate 3-5 essential files for a modern React + Vite + Tailwind frontend.
- Keep code clean, functional, and responsive.
- CRITICAL: Escape all newlines in file content strings as \\n and double quotes as \\\".
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('Response must include a non-empty "files" array');
}

class FrontendEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'frontend-engineer', displayName: 'Frontend Engineer', icon: 'layout', color: '#60a5fa' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      summary: context.prd?.summary,
      features: context.prd?.features,
      backendFiles: (context.backend?.files || []).map((f) => f.path),
    };
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Build frontend for:\n${JSON.stringify(spec, null, 2)}` },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.3, validateFn: validate, ...callbacks });
    const files = normalizeFiles(parsed);
    
    // Ensure JSON files in frontend are valid
    for (const f of files) {
      if (f.path.endsWith('.json')) {
        try {
          JSON.parse(f.content);
          console.log(`[Frontend Engineer] Validated JSON file: ${f.path}`);
        } catch (jsonErr) {
          console.error(`[Frontend Engineer] Invalid JSON in file ${f.path}: ${jsonErr.message}`);
          throw new Error(`Invalid JSON in file ${f.path}: ${jsonErr.message}`);
        }
      }
      context.files[f.path] = f.content;
    }
    
    context.frontend = { summary: parsed.summary || '', files };
    return context;
  }
}

module.exports = FrontendEngineerAgent;
