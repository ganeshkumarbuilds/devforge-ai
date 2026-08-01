import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Loader2, Bot } from 'lucide-react';
import { agentMeta } from '../../lib/agents';
import { cn } from '../../lib/utils';

export default function ProgressTimeline({ agents }) {
  if (!agents || agents.length === 0) {
    return (
      <div className="card-surface flex items-center justify-center p-8 text-sm text-slate-400">
        No pipeline activity yet.
      </div>
    );
  }

  const done = agents.filter((a) => a.status === 'completed').length;
  const failed = agents.filter((a) => a.status === 'failed').length;

  return (
    <div className="card-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">Pipeline progress</h3>
        <span className="text-xs text-slate-400">
          {done} completed{failed > 0 ? ` · ${failed} failed` : ''} · {agents.length} total
        </span>
      </div>

      <div className="mb-6 h-2 w-full overflow-hidden rounded-full bg-base-700">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent via-violet-400 to-emerald-400"
          animate={{ width: `${Math.round((done / Math.max(agents.length, 1)) * 100)}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>

      <ol className="relative space-y-4 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-base-700">
        {agents.map((agent) => {
          const meta = agentMeta(agent.role);
          const Icon = Bot;
          return (
            <li key={agent.id} className="relative flex gap-4">
              <div
                className={cn(
                  'z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2',
                  agent.status === 'completed' && 'border-emerald-400/40 bg-emerald-500/15 text-emerald-400',
                  agent.status === 'failed' && 'border-rose-400/40 bg-rose-500/15 text-rose-400',
                  agent.status === 'running' && 'border-accent/50 bg-accent/15 text-accent-soft',
                  agent.status === 'pending' && 'border-base-600 bg-base-800 text-slate-500'
                )}
              >
                {agent.status === 'completed' ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : agent.status === 'failed' ? (
                  <XCircle className="h-4 w-4" />
                ) : agent.status === 'running' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" style={{ color: meta.color }} />
                )}
              </div>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-semibold text-white">{agent.displayName}</p>
                  <span
                    className={cn(
                      'shrink-0 text-[11px] font-semibold capitalize',
                      agent.status === 'completed' && 'text-emerald-400',
                      agent.status === 'failed' && 'text-rose-400',
                      agent.status === 'running' && 'text-accent-soft',
                      agent.status === 'pending' && 'text-slate-500'
                    )}
                  >
                    {agent.status === 'pending' ? 'Waiting' : agent.status}
                  </span>
                </div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-base-700">
                  <motion.div
                    className="h-full rounded-full"
                    style={{
                      backgroundColor:
                        agent.status === 'failed' ? '#fb7185' : agent.status === 'completed' ? '#34d399' : meta.color,
                    }}
                    animate={{ width: `${agent.progress ?? 0}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
