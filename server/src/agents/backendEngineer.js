const { BaseAgent, normalizeFiles, buildRepairInstruction } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Backend Engineer agent inside the DevForge AI platform. Given the product spec and database schema, generate backend application files.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "files": [
    { "path": "server/package.json", "content": "..." },
    { "path": "server/index.js", "content": "..." },
    { "path": "server/routes/api.js", "content": "..." }
  ],
  "summary": "1 sentence summary"
}

Rules:
- Generate 3-5 essential files for a working Node/Express backend.
- Keep each file clean, complete and working.
- CRITICAL: Escape all newlines in file content strings as \\n and double quotes as \\\".
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('Response must include a non-empty "files" array');
}

class BackendEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'backend-engineer', displayName: 'Backend Engineer', icon: 'terminal', color: '#34d399' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      summary: context.prd?.summary,
      features: context.prd?.features,
      dbSchema: context.database?.schema,
      dbFiles: (context.database?.files || []).map((f) => f.path),
    };
    const repairInstruction = buildRepairInstruction(context, 'backend');
    const userContent = `Build backend for:\n${JSON.stringify(spec, null, 2)}`;
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: repairInstruction ? `${userContent}\n\n${repairInstruction}` : userContent },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.3, validateFn: validate, ...callbacks });
    const files = normalizeFiles(parsed);
    
    // Ensure JSON files in backend are valid
    for (const f of files) {
      if (f.path.endsWith('.json')) {
        try {
          const parsedContent = JSON.parse(f.content);
          // If it's a valid JSON string (like escaped), parse and re-stringify it
          if (typeof f.content === 'string' && f.content.startsWith('"')) {
            f.content = JSON.stringify(parsedContent, null, 2);
          }
          console.log(`[Backend Engineer] Validated JSON file: ${f.path}`);
        } catch (jsonErr) {
          console.error(`[Backend Engineer] Invalid JSON in file ${f.path}: ${jsonErr.message}`);
          throw new Error(`Invalid JSON in file ${f.path}: ${jsonErr.message}`);
        }
      }
      context.files[f.path] = f.content;
    }
    
    context.backend = { summary: parsed.summary || '', files };
    return context;
  }
}

module.exports = BackendEngineerAgent;
