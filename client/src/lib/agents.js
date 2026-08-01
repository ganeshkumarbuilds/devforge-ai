export const AGENTS = [
  {
    role: 'product-manager',
    displayName: 'Product Manager',
    icon: 'clipboard',
    color: '#a78bfa',
    blurb: 'Turns your idea into a precise, buildable product spec.',
  },
  {
    role: 'architect',
    displayName: 'Architect',
    icon: 'compass',
    color: '#f59e0b',
    blurb: 'Designs the system architecture and folder structure.',
  },
  {
    role: 'database-engineer',
    displayName: 'Database Engineer',
    icon: 'database',
    color: '#38bdf8',
    blurb: 'Designs the data model and database layer.',
  },
  {
    role: 'backend-engineer',
    displayName: 'Backend Engineer',
    icon: 'terminal',
    color: '#34d399',
    blurb: 'Builds the complete backend application code.',
  },
  {
    role: 'frontend-engineer',
    displayName: 'Frontend Engineer',
    icon: 'layout',
    color: '#60a5fa',
    blurb: 'Builds a modern, responsive web frontend.',
  },
  {
    role: 'qa-engineer',
    displayName: 'QA Engineer',
    icon: 'shield',
    color: '#fb7185',
    blurb: 'Reviews code for bugs and writes a test suite.',
  },
  {
    role: 'documentation-engineer',
    displayName: 'Documentation Engineer',
    icon: 'file-text',
    color: '#c084fc',
    blurb: 'Writes clear README and setup documentation.',
  },
  {
    role: 'deployment-engineer',
    displayName: 'Deployment Engineer',
    icon: 'rocket',
    color: '#f87171',
    blurb: 'Creates Docker and CI configuration to ship anywhere.',
  },
];

export function agentMeta(role) {
  return AGENTS.find((a) => a.role === role) || {
    role,
    displayName: role,
    icon: 'bot',
    color: '#94a3b8',
    blurb: '',
  };
}

export const AGENT_ICONS = {
  clipboard: 'ClipboardList',
  compass: 'Compass',
  database: 'Database',
  terminal: 'TerminalSquare',
  layout: 'LayoutTemplate',
  shield: 'ShieldCheck',
  'file-text': 'FileText',
  rocket: 'Rocket',
  bot: 'Bot',
};
