import { motion } from 'framer-motion';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  AlertTriangle,
  Info,
  Bot,
  Activity,
} from 'lucide-react';
import { formatDateTime, timeAgo } from '../../lib/utils';

const LEVEL_ICON = {
  success: { icon: CheckCircle2, cls: 'text-emerald-400 bg-emerald-500/10' },
  error: { icon: XCircle, cls: 'text-rose-400 bg-rose-500/10' },
  warn: { icon: AlertTriangle, cls: 'text-amber-400 bg-amber-500/10' },
  info: { icon: Info, cls: 'text-sky-400 bg-sky-500/10' },
  running: { icon: Loader2, cls: 'text-accent-soft bg-accent/10' },
};

export default function ActivityLog({ logs }) {
  if (!logs || logs.length === 0) {
    return (
      <div className="card-surface flex flex-col items-center justify-center gap-2 p-10 text-center">
        <Activity className="h-6 w-6 text-slate-600" />
        <p className="font-semibold text-white">No activity yet</p>
        <p className="text-sm text-slate-400">Build events will stream in here in real time.</p>
      </div>
    );
  }

  return (
    <div className="card-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-white">
          <Activity className="h-4 w-4 text-accent-soft" />
          Activity log
        </h3>
        <span className="text-xs text-slate-500">{logs.length} events</span>
      </div>
      <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-base-700">
        {logs.slice(-60).map((log) => {
          const config =
            log.level === 'running'
              ? LEVEL_ICON.running
              : LEVEL_ICON[log.level] || LEVEL_ICON.info;
          const Icon = config.icon;
          return (
            <motion.li
              key={log.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
              className="relative flex gap-3"
            >
              <span className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${config.cls}`}>
                <Icon className="h-3 w-3" />
              </span>
              <div className="min-w-0 flex-1 pb-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    {log.source === 'system' ? <Bot className="mr-1 inline h-3 w-3" /> : null}
                    {log.source}
                  </span>
                  <span className="shrink-0 text-[10px] text-slate-600" title={formatDateTime(log.createdAt)}>
                    {timeAgo(log.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 break-words text-sm text-slate-300">{log.message}</p>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </div>
  );
}
