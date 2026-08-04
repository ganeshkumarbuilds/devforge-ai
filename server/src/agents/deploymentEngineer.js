const { BaseAgent } = require('./baseAgent');
const deploymentService = require('../services/deploymentService');

const PLATFORMS = ['Render', 'Railway', 'Vercel', 'Netlify'];

/**
 * Deterministic deployment generator. Replaces the LLM-based approach with a
 * structure-aware generator so every project receives production-ready config:
 * Dockerfile, docker-compose, GitHub Actions, NGINX, env files, deployment
 * scripts, and platform configs for Render, Railway, Vercel and Netlify.
 */
class DeploymentEngineerAgent extends BaseAgent {
  constructor() {
    super({ role: 'deployment-engineer', displayName: 'Deployment Engineer', icon: 'rocket', color: '#f87171' });
  }

  async run(context, callbacks = {}) {
    const title = context.prd?.title || context.architect?.title || 'Generated App';
    const progress = async (text) => {
      if (callbacks.onProgress) await callbacks.onProgress(text);
    };

    await progress('Analyzing generated project structure…');
    const result = deploymentService.generate(context.files, { title, stack: context.prd?.stack });

    for (const f of result.files) {
      context.files[f.path] = f.content;
    }

    await progress(`Generated ${result.files.length} deployment artifacts across ${PLATFORMS.join(', ')}.`);

    context.deployment = {
      summary: result.summary,
      files: result.files,
      platforms: PLATFORMS,
      analysis: result.analysis,
    };
    return context;
  }
}

module.exports = DeploymentEngineerAgent;
