const { BaseAgent, normalizeFiles } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the QA Engineer agent. Given the generated project, review the architecture and write test files.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "review": "2-3 sentence review of code quality",
  "files": [
    { "path": "server/tests/api.test.js", "content": "..." }
  ],
  "summary": "1 sentence summary"
}

Rules:
- Generate 1-2 test files.
- CRITICAL: Escape all newlines in file content strings as \\n and double quotes as \\\".
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!Array.isArray(parsed.files)) throw new Error('Response must include a "files" array');
}

class QAEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'qa-engineer', displayName: 'QA Engineer', icon: 'shield', color: '#fb7185' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      filePaths: Object.keys(context.files),
    };
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Review and test:\n${JSON.stringify(spec, null, 2)}` },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.3, validateFn: validate, ...callbacks });
    const files = normalizeFiles(parsed);
    for (const f of files) {
      context.files[f.path] = f.content;
    }
    context.qa = { review: parsed.review || '', summary: parsed.summary || '', files };
    return context;
  }
}

module.exports = QAEngineerAgent;
