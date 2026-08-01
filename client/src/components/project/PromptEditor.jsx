import { useState } from 'react';
import { motion } from 'framer-motion';
import { Wand2, X, Layers, Code2, Database, LayoutTemplate } from 'lucide-react';
import Button from '../ui/Button';
import { cn } from '../../lib/utils';

const STACK_PRESETS = [
  { label: 'Auto', icon: Layers, value: '' },
  { label: 'React + Express', icon: LayoutTemplate, value: 'React + Express' },
  { label: 'Next.js + Prisma', icon: Code2, value: 'Next.js + Prisma' },
  { label: 'Full Stack TS', icon: Database, value: 'TypeScript Full Stack' },
];

export default function PromptEditor({ onSubmit, loading, disabled, compact = false }) {
  const [prompt, setPrompt] = useState('');
  const [stack, setStack] = useState('');

  const handleSubmit = () => {
    if (prompt.trim().length < 10 || loading || disabled) return;
    onSubmit({ prompt: prompt.trim(), stack });
  };

  const examples = compact
    ? ['A todo app with a clean UI']
    : [
        'A team task board with Kanban columns, drag-and-drop, and real-time sync',
        'A personal finance tracker that imports CSV and shows spending analytics',
        'A developer notes app with Markdown, syntax highlighting and full-text search',
      ];

  return (
    <div className={cn('card-surface overflow-hidden', !compact && 'p-6 sm:p-8')}>
      <div className={cn('flex items-center gap-3', compact ? 'mb-3' : 'mb-5')}>
        <div className={cn('flex items-center justify-center rounded-xl bg-accent/15 text-accent-soft', compact ? 'h-9 w-9' : 'h-11 w-11')}>
          <Wand2 className={compact ? 'h-4.5 w-4.5 h-[18px] w-[18px]' : 'h-5 w-5'} />
        </div>
        <div>
          <h3 className={cn('font-bold text-white', compact ? 'text-base' : 'text-xl')}>Describe your app</h3>
          <p className="text-xs text-slate-400">Tell the AI engineering team what to build.</p>
        </div>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
        }}
        rows={compact ? 3 : 5}
        placeholder="e.g. Build a real-time chat app with rooms, private messages, emoji reactions and user profiles. React frontend, Node backend, SQLite database, with deployment config."
        className="input-field w-full resize-none leading-relaxed"
      />

      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2">
          {examples.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setPrompt(ex)}
              className="rounded-full border border-white/10 bg-base-800/70 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:border-accent/40 hover:text-slate-200"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STACK_PRESETS.map(({ label, icon: Icon, value }) => (
            <button
              key={label}
              type="button"
              onClick={() => setStack(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all duration-200',
                stack === value
                  ? 'border-accent/60 bg-accent/15 text-accent-soft'
                  : 'border-white/10 bg-base-800/60 text-slate-400 hover:border-white/20 hover:text-slate-200'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <Button
          onClick={handleSubmit}
          loading={loading}
          disabled={disabled || prompt.trim().length < 10}
          size="lg"
          className="sm:self-auto"
        >
          <Wand2 className="h-4 w-4" />
          Generate project
        </Button>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        {prompt.trim().length < 10
          ? `Minimum 10 characters — ${prompt.trim().length}/10`
          : 'Press Ctrl+Enter to generate'}
      </p>

      {disabled && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-4 flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-sm text-amber-300"
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center">
            <X className="h-4 w-4" />
          </div>
          <p>
            OpenRouter is not configured. Add your API key in{' '}
            <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">server/src/services/openrouterService.js</code> and restart the
            server.
          </p>
        </motion.div>
      )}
    </div>
  );
}
