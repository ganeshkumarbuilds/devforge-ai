import { motion } from 'framer-motion';
import { Cpu, HardDrive, Bot, Gauge } from 'lucide-react';
import Card from '../ui/Card';
import { cn, formatNumber } from '../../lib/utils';

function Meter({ label, display, pct, tone = 'accent', icon: Icon, detail }) {
  const bar =
    tone === 'emerald' ? 'bg-emerald-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-accent';
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          {Icon && <Icon className="h-4 w-4 text-slate-500" />}
          {label}
        </div>
        <span className="text-sm font-extrabold text-white">{display}</span>
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-base-800">
        <motion.div
          className={cn('h-full rounded-full', bar)}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </div>
      {detail && <p className="mt-1.5 text-xs text-slate-500">{detail}</p>}
    </div>
  );
}

export default function UsagePanel({ stats }) {
  const ai = stats?.aiUsage || { tokens: 0, agentRuns: 0 };
  const storage = stats?.storageBytes ?? 0;
  const storageLimit = 100 * 1024 * 1024;
  const aiLimit = 10 * 1000 * 1000;
  const storagePct = (storage / storageLimit) * 100;
  const aiPct = (ai.tokens / aiLimit) * 100;
  const storageDisplay = stats?.storage
    ? `${stats.storage.value} ${stats.storage.unit}`
    : '0 B';

  return (
    <Card className="flex h-full flex-col gap-6 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-base-800 text-accent-soft">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Usage</h2>
            <p className="text-xs text-slate-500">AI compute and storage this workspace</p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col justify-center gap-6">
        <Meter
          icon={Bot}
          label="AI usage"
          display={`${formatNumber(ai.tokens)} tokens`}
          pct={aiPct}
          tone="accent"
          detail={`${formatNumber(ai.agentRuns)} model calls · estimated tokens from agent output`}
        />
        <Meter
          icon={HardDrive}
          label="Storage"
          display={storageDisplay}
          pct={storagePct}
          tone="emerald"
          detail={`${formatNumber(Math.round(storage / 1024))} KB of generated files on disk`}
        />
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-base-800/60 p-3">
          <Gauge className="h-4 w-4 shrink-0 text-slate-500" />
          <p className="text-xs leading-relaxed text-slate-400">
            Estimates shown here refresh as your AI engineering team generates new projects.
          </p>
        </div>
      </div>
    </Card>
  );
}