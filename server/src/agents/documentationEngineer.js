const { BaseAgent, normalizeFiles } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Documentation Engineer agent. Write project documentation including a README.md file.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "files": [
    { "path": "README.md", "content": "..." }
  ],
  "summary": "1 sentence summary"
}

Rules:
- Generate 1-2 documentation files (mandatory README.md).
- CRITICAL: Escape all newlines in file content strings as \\n and double quotes as \\\".
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('Response must include a non-empty "files" array');
}

class DocumentationEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'documentation-engineer', displayName: 'Documentation Engineer', icon: 'file-text', color: '#c084fc' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      summary: context.prd?.summary,
      stack: context.prd?.stack,
      features: context.prd?.features,
      filePaths: Object.keys(context.files),
    };
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Write docs for:\n${JSON.stringify(spec, null, 2)}` },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.4, validateFn: validate, ...callbacks });
    const files = normalizeFiles(parsed);
    for (const f of files) {
      context.files[f.path] = f.content;
    }
    context.docs = { summary: parsed.summary || '', files };
    return context;
  }
}

module.exports = DocumentationEngineerAgent;
