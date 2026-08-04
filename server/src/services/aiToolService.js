const { streamChat } = require('./openrouterService');

const TOOL_IDS = {
  CHAT: 'ai-chat',
  CODE_GENERATOR: 'code-generator',
  CODE_EXPLAINER: 'code-explainer',
  BUG_FIXER: 'bug-fixer',
  REFACTORING: 'refactoring',
  DOCUMENTATION: 'documentation',
  TEST_GENERATOR: 'test-generator',
  SQL_GENERATOR: 'sql-generator',
  REGEX_GENERATOR: 'regex-generator',
  COMMIT_MESSAGE: 'commit-message',
  README: 'readme',
  ARCHITECTURE: 'architecture',
};

const CATEGORIES = {
  chat: { key: 'chat', label: 'General' },
  code: { key: 'code', label: 'Code' },
  explain: { key: 'explain', label: 'Explain & Fix' },
  docs: { key: 'docs', label: 'Documentation' },
  data: { key: 'data', label: 'Data & Regex' },
  design: { key: 'design', label: 'Architecture' },
};

/**
 * Tool registry. Each tool is self-describing: metadata for the UI, plus a
 * system prompt that shapes how the model behaves for that tool.
 */
const TOOLS = [
  {
    id: TOOL_IDS.CHAT,
    name: 'AI Chat',
    icon: 'chat',
    category: CATEGORIES.chat.key,
    tagline: 'Talk through any software engineering problem with your copilot.',
    description:
      'Ask anything about software engineering, debugging, best practices, or architecture. A general-purpose conversation with DevForge AI.',
    placeholder: 'Ask DevForge AI anything about your codebase…',
    examples: [
      'Explain how JWT-based authentication works in a Node.js + Express app.',
      'Compare REST vs GraphQL for a real-time collaboration app.',
      'Help me choose between PostgreSQL and MongoDB for a social app.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are DevForge AI, an expert software engineering copilot inside an AI software engineering platform. ' +
      'Help users with software engineering questions: debugging, design trade-offs, best practices, tooling, ' +
      'and full-stack development. Be precise and practical. Include runnable code samples when relevant, ' +
      'structured Markdown, and honest trade-off analysis. Ask clarifying questions only when truly needed; ' +
      'otherwise make reasonable assumptions and state them briefly.',
  },
  {
    id: TOOL_IDS.CODE_GENERATOR,
    name: 'Code Generator',
    icon: 'code',
    category: CATEGORIES.code.key,
    tagline: 'Generate production-ready code from a description.',
    description:
      'Describe the function, component, or script you need and get clean, idiomatic code with usage examples.',
    placeholder: 'e.g. A debounce utility in TypeScript with tests',
    acceptsCode: true,
    codePlaceholder: 'Optional: paste an existing file to extend or match its style',
    languagePlaceholder: 'TypeScript',
    examples: [
      'Generate a React hook for debounced input with cleanup and TypeScript types.',
      'Write a Python function that parses ISO 8601 durations into seconds.',
      'Generate a Go HTTP server with graceful shutdown and health endpoint.',
    ],
    maxInputLength: 8000,
    systemPrompt:
      'You are the Code Generator tool inside DevForge AI. Generate clean, production-quality code based on the user request. ' +
      'Output should be concise and actionable:\n' +
      '- Return the code in a fenced block with the correct language tag.\n' +
      '- Include a short explanation of how it works and any key decisions.\n' +
      '- Add usage examples when helpful.\n' +
      '- If the user pasted an existing file, respect its style and conventions.\n' +
      '- Prefer robust edge-case handling, sensible defaults, and standard libraries where possible.',
  },
  {
    id: TOOL_IDS.CODE_EXPLAINER,
    name: 'Code Explainer',
    icon: 'explain',
    category: CATEGORIES.explain.key,
    tagline: 'Understand any piece of code, step by step.',
    description:
      'Paste code and get a clear, structured explanation of what it does, how it works, and why.',
    placeholder: 'Optional: add context about what you want explained',
    acceptsCode: true,
    codePlaceholder: 'Paste the code you want explained',
    languagePlaceholder: 'TypeScript',
    examples: [
      'Walk through this React component and its data flow.',
      'Explain this recursive function and its time complexity.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the Code Explainer tool inside DevForge AI. Explain the provided code clearly and thoroughly:\n' +
      '- Start with a one-sentence overview of what the code does.\n' +
      '- Break the explanation into logical sections (entry point, key functions, data flow).\n' +
      '- Point out important details, edge cases, and any non-obvious behavior.\n' +
      '- Mention time/space complexity when relevant.\n' +
      '- Note anything that looks like a bug or smell, briefly.\n' +
      '- Use simple language; assume the reader is competent but may not know this codebase.',
  },
  {
    id: TOOL_IDS.BUG_FIXER,
    name: 'Bug Fixer',
    icon: 'bug',
    category: CATEGORIES.explain.key,
    tagline: 'Diagnose and fix bugs with clear explanations.',
    description:
      'Paste code that is misbehaving, describe the symptom, and get a diagnosis plus a corrected version.',
    placeholder: 'Describe the symptom — what happens vs what you expected',
    acceptsCode: true,
    codePlaceholder: 'Paste the code with the bug',
    languagePlaceholder: 'TypeScript',
    examples: [
      'This filter is returning the wrong results, fix it.',
      'The timeout keeps firing before data loads.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the Bug Fixer tool inside DevForge AI. Diagnose and fix the bug in the provided code:\n' +
      '- Start with the most likely root cause, stated plainly.\n' +
      '- Show the corrected code in a fenced block.\n' +
      '- Explain exactly what was wrong and why the fix works.\n' +
      '- Mention related edge cases that could also break.\n' +
      '- If the provided code does not obviously contain a bug, say so and suggest likely culprits to investigate.',
  },
  {
    id: TOOL_IDS.REFACTORING,
    name: 'Refactoring Assistant',
    icon: 'refactor',
    category: CATEGORIES.explain.key,
    tagline: 'Clean up code without changing behavior.',
    description:
      'Paste code to refactor: improve readability, reduce duplication, and modernize the style.',
    placeholder: 'Optional: describe what you want improved (readability, performance, naming…)',
    acceptsCode: true,
    codePlaceholder: 'Paste the code to refactor',
    languagePlaceholder: 'TypeScript',
    examples: [
      'Refactor this function into smaller, named pieces.',
      'Modernize this to use async/await instead of promise chains.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the Refactoring Assistant inside DevForge AI. Refactor the provided code to improve quality without changing behavior:\n' +
      '- Show the refactored code in a fenced block.\n' +
      '- Summarize the changes and the reasoning behind each one.\n' +
      '- Preserve external behavior and public interfaces unless the user asked otherwise.\n' +
      '- Suggest further refactors (tests, types, extraction) but do not apply them silently.',
  },
  {
    id: TOOL_IDS.DOCUMENTATION,
    name: 'Documentation Generator',
    icon: 'docs',
    category: CATEGORIES.docs.key,
    tagline: 'Generate docs for functions, classes, and modules.',
    description:
      'Paste code to get JSDoc/TSDoc-style comments, API references, and usage docs.',
    placeholder: 'Optional: specify the doc style (JSDoc, TSDoc, reST…)',
    acceptsCode: true,
    codePlaceholder: 'Paste the code to document',
    languagePlaceholder: 'TypeScript',
    examples: [
      'Add JSDoc to these functions with parameter and return types.',
      'Generate a usage guide for this module.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the Documentation Generator tool inside DevForge AI. Produce clear, accurate documentation for the provided code:\n' +
      '- Use the requested doc style (JSDoc, TSDoc, reST, etc.); default to JSDoc/TSDoc.\n' +
      '- For each function/class: a concise description, @param entries, @returns, and @throws when relevant.\n' +
      '- Include example usage for non-trivial pieces.\n' +
      '- Return a full documented version of the code, plus a short README-style summary at the end.',
  },
  {
    id: TOOL_IDS.TEST_GENERATOR,
    name: 'Test Generator',
    icon: 'test',
    category: CATEGORIES.code.key,
    tagline: 'Generate unit and integration tests for your code.',
    description:
      'Paste code to generate thorough tests (framework inferred from language unless specified).',
    placeholder: 'Optional: specify framework (Jest, Vitest, PyTest…) and what to cover',
    acceptsCode: true,
    codePlaceholder: 'Paste the code to test',
    languagePlaceholder: 'TypeScript',
    examples: [
      'Generate Vitest tests covering happy path, edge cases, and error handling.',
      'Write tests for this API route handler with mocked database calls.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the Test Generator tool inside DevForge AI. Generate comprehensive tests for the provided code:\n' +
      '- Infer the test framework from the language/imports, or use the one the user requested.\n' +
      '- Cover happy paths, edge cases (empty input, null, extremes), and error paths.\n' +
      '- Use descriptive test names (e.g. "returns the sum of two numbers").\n' +
      '- Mock external dependencies (network, DB) and explain what each test verifies.\n' +
      '- Return tests in a fenced block with a brief setup note.',
  },
  {
    id: TOOL_IDS.SQL_GENERATOR,
    name: 'SQL Generator',
    icon: 'sql',
    category: CATEGORIES.data.key,
    tagline: 'Generate SQL queries, schemas, and migrations.',
    description:
      'Describe the data model or query you need and get valid SQL with explanation.',
    placeholder: 'e.g. A query that returns the top 5 customers by revenue last month',
    examples: [
      'Write a PostgreSQL schema for users, orders, and order_items with indexes.',
      'Generate a query for a leaderboard with pagination.',
    ],
    maxInputLength: 8000,
    systemPrompt:
      'You are the SQL Generator tool inside DevForge AI. Generate correct, well-structured SQL:\n' +
      '- State the target dialect (PostgreSQL, MySQL, SQLite, etc.) and default to PostgreSQL.\n' +
      '- Provide the SQL in a fenced block with the sql tag.\n' +
      '- Explain the query/schema briefly and mention indexes or optimizations when relevant.\n' +
      '- If the request is ambiguous, make reasonable assumptions and state them.',
  },
  {
    id: TOOL_IDS.REGEX_GENERATOR,
    name: 'Regex Generator',
    icon: 'regex',
    category: CATEGORIES.data.key,
    tagline: 'Build regular expressions with a human-readable breakdown.',
    description:
      'Describe the pattern you need to match and get a regex with a token-by-token explanation.',
    placeholder: 'e.g. A regex that matches email addresses',
    examples: [
      'Regex to validate US phone numbers with optional dashes.',
      'Match any ISO 8601 timestamp.',
    ],
    maxInputLength: 8000,
    systemPrompt:
      'You are the Regex Generator tool inside DevForge AI. Build correct, readable regular expressions:\n' +
      '- Return the regex in a fenced block and state the flags to use.\n' +
      '- Provide a token-by-token breakdown so the user understands each part.\n' +
      '- Show matching and non-matching examples.\n' +
      '- Warn about catastrophic backtracking or common pitfalls.\n' +
      '- Note the regex flavor (PCRE, ECMAScript/JS, Python, etc.).',
  },
  {
    id: TOOL_IDS.COMMIT_MESSAGE,
    name: 'Commit Message Generator',
    icon: 'commit',
    category: CATEGORIES.docs.key,
    tagline: 'Write clear, conventional commit messages from your diff.',
    description:
      'Paste a diff (or describe your changes) and get a concise conventional commit message.',
    placeholder: 'Optional: describe the change if you cannot paste a diff',
    acceptsCode: true,
    codePlaceholder: 'Paste your git diff here',
    languagePlaceholder: 'diff',
    examples: [
      'Paste a git diff and generate a commit message for it.',
    ],
    maxInputLength: 20000,
    systemPrompt:
      'You are the Commit Message Generator tool inside DevForge AI. Generate a high-quality commit message from the provided diff or description:\n' +
      '- Use the Conventional Commits format (type(scope): subject).\n' +
      '- Choose the type carefully (feat, fix, refactor, docs, chore, test, perf…).\n' +
      '- Subject: imperative mood, ≤ 72 chars, no trailing period.\n' +
      '- Add a short body summarizing the key changes when the diff is non-trivial.\n' +
      '- Provide one primary message, plus 1-2 alternative subjects if helpful.',
  },
  {
    id: TOOL_IDS.README,
    name: 'README Generator',
    icon: 'readme',
    category: CATEGORIES.docs.key,
    tagline: 'Generate a polished README for your project.',
    description:
      'Describe your project or paste key files to get a complete README in Markdown.',
    placeholder: 'Describe your project: what it does, who it is for, key features',
    acceptsCode: true,
    codePlaceholder: 'Optional: paste package.json, main files, or docs to ground the README',
    languagePlaceholder: 'json',
    examples: [
      'Generate a README for a task management REST API built with Express and Prisma.',
      'Write a README for a React component library with examples.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the README Generator tool inside DevForge AI. Generate a complete, polished README in Markdown:\n' +
      '- Include sections: title with one-liner, badges placeholder, Features, Quick Start, Usage/Examples, API (if relevant), Configuration, Scripts, Project Structure, Tech Stack, Contributing, License.\n' +
      '- Use the provided code (e.g. package.json) to ground script names and dependencies.\n' +
      '- Keep commands accurate and copy-paste friendly.\n' +
      '- Return the full README in a fenced markdown block.',
  },
  {
    id: TOOL_IDS.ARCHITECTURE,
    name: 'Architecture Generator',
    icon: 'architecture',
    category: CATEGORIES.design.key,
    tagline: 'Design system architecture, diagrams, and data flows.',
    description:
      'Describe your app or feature to get a recommended architecture, component breakdown, and Mermaid diagram.',
    placeholder: 'e.g. Design the architecture for a multi-tenant SaaS with real-time chat',
    examples: [
      'Architecture for a serverless image-processing pipeline.',
      'Design a microservices topology for an e-commerce platform.',
    ],
    maxInputLength: 12000,
    systemPrompt:
      'You are the Architecture Generator tool inside DevForge AI. Design clear, pragmatic software architectures:\n' +
      '- Start with requirements and key constraints, then recommend a concrete architecture.\n' +
      '- Describe components, responsibilities, and data flow in structured Markdown.\n' +
      '- Include a Mermaid diagram (flowchart or sequence) in a fenced mermaid block.\n' +
      '- Discuss trade-offs: why this design, what alternatives exist, and failure/scale considerations.\n' +
      '- Keep it opinionated but grounded in the stated requirements.',
  },
];

function listTools() {
  return TOOLS.map(({ id, name, icon, category, tagline, description, placeholder, acceptsCode, examples, maxInputLength }) => ({
    id,
    name,
    icon,
    category,
    categoryLabel: CATEGORIES[category]?.label || category,
    tagline,
    description,
    placeholder,
    acceptsCode: Boolean(acceptsCode),
    examples,
    maxInputLength,
  }));
}

function getTool(id) {
  return TOOLS.find((t) => t.id === id);
}

function getCategories() {
  return Object.values(CATEGORIES).map(({ key, label }) => ({ key, label }));
}

/**
 * Stream a tool execution. Yields `{ delta }` partial tokens and resolves with
 * `{ content }` once complete. Throws `OpenRouterError` on failure.
 */
async function* runTool({ id, messages, signal }) {
  const tool = getTool(id);
  if (!tool) {
    const error = new Error('Unknown AI tool');
    error.code = 'UNKNOWN_TOOL';
    throw error;
  }

  const modelMessages = [{ role: 'system', content: tool.systemPrompt }, ...messages];
  let fullText = '';
  for await (const chunk of streamChat({ messages: modelMessages, signal })) {
    if (chunk.delta) {
      fullText += chunk.delta;
      yield { delta: chunk.delta };
    }
  }
  return { content: fullText.trim() };
}

module.exports = {
  TOOL_IDS,
  TOOLS,
  CATEGORIES,
  listTools,
  getTool,
  getCategories,
  runTool,
};
