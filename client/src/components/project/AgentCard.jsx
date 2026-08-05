import { motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Bot,
  ChevronDown,
  AlertTriangle,
} from 'lucide-react';
import { agentMeta } from '../../lib/agents';
import { cn, formatDateTime } from '../../lib/utils';
import { useState } from 'react';

function StatusIcon({ status, color }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin" style={{ color }} />;
  if (status === 'queued') return <Loader2 className="h-4 w-4 animate-spin text-amber-400" />;
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
  if (status === 'failed') return <XCircle className="h-4 w-4 text-rose-400" />;
  return <Clock className="h-4 w-4 text-slate-500" />;
}

function waitingLabel(agent) {
  const w = agent.waiting;
  if (w) {
    if (w.type === 'rate_limited') {
      return `OpenRouter rate limited — retrying in ${w.retryInSec}s (attempt ${w.attempt ?? 1})`;
    }
    return `Waiting for an OpenRouter slot${w.position ? ` (queue position ${w.position})` : ''}`;
  }
  return 'Waiting for OpenRouter';
}

export default function AgentCard({ agent, index = 0 }) {
  const meta = agentMeta(agent.role);
  const [expanded, setExpanded] = useState(false);

  const statusLabel = {
    pending: 'Waiting',
    queued: 'Waiting for OpenRouter',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
  }[agent.status] || agent.status;

  const statusTone = {
    pending: 'text-slate-500',
    queued: 'text-amber-400',
    running: 'text-accent-soft',
    completed: 'text-emerald-400',
    failed: 'text-rose-400',
  }[agent.status] || 'text-slate-500';

  const progress = agent.progress ?? 0;
  const showOutput = agent.status === 'running' && agent.output;
  const showError = agent.status === 'failed' && agent.error;
  const isQueued = agent.status === 'queued';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.04 }}
      className={cn(
        'card-surface overflow-hidden transition-all duration-300',
        agent.status === 'running' && 'border-accent/40',
        agent.status === 'queued' && 'border-amber-500/30',
        agent.status === 'failed' && 'border-rose-500/30'
      )}
    >
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-4 text-left"
      >
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${meta.color}1f`, color: meta.color }}
        >
          <Bot className="h-5 w-5" style={{ color: meta.color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-bold text-white">{agent.displayName}</p>
            <span className={cn('text-xs font-semibold capitalize', statusTone)}>{statusLabel}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <StatusIcon status={agent.status} color={meta.color} />
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-base-700">
              <motion.div
                className="h-full rounded-full"
                style={{ backgroundColor: agent.status === 'failed' ? '#fb7185' : agent.status === 'queued' ? '#fbbf24' : agent.status === 'completed' ? '#34d399' : meta.color }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            </div>
            <span className="w-8 text-right text-xs font-medium text-slate-400">{progress}%</span>
          </div>
          {agent.status === 'running' && (
            <p className="mt-1 text-[11px] text-slate-500">
              {agent.startedAt ? `Started ${formatDateTime(agent.startedAt)}` : 'Starting…'}
            </p>
          )}
          {isQueued && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-300/80">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {waitingLabel(agent)}
            </p>
          )}
          {agent.status === 'completed' && agent.completedAt && (
            <p className="mt-1 text-[11px] text-slate-500">Done {formatDateTime(agent.completedAt)}</p>
          )}
        </div>
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-slate-500 transition-transform duration-300', expanded && 'rotate-180')}
        />
      </button>

      {(showOutput || showError || expanded) && (
        <div className="border-t border-white/[0.06] bg-base-900/50 px-4 py-3">
          {showError && (
            <div className="mb-2 flex items-start gap-2 rounded-lg border border-rose-500/25 bg-rose-500/10 p-2.5 text-xs text-rose-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="font-mono">{agent.error}</span>
            </div>
          )}
          {showOutput && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
              {agent.output}
            </pre>
          )}
          {expanded && !showOutput && !showError && (
            <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-400">
              {agent.output || 'No output yet.'}
            </pre>
          )}
        </div>
      )}
    </motion.div>
  );
}
