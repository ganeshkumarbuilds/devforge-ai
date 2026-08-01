const { BaseAgent } = require('./baseAgent');

const SYSTEM_PROMPT = `You are the Product Manager agent inside the DevForge AI platform. Your job is to take a rough idea and turn it into a precise, buildable product specification.

You MUST respond with ONLY a single JSON object (no markdown, no extra text):
{
  "title": "A concise project title (max 6 words)",
  "summary": "1-2 sentence product summary",
  "stack": "Recommended tech stack, e.g. React + Express + SQLite",
  "features": ["Feature 1", "Feature 2"],
  "requirements": ["Concrete requirement 1"]
}

Rules:
- Title: max 6 words.
- Features: 4-6 distinct, actionable features.
- Requirements: 4-8 concrete requirements.
- Escape all double quotes inside string fields.
- Output ONLY the JSON object.`;

function validate(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Response is not a JSON object');
  if (!parsed.title && !parsed.summary) throw new Error('Missing title or summary');
}

class ProductManagerAgent extends BaseAgent {
  constructor() {
    super({ role: 'product-manager', displayName: 'Product Manager', icon: 'clipboard', color: '#a78bfa' });
  }

  async run(context, callbacks) {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `User request:\n${context.prompt}` },
    ];
    const { parsed } = await this.runJson({ messages, temperature: 0.5, validateFn: validate, ...callbacks });
    context.prd = {
      title: (parsed.title || 'Untitled Project').slice(0, 80),
      summary: parsed.summary || '',
      stack: parsed.stack || 'React + Express + SQLite',
      features: Array.isArray(parsed.features) ? parsed.features : [],
      requirements: Array.isArray(parsed.requirements) ? parsed.requirements : [],
    };
    return context;
  }
}

module.exports = ProductManagerAgent;
