const { logLevel } = require('../config');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[logLevel] ?? LEVELS.info;

function formatArgs(args) {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.stack || a.message;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

function write(level, args) {
  if (LEVELS[level] < threshold) return;
  const time = new Date().toISOString();
  const line = `[${time}] [${level.toUpperCase()}] ${formatArgs(args)}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

const logger = {
  debug: (...args) => write('debug', args),
  info: (...args) => write('info', args),
  warn: (...args) => write('warn', args),
  error: (...args) => write('error', args),
  child: (scope) => ({
    debug: (...args) => write('debug', [`[${scope}]`, ...args]),
    info: (...args) => write('info', [`[${scope}]`, ...args]),
    warn: (...args) => write('warn', [`[${scope}]`, ...args]),
    error: (...args) => write('error', [`[${scope}]`, ...args]),
  }),
};

module.exports = logger;
