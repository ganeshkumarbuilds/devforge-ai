import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MonitorPlay,
  Play,
  Square,
  RefreshCw,
  Terminal,
  Loader2,
  AlertTriangle,
  Eye,
} from 'lucide-react';
import { projectsApi } from '../../api/projects';
import { apiOrigin } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { cn, formatDateTime } from '../../lib/utils';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import { FullPageLoader } from '../ui/Spinner';

const LEVEL_TONE = {
  info: 'text-slate-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warn: 'text-amber-400',
  system: 'text-sky-400',
  install: 'text-violet-300',
  run: 'text-slate-300',
};

const STATE_META = {
  idle: { tone: 'slate', label: 'Not running' },
  installing: { tone: 'violet', label: 'Installing dependencies', spin: true },
  starting: { tone: 'accent', label: 'Starting server', spin: true },
  running: { tone: 'green', label: 'Live' },
  failed: { tone: 'red', label: 'Failed' },
  disabled: { tone: 'slate', label: 'Preview disabled' },
};

export default function PreviewPanel({ projectId }) {
  const toast = useToast();

  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [url, setUrl] = useState('');
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [showTerminal, setShowTerminal] = useState(true);
  const [validationBlocked, setValidationBlocked] = useState(null);

  const lastLogIndexRef = useRef(0);
  const logsBottomRef = useRef(null);
  const prevBuildIdRef = useRef(null);
  const prevStateRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await projectsApi.previewStatus(projectId);
      setStatus(data.status);
      setToken(data.token);
      setUrl(data.url);
    } catch {
      /* keep last known status */
    }
  }, [projectId]);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await projectsApi.previewLogs(projectId, lastLogIndexRef.current);
      if (data.logs && data.logs.length) {
        lastLogIndexRef.current += data.logs.length;
        setLogs((prev) => [...prev, ...data.logs].slice(-1000));
      }
    } catch {
      /* keep old logs */
    }
  }, [projectId]);

  useEffect(() => {
    let timer;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await fetchStatus();
      await fetchLogs();
      setLoading(false);
      timer = setTimeout(tick, 2500);
    };
    tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchStatus, fetchLogs]);

  // Auto-refresh the iframe whenever a new build/restart goes live.
  useEffect(() => {
    if (!status) return;
    const becameRunning = prevStateRef.current && prevStateRef.current !== 'running' && status.state === 'running';
    const buildChanged = prevBuildIdRef.current !== null && status.buildId !== prevBuildIdRef.current && status.state === 'running';
    if (status.state === 'running' && (becameRunning || buildChanged)) {
      setIframeKey((k) => k + 1);
    }
    prevStateRef.current = status.state;
    prevBuildIdRef.current = status.buildId;
  }, [status]);

  useEffect(() => {
    logsBottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs]);

  const running = status?.state === 'running';
  const busyState = status?.state === 'installing' || status?.state === 'starting';
  const meta = STATE_META[status?.state] || STATE_META.idle;
  const StatusIcon = meta.spin ? Loader2 : running ? Eye : MonitorPlay;

  const iframeSrc = running && url ? `${apiOrigin()}${url}/?token=${encodeURIComponent(token)}` : null;

  const handleStart = async () => {
    setBusy('start');
    setValidationBlocked(null);
    try {
      await projectsApi.previewStart(projectId);
      toast.success('Preview starting', 'Installing dependencies and booting the server…');
    } catch (err) {
      if (err.details && err.details.kind === 'validation') {
        setValidationBlocked(err.details.report);
        toast.error('Validation required', 'This project must pass build validation before preview can start.');
      } else {
        toast.error('Preview failed', err.message);
      }
    } finally {
      setBusy(null);
    }
  };

  const handleStop = async () => {
    setBusy('stop');
    try {
      await projectsApi.previewStop(projectId);
      lastLogIndexRef.current = 0;
      setLogs([]);
      toast.success('Preview stopped');
    } catch (err) {
      toast.error('Stop failed', err.message);
    } finally {
      setBusy(null);
    }
  };

  const handleReload = () => {
    setIframeKey((k) => k + 1);
    toast.success('Preview reloaded');
  };

  const hasError = status?.state === 'failed';

  return (
    <div className="flex h-[calc(100vh-320px)] min-h-[520px] flex-col gap-3">
      {/* Status bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/[0.06] bg-base-900/60 px-4 py-3">
        <Badge tone={meta.tone} dot pulse={meta.spin}>
          <StatusIcon className={cn('mr-1 h-3.5 w-3.5', meta.spin && 'animate-spin')} />
          {meta.label}
        </Badge>
        {running && status.port && <Badge tone="blue">port {status.port}</Badge>}
        {status?.script && <Badge tone="violet">npm run {status.script}</Badge>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleReload} disabled={!running} title="Reload preview">
            <RefreshCw className="h-4 w-4" /> Reload
          </Button>
          {running ? (
            <Button variant="secondary" size="sm" onClick={handleStop} loading={busy === 'stop'}>
              <Square className="h-4 w-4" /> Stop
            </Button>
          ) : busyState ? (
            <Button variant="secondary" size="sm" disabled>
              <Loader2 className="h-4 w-4 animate-spin" /> Working…
            </Button>
          ) : (
            <Button size="sm" onClick={handleStart} loading={busy === 'start'} disabled={status?.state === 'disabled'}>
              <Play className="h-4 w-4" /> Start preview
            </Button>
          )}
        </div>
      </div>

      {/* Validation blocked */}
      {validationBlocked && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-200">Preview requires build validation</p>
            <p className="mt-1 text-sm break-words text-amber-200/80">
              This project has not passed the Build Validation Pipeline yet. Run validation from the project page first.
            </p>
            {validationBlocked.issues?.length > 0 && (
              <ul className="mt-2 space-y-2">
                {validationBlocked.issues.map((issue, idx) => (
                  <li key={idx} className="rounded-lg bg-black/30 p-2.5">
                    <p className="text-xs font-semibold text-rose-300">{issue.title}</p>
                    {issue.detail && <p className="mt-1 break-words whitespace-pre-wrap text-xs text-slate-300">{issue.detail}</p>}
                    {issue.suggestedFix && <p className="mt-1 text-[11px] text-amber-300/80">{issue.suggestedFix}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Error detail */}
      {hasError && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-rose-300">Preview failed to start</p>
            <p className="mt-1 text-sm break-words text-rose-200/80">{status?.error || 'The preview server could not be started.'}</p>
            <p className="mt-1 text-xs text-rose-300/60">
              Review the terminal logs below for the full error, or press Start preview to retry.
            </p>
          </div>
        </div>
      )}

      {/* Main preview area */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-base-950/60">
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-base-900/60 px-4">
          <MonitorPlay className="h-4 w-4 text-accent-soft" />
          <span className="text-xs font-semibold text-slate-300">Browser preview</span>
          {running && <span className="ml-auto text-[10px] text-slate-500">auto-refresh on</span>}
        </div>
        <div className="relative min-h-0 flex-1 bg-base-950">
          {loading && !iframeSrc ? (
            <FullPageLoader label="Preparing preview…" />
          ) : iframeSrc ? (
            <iframe
              key={iframeKey}
              src={iframeSrc}
              title="Project preview"
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-base-800 text-slate-600">
                <MonitorPlay className="h-7 w-7" />
              </div>
              <p className="font-semibold text-white">Preview not running</p>
              <p className="max-w-sm text-sm text-slate-400">
                Start the preview to install dependencies, boot the generated server and see the app live right here.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Terminal logs */}
      <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-base-950/80" style={{ height: showTerminal ? 200 : 40 }}>
        <button
          onClick={() => setShowTerminal((v) => !v)}
          className="flex h-10 shrink-0 items-center gap-2 border-b border-white/[0.06] bg-base-900/60 px-4 text-left"
        >
          <Terminal className="h-4 w-4 text-accent-soft" />
          <span className="text-xs font-semibold text-slate-300">Preview terminal</span>
          <span className="rounded-md bg-base-800 px-1.5 py-0.5 text-[10px] text-slate-500">{logs.length} lines</span>
          <span className="ml-auto text-slate-500">{showTerminal ? 'Hide' : 'Show'}</span>
        </button>
        {showTerminal && (
          <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed">
            {logs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-600">
                <Terminal className="h-6 w-6" />
                <p className="text-xs">Terminal output will stream here as the preview builds and runs.</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {logs.map((l, i) => (
                  <div key={`${i}-${l.ts}`} className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-[10px] text-slate-600">{formatDateTime(l.ts)}</span>
                    <span className={cn('break-words whitespace-pre-wrap', LEVEL_TONE[l.level] || LEVEL_TONE.run)}>{l.message}</span>
                  </div>
                ))}
                <div ref={logsBottomRef} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}