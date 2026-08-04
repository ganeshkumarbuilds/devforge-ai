import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import Card from '../ui/Card';
import { cn } from '../../lib/utils';

const DAY_LABEL = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
const SHORT_LABEL = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export default function BuildHistory({ history = [], className }) {
  const max = Math.max(1, ...history.map((d) => d.total));

  return (
    <Card className={cn('flex h-full flex-col p-5', className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-base-800 text-accent-soft">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Build history</h2>
            <p className="text-xs text-slate-500">Generations over the last 14 days</p>
          </div>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="flex flex-1 items-center justify-center py-10 text-sm text-slate-500">
          No build activity yet.
        </div>
      ) : (
        <div className="mt-5 flex flex-1 items-end gap-1.5 sm:gap-2">
          {history.map((day, i) => {
            const date = new Date(`${day.date}T00:00:00`);
            return (
              <motion.div
                key={day.date}
                className="group relative flex flex-1 flex-col items-center gap-1.5"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: i * 0.02 }}
              >
                <div className="absolute -top-1 z-10 hidden -translate-y-full flex-col items-center whitespace-nowrap rounded-lg border border-white/10 bg-base-800 px-2 py-1 text-[10px] text-slate-300 group-hover:flex">
                  <span>{SHORT_LABEL.format(date)}</span>
                  <span className="font-semibold text-white">{day.total} build{day.total === 1 ? '' : 's'}</span>
                </div>
                <div className="flex h-24 w-full items-end gap-[2px]">
                  <motion.div
                    className="flex w-1/2 flex-col justify-end"
                    initial={{ height: 0 }}
                    animate={{ height: `${(day.completed / max) * 100}%` }}
                    transition={{ duration: 0.5, delay: 0.1 + i * 0.02 }}
                  >
                    <div className="w-full rounded-t-sm bg-emerald-500/80" style={{ height: day.completed > 0 ? '100%' : '0%' }} />
                  </motion.div>
                  <motion.div
                    className="flex w-1/2 flex-col justify-end"
                    initial={{ height: 0 }}
                    animate={{ height: `${(day.failed / max) * 100}%` }}
                    transition={{ duration: 0.5, delay: 0.15 + i * 0.02 }}
                  >
                    <div className="w-full rounded-t-sm bg-rose-500/80" style={{ height: day.failed > 0 ? '100%' : '0%' }} />
                  </motion.div>
                </div>
                <span className="text-[9px] font-medium uppercase tracking-wide text-slate-600">
                  {DAY_LABEL.format(date)}
                </span>
              </motion.div>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-4 border-t border-white/[0.06] pt-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/80" /> Completed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/80" /> Failed
        </span>
      </div>
    </Card>
  );
}