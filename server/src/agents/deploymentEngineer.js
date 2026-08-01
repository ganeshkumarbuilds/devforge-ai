const { BaseAgent, normalizeFiles } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Deployment Engineer agent. Create deployment configuration files.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "files": [
    { "path": "Dockerfile", "content": "..." },
    { "path": "docker-compose.yml", "content": "..." }
  ],
  "summary": "1 sentence summary"
}

Rules:
- Generate 2-3 deployment files (Dockerfile, docker-compose.yml, etc.).
- CRITICAL: Escape all newlines in file content strings as \\n and double quotes as \\\".
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('Response must include a non-empty "files" array');
}

class DeploymentEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'deployment-engineer', displayName: 'Deployment Engineer', icon: 'rocket', color: '#f87171' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      stack: context.prd?.stack,
      filePaths: Object.keys(context.files),
    };
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Create deployment config for:\n${JSON.stringify(spec, null, 2)}` },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.3, validateFn: validate, ...callbacks });
    const files = normalizeFiles(parsed);
    for (const f of files) {
      context.files[f.path] = f.content;
    }
    context.deployment = { summary: parsed.summary || '', files };
    return context;
  }
}

module.exports = DeploymentEngineerAgent;
