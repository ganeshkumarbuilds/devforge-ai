import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight,
  Sparkles,
  Github,
  Zap,
  Shield,
  Rocket,
  Boxes,
  Bot,
  ChevronRight,
  Code2,
  GitBranch,
  Download,
  Cpu,
  TerminalSquare,
  ClipboardList,
  Compass,
  Database,
  LayoutTemplate,
  FileText,
  ShieldCheck,
  Star,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/ui/Logo';
import { AGENTS } from '../lib/agents';

const AGENT_ICON_MAP = {
  ClipboardList,
  Compass,
  Database,
  TerminalSquare,
  LayoutTemplate,
  ShieldCheck,
  FileText,
  Rocket,
  Bot,
};

const STEPS = [
  {
    icon: ClipboardList,
    title: 'Describe your idea',
    text: 'Write a prompt describing the app you want to build — features, stack, anything you have in mind.',
  },
  {
    icon: Cpu,
    title: 'A team of agents builds it',
    text: 'Eight specialized AI agents plan, architect, code, test, document and deploy your project — live.',
  },
  {
    icon: Download,
    title: 'Download and run',
    text: 'Watch live progress, browse every generated file, then download the complete source as a ZIP.',
  },
];

const FEATURES = [
  {
    icon: Zap,
    title: 'Live build progress',
    text: 'Real-time agent status, streaming logs and a progress timeline for every build.',
  },
  {
    icon: GitBranch,
    title: 'Multi-agent pipeline',
    text: 'A coordinated team: Planner, Architect, Database, Backend, Frontend, QA, Docs and DevOps.',
  },
  {
    icon: Shield,
    title: 'Production quality',
    text: 'JWT auth, bcrypt hashing, input validation, rate limiting and secure APIs out of the box.',
  },
  {
    icon: Boxes,
    title: 'Full project download',
    text: 'Export the generated source as a ZIP, pull docs as Markdown or PDF, and export logs.',
  },
  {
    icon: Code2,
    title: 'Built-in file explorer',
    text: 'Browse every generated file in a code viewer right inside your workspace.',
  },
  {
    icon: Rocket,
    title: 'Deploy anywhere',
    text: 'Each build ships with Dockerfiles, compose configs and CI workflows.',
  },
];

const STATS = [
  { value: '8', label: 'AI agents' },
  { value: '20+', label: 'Files per build' },
  { value: '100%', label: 'Open source' },
  { value: '0', label: 'Setup required' },
];

export default function LandingPage() {
  const { isAuthenticated } = useAuth();
  const ctaHref = isAuthenticated ? '/app/dashboard' : '/register';

  return (
    <div className="min-h-screen overflow-x-hidden bg-base-950">
      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-accent/20 blur-[140px]" />
        <div className="absolute right-0 top-1/3 h-[400px] w-[400px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute bottom-0 left-0 h-[300px] w-[400px] rounded-full bg-sky-500/10 blur-[120px]" />
      </div>

      {/* Navbar */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-base-950/70 backdrop-blur-xl">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <Logo size="sm" />
          <div className="flex items-center gap-2">
            <Link
              to={isAuthenticated ? '/app/dashboard' : '/login'}
              className="btn-ghost hidden sm:inline-flex"
            >
              Sign in
            </Link>
            <Link to={ctaHref} className="btn-primary">
              <Sparkles className="h-4 w-4" />
              Get started
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 pb-20 pt-32 sm:px-6 sm:pt-40 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-1.5 text-xs font-medium text-accent-soft"
          >
            <Sparkles className="h-3.5 w-3.5" />
            The AI software engineering platform
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1 }}
            className="text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-6xl lg:text-7xl"
          >
            Describe an app.
            <br />
            <span className="text-gradient">Eight agents build it.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mx-auto mt-6 max-w-2xl text-lg text-slate-400"
          >
            DevForge AI turns a single prompt into a complete, production-ready application.
            Watch a coordinated team of AI agents plan, architect, code, test, document and deploy — then download the source.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <Link to={ctaHref} className="btn-primary px-7 py-3.5 text-base">
              Start building
              <ArrowRight className="h-5 w-5" />
            </Link>
            <Link to={ctaHref} className="btn-secondary px-7 py-3.5 text-base">
              <Github className="h-5 w-5" />
              Try it free
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.5 }}
            className="mt-16 grid grid-cols-2 gap-6 sm:grid-cols-4"
          >
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-gradient text-3xl font-extrabold sm:text-4xl">{s.value}</p>
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">{s.label}</p>
              </div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Agent pipeline visual */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.6 }}
          className="card-surface relative overflow-hidden p-6 sm:p-8"
        >
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/20 blur-[80px]" />
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold text-white sm:text-2xl">A live multi-agent build</h2>
              <p className="mt-1 text-sm text-slate-400">Every agent updates in real time with progress and streaming logs.</p>
            </div>
            <span className="chip border border-emerald-500/25 bg-emerald-500/10 text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
              Building live
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {AGENTS.map((agent, i) => {
              const Icon = AGENT_ICON_MAP[agent.icon] || Bot;
              const states = [
                ['completed', 'bg-emerald-400', 'text-emerald-300'],
                ['completed', 'bg-emerald-400', 'text-emerald-300'],
                ['completed', 'bg-emerald-400', 'text-emerald-300'],
                ['running', 'bg-accent', 'text-accent-soft'],
                ['pending', 'bg-slate-600', 'text-slate-500'],
                ['pending', 'bg-slate-600', 'text-slate-500'],
                ['pending', 'bg-slate-600', 'text-slate-500'],
                ['pending', 'bg-slate-600', 'text-slate-500'],
              ][i];
              return (
                <motion.div
                  key={agent.role}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06 }}
                  className="flex flex-col items-center gap-2 rounded-xl border border-white/[0.06] bg-base-850/80 p-3 text-center"
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${states[1]} bg-opacity-20`}>
                    <Icon className={`h-5 w-5 ${states[2]}`} />
                  </div>
                  <p className="text-[11px] font-semibold leading-tight text-slate-300">{agent.displayName.split(' ')[0]}</p>
                  <p className={`text-[9px] font-medium uppercase tracking-wider ${states[2]}`}>{states[0]}</p>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-base-700">
                    <div
                      className={`h-full rounded-full ${states[1]}`}
                      style={{ width: states[0] === 'completed' ? '100%' : states[0] === 'running' ? '64%' : '0%' }}
                    />
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* How it works */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-extrabold text-white sm:text-4xl">From idea to ZIP in minutes</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">A simple, delightful workflow powered by eight focused agents.</p>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="card-surface group relative overflow-hidden p-6 transition-all duration-300 hover:border-accent/40"
            >
              <span className="absolute right-4 top-4 text-4xl font-extrabold text-white/5">0{i + 1}</span>
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-accent-soft">
                <step.icon className="h-6 w-6" />
              </div>
              <h3 className="text-lg font-bold text-white">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-extrabold text-white sm:text-4xl">Everything you need to ship</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">A production-grade platform, not a toy demo.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="card-surface p-6 transition-all duration-300 hover:border-accent/40 hover:bg-base-800"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent/20 to-violet-500/20 text-accent-soft">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.text}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Agent roster */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-extrabold text-white sm:text-4xl">Meet your engineering team</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            Eight specialists, one shared context, working in sequence to build your app end to end.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {AGENTS.map((agent, i) => {
            const Icon = AGENT_ICON_MAP[agent.icon] || Bot;
            return (
              <motion.div
                key={agent.role}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.4, delay: i * 0.05 }}
                className="group card-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:border-white/15"
              >
                <div className="mb-3 flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: `${agent.color}22`, color: agent.color }}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{agent.displayName}</h3>
                    <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{agent.role}</p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-slate-400">{agent.blurb}</p>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="relative overflow-hidden rounded-3xl border border-accent/30 bg-gradient-to-br from-base-800 via-base-850 to-base-900 p-10 text-center sm:p-16"
        >
          <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-accent/25 blur-[100px]" />
          <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-violet-600/20 blur-[100px]" />
          <div className="relative">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet-600 shadow-xl shadow-accent/40">
              <Bot className="h-8 w-8 text-white" />
            </div>
            <h2 className="mx-auto max-w-2xl text-3xl font-extrabold text-white sm:text-5xl">
              Ready to build your next app with AI?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">
              No boilerplate. No waiting for code review. Just describe what you need and watch your team ship it.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link to={ctaHref} className="btn-primary px-8 py-3.5 text-base">
                Launch DevForge AI
                <ArrowRight className="h-5 w-5" />
              </Link>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
              <Star className="h-3.5 w-3.5 text-amber-400" />
              Free to start
              <ChevronRight className="h-3 w-3" />
              No credit card
              <ChevronRight className="h-3 w-3" />
              Built on OpenRouter — runs in the cloud
            </div>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 sm:flex-row sm:px-6 lg:px-8">
          <Logo size="sm" />
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} DevForge AI. AI-powered software engineering.
          </p>
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <a href="#" className="transition-colors hover:text-slate-300">Docs</a>
            <a href="#" className="transition-colors hover:text-slate-300">GitHub</a>
            <a href="#" className="transition-colors hover:text-slate-300">Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
