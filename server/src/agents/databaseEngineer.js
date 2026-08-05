const { BaseAgent, normalizeFiles, buildRepairInstruction } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Database Engineer agent inside the DevForge AI platform. Given the product spec and architecture, design the database schema and generate database files.

You MUST respond with ONLY a single JSON object with no markdown fences, no explanations, no preamble, and no extra text:
{
  "schema": "Short description of database tables/models",
  "files": [
    { "path": "server/db/schema.sql", "content": "..." },
    { "path": "server/db/db.js", "content": "..." }
  ],
  "summary": "1 sentence summary"
}

Rules:
- Generate 1-3 concise files (e.g., schema.sql, db.js).
- Keep file contents concise and working.
- CRITICAL: Escape all newlines in file content strings as \\n and double quotes as \\\".
- Return STRICT JSON ONLY.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) throw new Error('Response must include a non-empty "files" array');
}

class DatabaseEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'database-engineer', displayName: 'Database Engineer', icon: 'database', color: '#38bdf8' });
  }

  async run(context, callbacks) {
    const spec = {
      title: context.prd?.title,
      summary: context.prd?.summary,
      stack: context.prd?.stack,
      architecture: context.architecture?.architecture,
    };
    const repairInstruction = buildRepairInstruction(context, 'database');
    const userContent = `Design data layer for:\n${JSON.stringify(spec, null, 2)}`;
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: repairInstruction ? `${userContent}\n\n${repairInstruction}` : userContent },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.3, validateFn: validate, ...callbacks });
    const files = normalizeFiles(parsed);
    
    // Ensure JSON files in database layer are valid
    for (const f of files) {
      if (f.path.endsWith('.json')) {
        try {
          const parsedContent = JSON.parse(f.content);
          // If it's a valid JSON string (like escaped), parse and re-stringify it
          if (typeof f.content === 'string' && f.content.startsWith('"')) {
            f.content = JSON.stringify(parsedContent, null, 2);
          }
          console.log(`[Database Engineer] Validated JSON file: ${f.path}`);
        } catch (jsonErr) {
          console.error(`[Database Engineer] Invalid JSON in file ${f.path}: ${jsonErr.message}`);
          throw new Error(`Invalid JSON in file ${f.path}: ${jsonErr.message}`);
        }
      }
      context.files[f.path] = f.content;
    }
    
    context.database = {
      schema: parsed.schema || '',
      summary: parsed.summary || '',
      files,
    };
    return context;
  }
}

module.exports = DatabaseEngineerAgent;
