import { cn } from '../../lib/utils';

const tones = {
  slate: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
  green: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  red: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
  blue: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
  violet: 'bg-violet-500/10 text-violet-300 border-violet-500/25',
  accent: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25',
};

const dots = {
  slate: 'bg-slate-400',
  green: 'bg-emerald-400',
  red: 'bg-rose-400',
  amber: 'bg-amber-400',
  blue: 'bg-sky-400',
  violet: 'bg-violet-400',
  accent: 'bg-indigo-400',
};

export default function Badge({ tone = 'slate', children, dot = false, pulse = false, className }) {
  return (
    <span className={cn('chip border', tones[tone], className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', dots[tone], pulse && 'animate-pulse')} />}
      {children}
    </span>
  );
}
