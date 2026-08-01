const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Software Architect agent inside the DevForge AI platform. Given a product specification, design the system architecture and folder structure.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "architecture": "A 2-3 sentence description of the architecture",
  "structure": "A plain-text folder/file tree of the project",
  "decisions": ["Architectural decision 1", "Decision 2"],
  "keyFiles": ["server/index.js", "client/src/App.jsx"]
}

Rules:
- Keep the structure realistic and minimal (10-20 files total).
- Prefer a root with /client and /server.
- Escape all double quotes inside strings.
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!parsed.architecture && !parsed.structure) throw new Error('Missing architecture or structure field');
}

class ArchitectAgent extends BaseAgent {
  constructor() {
    super({ role: 'architect', displayName: 'Architect', icon: 'compass', color: '#f59e0b' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      summary: context.prd?.summary,
      stack: context.prd?.stack,
      features: context.prd?.features,
    };
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `Design architecture for:\n${JSON.stringify(spec, null, 2)}` },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.4, validateFn: validate, ...callbacks });
    context.architecture = {
      architecture: parsed.architecture || '',
      structure: parsed.structure || '',
      decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
      keyFiles: Array.isArray(parsed.keyFiles) ? parsed.keyFiles : [],
    };
    return context;
  }
}

module.exports = ArchitectAgent;
