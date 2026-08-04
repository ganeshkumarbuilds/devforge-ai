const { BaseAgent, normalizeFiles } = require('./baseAgent');
const documentationService = require('../services/documentationService');

class DocumentationEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'documentation-engineer', displayName: 'Documentation Engineer', icon: 'file-text', color: '#c084fc' });
  }

  async run(context, callbacks) {
    if (callbacks?.onProgress) {
      await callbacks.onProgress('Generating documentation bundle…');
    }

    const { files, summary, analysis } = documentationService.generate(context.files, {
      title: context.prd?.title,
      summary: context.prd?.summary,
      stack: context.prd?.stack,
      features: context.prd?.features,
      architecture: context.architecture?.architecture,
    });

    const normalized = normalizeFiles({ files });
    for (const f of normalized) {
      context.files[f.path] = f.content;
    }
    context.docs = { summary, files: normalized, analysis };

    if (callbacks?.onOutput) {
      await callbacks.onOutput(`Generated ${normalized.length} documentation files (README, API, OpenAPI, structure, architecture, ER diagram, setup, deployment).`);
    }
    return context;
  }
}

module.exports = DocumentationEngineerAgent;
