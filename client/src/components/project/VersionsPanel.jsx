import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers,
  RefreshCw,
  GitCompareArrows,
  RotateCcw,
  Database,
  Eye,
  FileCode2,
  Terminal,
  Copy,
  Check,
  Download,
  Loader2,
  Plus,
  X,
  ArrowRight,
} from 'lucide-react';
import { projectsApi } from '../../api/projects';
import { useToast } from '../../context/ToastContext';
import { cn, formatDateTime, downloadTextFile, truncate } from '../../lib/utils';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Modal from '../ui/Modal';
import { FullPageLoader } from '../ui/Spinner';

const LEVEL_TONE = {
  info: 'text-slate-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warn: 'text-amber-400',
  debug: 'text-sky-400',
};

const DIFF_TONE = {
  added: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
  removed: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  modified: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
};

export default function VersionsPanel({ projectId, onRestored }) {
  const toast = useToast();

  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailTab, setDetailTab] = useState('files');
  const [compare, setCompare] = useState(null);
  const [diff, setDiff] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [migration, setMigration] = useState(null);
  const [migrationLoading, setMigrationLoading] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [copied, setCopied] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await projectsApi.listVersions(projectId);
      setVersions(data.versions || []);
    } catch (err) {
      toast.error('Failed to load versions', err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openDetail = async (version) => {
    setSelected(version);
    setDetail(null);
    try {
      const data = await projectsApi.getVersion(projectId, version.id);
      setDetail(data.version);
    } catch (err) {
      toast.error('Failed to load version', err.message);
    }
  };

  const closeDetail = () => {
    setSelected(null);
    setDetail(null);
  };

  const toggleCompare = (version) => {
    if (compare === version.id) {
      setCompare(null);
      setDiff(null);
      return;
    }
    if (compare) {
      setCompare(compare);
    } else {
      setCompare(version.id);
    }
    setDiff(null);
  };

  const runDiff = async () => {
    if (!compare || !selected) return;
    setDiffLoading(true);
    setDiff(null);
    try {
      const data = await projectsApi.diffVersions(projectId, selected.id, compare);
      setDiff(data);
    } catch (err) {
      toast.error('Compare failed', err.message);
    } finally {
      setDiffLoading(false);
    }
  };

  const runMigration = async (version) => {
    setMigrationLoading(true);
    setMigration(null);
    try {
      const data = await projectsApi.migration(projectId, version.id);
      setMigration({ version, ...data });
    } catch (err) {
      toast.error('Migration failed', err.message);
      setMigration({ version, error: err.message });
    } finally {
      setMigrationLoading(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    try {
      const data = await projectsApi.restoreVersion(projectId, restoreTarget.id);
      toast.success('Version restored', `${data.restored} is now the active version (${data.files} files).`);
      setRestoreTarget(null);
      if (onRestored) onRestored();
    } catch (err) {
      toast.error('Restore failed', err.message);
    } finally {
      setRestoring(false);
    }
  };

  const createSnapshot = async () => {
    setCreatingSnapshot(true);
    try {
      const data = await projectsApi.createVersion(projectId, { notes: notes.trim() || undefined });
      toast.success('Snapshot created', `${data.version.version} captured.`);
      setSnapshotOpen(false);
      setNotes('');
      await load();
    } catch (err) {
      toast.error('Snapshot failed', err.message);
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const copyMigration = async () => {
    if (!migration || !migration.sql) return;
    try {
      await navigator.clipboard.writeText(migration.sql);
      setCopied('sql');
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error('Copy failed', 'Clipboard unavailable in this browser.');
    }
  };

  const downloadMigration = () => {
    if (!migration || !migration.sql) return;
    downloadTextFile(migration.sql, migration.filename || 'migration.sql', 'text/plain;charset=utf-8');
    toast.success('Migration downloaded', migration.filename);
  };

  const selectedId = selected?.id;
  const comparePair = useMemo(() => {
    if (!selected || !compare) return null;
    const a = selected;
    const b = versions.find((v) => v.id === compare);
    return { a, b };
  }, [selected, compare, versions]);

  if (loading) return <FullPageLoader label="Loading versions…" />;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Layers className="h-4 w-4 text-accent-soft" />
          Versions
          <span className="rounded-md bg-base-800 px-1.5 py-0.5 text-[10px] text-slate-500">{versions.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => { setSnapshotOpen(true); }}>
            <Plus className="h-4 w-4" />
            New snapshot
          </Button>
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Compare banner */}
      {selectedId && compare && comparePair && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/10 px-4 py-3">
          <span className="text-xs font-medium text-slate-300">Comparing</span>
          <Badge tone="accent">{comparePair.a.version}</Badge>
          <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
          <Badge tone="violet">{comparePair.b.version}</Badge>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" onClick={runDiff} loading={diffLoading} disabled={diffLoading}>
              <GitCompareArrows className="h-4 w-4" />
              Show diff
            </Button>
            <button
              onClick={() => { setCompare(null); setDiff(null); }}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
              aria-label="Clear comparison"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {versions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 p-10 text-center">
          <Layers className="h-8 w-8 text-slate-600" />
          <p className="text-sm font-semibold text-white">No versions yet</p>
          <p className="max-w-sm text-xs text-slate-500">
            Every generation and rebuild automatically snapshots the project. You can also capture a manual snapshot at any time.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {versions.map((v) => {
            const isSelected = v.id === selectedId;
            const isCompare = v.id === compare;
            return (
              <div
                key={v.id}
                className={cn(
                  'rounded-xl border border-white/[0.06] bg-base-900/50 p-4 transition-colors',
                  isSelected && 'border-accent/40 bg-accent/[0.06]',
                  isCompare && 'border-violet-500/40 bg-violet-500/[0.06]'
                )}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 font-mono text-xs font-bold text-accent-soft">
                    {v.version}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">
                      {v.summary || truncate(v.prompt, 90)}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span>{formatDateTime(v.createdAt)}</span>
                      {v.model && <span className="text-slate-400">{v.model}</span>}
                      <Badge tone="blue">{v.fileCount} files</Badge>
                      {v.logCount > 0 && <Badge tone="green">{v.logCount} logs</Badge>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => (isSelected ? closeDetail() : openDetail(v))}
                      className={cn(
                        'rounded-lg p-2 transition-colors',
                        isSelected ? 'bg-accent/20 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      )}
                      title={isSelected ? 'Close details' : 'View version'}
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => toggleCompare(v)}
                      className={cn(
                        'rounded-lg p-2 transition-colors',
                        isCompare ? 'bg-violet-500/20 text-violet-200' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                      )}
                      title="Compare"
                    >
                      <GitCompareArrows className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setRestoreTarget(v)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                      title="Restore this version"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => runMigration(v)}
                      className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
                      title="Generate database migration"
                    >
                      <Database className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {isSelected && (
                  <div className="mt-3 border-t border-white/[0.06] pt-3">
                    <p className="text-xs text-slate-400">{v.prompt}</p>
                    <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg border border-white/[0.06] bg-base-900/60 p-1">
                      {['files', 'logs'].map((t) => (
                        <button
                          key={t}
                          onClick={() => setDetailTab(t)}
                          className={cn(
                            'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors',
                            detailTab === t ? 'bg-accent/15 text-white' : 'text-slate-400 hover:bg-white/5'
                          )}
                        >
                          {t === 'files' ? <FileCode2 className="h-3.5 w-3.5" /> : <Terminal className="h-3.5 w-3.5" />}
                          {t}
                        </button>
                      ))}
                    </div>

                    {detailTab === 'files' ? (
                      detail ? (
                        <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                          {detail.files.length === 0 ? (
                            <p className="p-2 text-xs text-slate-500">No files in this snapshot.</p>
                          ) : (
                            detail.files.map((f) => (
                              <details key={f.path} className="group rounded-lg border border-white/[0.06] bg-base-900/60">
                                <summary className="cursor-pointer list-none px-3 py-2 font-mono text-xs text-slate-300 transition-colors hover:bg-white/[0.03]">
                                  <span className="inline-flex items-center gap-2">
                                    <FileCode2 className="h-3.5 w-3.5 text-accent-soft" />
                                    {f.path}
                                  </span>
                                </summary>
                                <pre className="max-h-72 overflow-auto border-t border-white/[0.06] p-3 font-mono text-[11.5px] leading-relaxed text-slate-400">
                                  <code>{f.content}</code>
                                </pre>
                              </details>
                            ))
                          )}
                        </div>
                      ) : (
                        <p className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading snapshot…
                        </p>
                      )
                    ) : (
                      <div className="mt-3 max-h-80 space-y-1 overflow-y-auto">
                        {detail && detail.logs.length === 0 ? (
                          <p className="p-2 text-xs text-slate-500">No build logs recorded for this version.</p>
                        ) : (
                          detail?.logs.map((l, i) => (
                            <div key={`${i}-${l.createdAt}`} className="flex items-start gap-2 rounded px-2 py-1 font-mono text-[11px] leading-relaxed">
                              <span className="mt-0.5 shrink-0 text-[10px] text-slate-600">{formatDateTime(l.createdAt)}</span>
                              <span className="shrink-0 rounded bg-base-800 px-1 text-[9px] font-bold uppercase text-slate-400">{l.level}</span>
                              <span className="shrink-0 font-semibold text-slate-500">[{l.source}]</span>
                              <span className={cn('break-words whitespace-pre-wrap', LEVEL_TONE[l.level] || LEVEL_TONE.info)}>{l.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Diff panel */}
      {diff && (
        <div className="space-y-3 rounded-xl border border-white/[0.06] bg-base-900/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <GitCompareArrows className="h-4 w-4 text-accent-soft" />
              {diff.aVersion.version}
              <ArrowRight className="h-3.5 w-3.5 text-slate-500" />
              {diff.bVersion.version}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="green">+{diff.stats.added} added</Badge>
              <Badge tone="red">-{diff.stats.removed} removed</Badge>
              <Badge tone="amber">{diff.stats.modified} modified</Badge>
            </div>
          </div>

          {diff.changes.length === 0 ? (
            <p className="text-xs text-slate-500">The two versions are identical.</p>
          ) : (
            <div className="max-h-96 space-y-2 overflow-y-auto">
              {diff.changes.map((c) => (
                <details key={c.path} className="rounded-lg border border-white/[0.06] bg-base-950/50">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 transition-colors hover:bg-white/[0.03]">
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider border', DIFF_TONE[c.status])}>
                      {c.status}
                    </span>
                    <span className="truncate font-mono text-xs text-slate-300">{c.path}</span>
                    {c.hunks && <span className="ml-auto text-[10px] text-slate-600">{c.hunks.length} lines</span>}
                  </summary>
                  <pre className="max-h-72 overflow-auto border-t border-white/[0.06] p-3 font-mono text-[11.5px] leading-relaxed">
                    <code>
                      {c.hunks.map((h, i) => (
                        <div
                          key={i}
                          className={cn(
                            'whitespace-pre-wrap',
                            h.type === 'added' && 'bg-emerald-500/10 text-emerald-300',
                            h.type === 'removed' && 'bg-rose-500/10 text-rose-300',
                            h.type === 'context' && 'text-slate-500'
                          )}
                        >
                          {h.type === 'added' ? '+' : h.type === 'removed' ? '-' : ' '}
                          {h.text}
                        </div>
                      ))}
                    </code>
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {/* New snapshot modal */}
      <Modal
        open={snapshotOpen}
        onClose={() => setSnapshotOpen(false)}
        title="Capture a snapshot"
        description="Freeze the current files and build logs as a new version."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSnapshotOpen(false)}>Cancel</Button>
            <Button onClick={createSnapshot} loading={creatingSnapshot}>
              <Plus className="h-4 w-4" /> Capture
            </Button>
          </>
        }
      >
        <label className="mb-1 block text-xs font-medium text-slate-400">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="e.g. stable checkpoint before adding auth"
          className="input-field w-full resize-none"
        />
      </Modal>

      {/* Restore modal */}
      <Modal
        open={!!restoreTarget}
        onClose={() => setRestoreTarget(null)}
        title="Restore this version?"
        description={`Replace the project's current files with the snapshot from ${restoreTarget?.version}.`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmRestore} loading={restoring}>
              <RotateCcw className="h-4 w-4" /> Restore {restoreTarget?.version}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          This overwrites the current files with the {restoreTarget?.fileCount} files captured in{' '}
          <span className="font-semibold text-white">{restoreTarget?.version}</span>. Build logs and other versions are kept.
        </p>
      </Modal>

      {/* Migration modal */}
      <Modal
        open={!!migration}
        onClose={() => setMigration(null)}
        title="Database migration"
        description={migration?.version ? `Generated from ${migration.version}` : undefined}
        size="xl"
        footer={
          migration?.error ? (
            <Button variant="ghost" onClick={() => setMigration(null)}>Close</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={copyMigration}>
                {copied === 'sql' ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                Copy SQL
              </Button>
              <Button onClick={downloadMigration}>
                <Download className="h-4 w-4" /> Download
              </Button>
            </>
          )
        }
      >
        {migrationLoading ? (
          <p className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Asking the AI model to generate a migration…
          </p>
        ) : migration?.error ? (
          <p className="text-sm text-rose-400">{migration.error}</p>
        ) : migration ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="blue">{migration.filename}</Badge>
              {migration.schemaFiles?.map((s) => (
                <Badge key={s} tone="violet">{s}</Badge>
              ))}
            </div>
            <pre className="max-h-[50vh] overflow-auto rounded-lg border border-white/[0.06] bg-base-950/70 p-4 font-mono text-[12px] leading-relaxed text-emerald-200/90">
              <code>{migration.sql}</code>
            </pre>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
