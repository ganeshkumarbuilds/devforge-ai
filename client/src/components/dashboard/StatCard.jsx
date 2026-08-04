import { motion } from 'framer-motion';
import Card from '../ui/Card';
import Sparkline from './Sparkline';
import { cn } from '../../lib/utils';

const tones = {
  accent: { chip: 'bg-accent/15 text-accent-soft', color: '#818cf8' },
  sky: { chip: 'bg-sky-500/15 text-sky-400', color: '#38bdf8' },
  emerald: { chip: 'bg-emerald-500/15 text-emerald-400', color: '#34d399' },
  violet: { chip: 'bg-violet-500/15 text-violet-400', color: '#a78bfa' },
  amber: { chip: 'bg-amber-500/15 text-amber-400', color: '#fbbf24' },
  rose: { chip: 'bg-rose-500/15 text-rose-400', color: '#fb7185' },
};

export default function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'accent',
  delta,
  deltaTone = 'up',
  spark,
  index = 0,
  className,
}) {
  const t = tones[tone] || tones.accent;
  const isUp = deltaTone === 'up';
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className={className}
    >
      <Card className="group relative flex h-full flex-col gap-4 overflow-hidden p-5 transition-all duration-300 hover:border-white/15">
        {spark && spark.length > 1 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 opacity-60 transition-opacity duration-300 group-hover:opacity-100">
            <Sparkline values={spark} color={t.color} height={64} />
          </div>
        )}
        <div className="flex items-start justify-between">
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', t.chip)}>
            <Icon className="h-5 w-5" />
          </div>
          {delta !== undefined && delta !== null && (
            <span
              className={cn(
                'chip',
                isUp
                  ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/25 bg-rose-500/10 text-rose-300'
              )}
            >
              {isUp ? '↑' : '↓'} {delta}
            </span>
          )}
        </div>
        <div className="relative z-10">
          <motion.p
            key={value}
            initial={{ opacity: 0.4, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl"
          >
            {value}
          </motion.p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
          {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
        </div>
      </Card>
    </motion.div>
  );
}