import { useEffect, useRef, useState } from 'react';
import { Terminal, Download, Copy, Check, Pause, Play, FileDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { downloadTextFile, formatDateTime } from '../../lib/utils';

const LEVEL_TONE = {
  info: 'text-slate-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warn: 'text-amber-400',
  debug: 'text-sky-400',
};

const LEVEL_BADGE = {
  info: 'bg-slate-500/10 text-slate-400',
  success: 'bg-emerald-500/10 text-emerald-400',
  error: 'bg-rose-500/10 text-rose-400',
  warn: 'bg-amber-500/10 text-amber-400',
  debug: 'bg-sky-500/10 text-sky-400',
};

export default function Console({ logs, onExport }) {
  const bottomRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs, autoScroll]);

  const exportLogs = () => {
    const content = logs
      .map((l) => `[${formatDateTime(l.createdAt)}] [${l.level.toUpperCase()}] [${l.source}] ${l.message}`)
      .join('\n');
    downloadTextFile(content, `build-logs-${Date.now()}.log`, 'text/plain;charset=utf-8');
  };

  const copyLogs = async () => {
    const content = logs.map((l) => `[${l.source}] ${l.message}`).join('\n');
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-base-950/80">
      {/* Console header */}
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-base-900/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex gap-1.5">
            <span className="h-3 w-3 rounded-full bg-rose-500/80" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
          </span>
          <span className="ml-2 flex items-center gap-2 text-xs font-semibold text-slate-300">
            <Terminal className="h-3.5 w-3.5 text-accent-soft" />
            Console
          </span>
          <span className="rounded-md bg-base-800 px-1.5 py-0.5 text-[10px] text-slate-500">{logs.length} lines</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
            title={autoScroll ? 'Pause autoscroll' : 'Resume autoscroll'}
          >
            {autoScroll ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          </button>
          <button onClick={copyLogs} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200" title="Copy logs">
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          <button onClick={exportLogs} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200" title="Export logs">
            <Download className="h-3.5 w-3.5" />
          </button>
          {onExport && (
            <button onClick={onExport} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200" title="Export as Markdown">
              <FileDown className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Log body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11.5px] leading-relaxed">
        {logs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
            <Terminal className="h-8 w-8" />
            <p className="text-xs">Console output will stream here while the build runs.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start gap-2 rounded px-1.5 py-0.5 transition-colors hover:bg-white/[0.03]">
                <span className="mt-0.5 shrink-0 text-[10px] text-slate-600">{formatDateTime(log.createdAt)}</span>
                <span className={cn('shrink-0 rounded px-1 text-[10px] font-bold uppercase', LEVEL_BADGE[log.level] || LEVEL_BADGE.info)}>
                  {log.level}
                </span>
                <span className="shrink-0 font-semibold text-slate-500">[{log.source}]</span>
                <span className={cn('break-words whitespace-pre-wrap', LEVEL_TONE[log.level] || LEVEL_TONE.info)}>
                  {log.message}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
