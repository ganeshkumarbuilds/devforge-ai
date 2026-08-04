import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Download,
  FileText,
  FileDown,
  RefreshCw,
  Trash2,
  Pencil,
  Check,
  X,
  Loader2,
  Cpu,
  Building2,
  CheckCircle2,
  XCircle,
  FileCode2,
  Terminal,
  LayoutGrid,
  Activity,
  History,
  MonitorPlay,
  Rocket,
  ShieldCheck,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { projectsApi } from '../api/projects';
import { useToast } from '../context/ToastContext';
import { usePolling } from '../hooks/usePolling';
import { downloadArtifact } from '../api/projects';
import { cn, formatDateTime } from '../lib/utils';import AgentPipeline from '../components/project/AgentPipeline';
import ProgressTimeline from '../components/project/ProgressTimeline';
import FileExplorer from '../components/project/FileExplorer';
import FileViewer from '../components/project/FileViewer';
import Console from '../components/project/Console';
import ActivityLog from '../components/project/ActivityLog';
import VersionsPanel from '../components/project/VersionsPanel';
import PreviewPanel from '../components/project/PreviewPanel';
import DeploymentModal from '../components/project/DeploymentModal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { FullPageLoader } from '../components/ui/Spinner';

const TABS = [
  { key: 'overview', label: 'Build', icon: LayoutGrid },
  { key: 'preview', label: 'Preview', icon: MonitorPlay },
  { key: 'files', label: 'Files', icon: FileCode2 },
  { key: 'versions', label: 'Versions', icon: History },
  { key: 'console', label: 'Console', icon: Terminal },
  { key: 'activity', label: 'Activity', icon: Activity },
];

const STATUS_META = {
  running: { tone: 'accent', label: 'Building', icon: Loader2, spin: true },
  completed: { tone: 'green', label: 'Completed', icon: CheckCircle2 },
  failed: { tone: 'red', label: 'Failed', icon: XCircle },
};

export default function ProjectWorkspace() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [project, setProject] = useState(null);
  const [agents, setAgents] = useState([]);
  const [fileTree, setFileTree] = useState([]);
  const [files, setFiles] = useState([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [counts, setCounts] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [logs, setLogs] = useState([]);
  const lastLogIdRef = useRef(null);

  const [tab, setTab] = useState('overview');
  const [selectedFile, setSelectedFile] = useState(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [validation, setValidation] = useState(null);
  const [validationRunning, setValidationRunning] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await projectsApi.get(projectId);
      setProject(data.project);
      setAgents(data.agents || []);
      setFileTree(data.fileTree || []);
      setFiles(data.files || []);
      setIsBuilding(data.isBuilding);
      setCounts(data.counts || {});
      setValidation(data.validation || null);
      setValidationRunning(Boolean(data.validationRunning));
      setError(null);
      return data;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const loadLogs = useCallback(async () => {
    try {
      const data = await projectsApi.logs(projectId, lastLogIdRef.current);
      if (data.logs && data.logs.length) {
        lastLogIdRef.current = data.logs[data.logs.length - 1].id;
        setLogs((prev) => {
          const merged = [...prev];
          const seen = new Set(merged.map((l) => l.id));
          for (const l of data.logs) {
            if (!seen.has(l.id)) {
              merged.push(l);
              seen.add(l.id);
            }
          }
          return merged;
        });
      }
    } catch { /* keep old logs */ }
  }, [projectId]);

  usePolling(async () => {
    const data = await load();
    if (data && data.isBuilding) {
      loadLogs();
    }
  }, 3000, { immediate: true });

  useEffect(() => {
    if (!project) return;
    lastLogIdRef.current = null;
    setLogs([]);
    loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    const toRun = agents.filter((a) => a.status === 'running');
    if (toRun.length) {
      const id = setTimeout(() => setTab((t) => (t === 'console' || t === 'overview' ? t : 'overview')), 300);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [agents]);

  const selectedFileObj = useMemo(() => {
    if (!selectedFile) return null;
    return files.find((f) => f.path === selectedFile.path) || selectedFile;
  }, [selectedFile, files]);

  const handleDownloadZip = async () => {
    setBusyAction('zip');
    try {
      await downloadArtifact(() => projectsApi.downloadZip(projectId), 'project.zip');
      toast.success('Download started', 'Your project ZIP is on its way.');
    } catch (err) {
      if (err.details && err.details.kind === 'validation') {
        setValidation(err.details);
        setValidationOpen(true);
        toast.error('Validation required', 'This project must pass build validation before it can be exported.');
      } else {
        toast.error('Download failed', err.message);
      }
    } finally {
      setBusyAction(null);
    }
  };

  const handleValidate = async () => {
    if (validating || validationRunning) return;
    setValidating(true);
    setValidationRunning(true);
    try {
      const data = await projectsApi.validate(projectId);
      setValidation(data);
      toast.success(
        data.ok ? 'Validation passed' : 'Validation failed',
        data.ok ? 'Frontend builds and backend starts. The project is ready to export.' : 'See the validation report below for what still needs fixing.'
      );
    } catch (err) {
      toast.error('Validation failed', err.message);
    } finally {
      setValidating(false);
      setValidationRunning(false);
      load();
    }
  };

  const handleExportDocs = async (format) => {
    setBusyAction(format === 'pdf' ? 'docs-pdf' : 'docs-md');
    try {
      await downloadArtifact(() => projectsApi.exportDocs(projectId, format), 'documentation.md');
      toast.success('Documentation exported', `${format.toUpperCase()} file ready.`);
    } catch (err) {
      toast.error('Export failed', err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleExportLogs = async (format) => {
    setBusyAction(format === 'pdf' ? 'logs-pdf' : 'logs-md');
    try {
      await downloadArtifact(() => projectsApi.exportLogs(projectId, format), 'logs.md');
      toast.success('Logs exported', `${format.toUpperCase()} file ready.`);
    } catch (err) {
      toast.error('Export failed', err.message);
    } finally {
      setBusyAction(null);
    }
  };

  const handleRebuild = async () => {
    if (isBuilding) return;
    setRebuilding(true);
    try {
      await projectsApi.rebuild(projectId);
      toast.success('Rebuild started', 'The pipeline is spinning up again.');
      setIsBuilding(true);
      setLogs([]);
      lastLogIdRef.current = null;
      load();
    } catch (err) {
      toast.error('Rebuild failed', err.message);
    } finally {
      setRebuilding(false);
    }
  };

  const handleVersionRestored = () => {
    load();
  };

  const handleDelete = async () => {
    try {
      await projectsApi.remove(projectId);
      toast.success('Project deleted', 'The project was removed.');
      navigate('/app/dashboard');
    } catch (err) {
      toast.error('Delete failed', err.message);
    }
  };

  const saveTitle = async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setEditingTitle(false);
      return;
    }
    try {
      const data = await projectsApi.update(projectId, { title: trimmed });
      setProject((p) => ({ ...p, title: data.project.title }));
      toast.success('Title updated');
    } catch (err) {
      toast.error('Update failed', err.message);
    } finally {
      setEditingTitle(false);
    }
  };

  if (loading) return <FullPageLoader label="Loading project…" />;

  if (error || !project) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-500/15 text-rose-400">
          <XCircle className="h-8 w-8" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">Project unavailable</h2>
          <p className="mt-1 text-sm text-slate-400">{error || 'This project could not be found.'}</p>
        </div>
        <Button onClick={() => navigate('/app/dashboard')} variant="secondary">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Button>
      </div>
    );
  }

  const meta = STATUS_META[project.status] || STATUS_META.completed;
  const StatusIcon = meta.icon;
  const hasFiles = files.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <Link
            to="/app/dashboard"
            className="mb-2 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            {editingTitle ? (
              <div className="flex items-center gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                  autoFocus
                  className="input-field w-72 max-w-full text-lg font-bold"
                />
                <button onClick={saveTitle} className="rounded-lg p-2 text-emerald-400 hover:bg-emerald-500/10" aria-label="Save title">
                  <Check className="h-4 w-4" />
                </button>
                <button onClick={() => setEditingTitle(false)} className="rounded-lg p-2 text-slate-500 hover:bg-white/5" aria-label="Cancel">
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="group flex items-center gap-2">
                <h1 className="truncate text-2xl font-extrabold text-white">{project.title}</h1>
                <button
                  onClick={() => {
                    setTitleDraft(project.title);
                    setEditingTitle(true);
                  }}
                  className="rounded-lg p-1.5 text-slate-600 opacity-0 transition-all hover:bg-white/5 hover:text-slate-300 group-hover:opacity-100"
                  aria-label="Edit title"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Created {formatDateTime(project.createdAt)} · {project.description || 'No description'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={meta.tone} dot pulse={isBuilding}>
            <StatusIcon className={cn('mr-1 h-3.5 w-3.5', meta.spin && 'animate-spin')} />
            {isBuilding ? 'Building…' : meta.label}
          </Badge>
          <Badge tone="violet">{project.stack || 'Auto'}</Badge>
          <Badge tone="blue">{counts.downloads ?? 0} downloads</Badge>
          {project.validated ? (
            <Badge tone="green">
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
              Validated
            </Badge>
          ) : project.validationStatus === 'failed' ? (
            <Badge tone="red">
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
              Needs validation
            </Badge>
          ) : validationRunning || validating ? (
            <Badge tone="amber">
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              Validating…
            </Badge>
          ) : (
            <Badge tone="slate">
              <ShieldAlert className="mr-1 h-3.5 w-3.5" />
              Not validated
            </Badge>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={handleDownloadZip} loading={busyAction === 'zip'} disabled={!hasFiles}>
          <Download className="h-4 w-4" />
          Download ZIP
        </Button>
        <Button variant="secondary" onClick={() => handleExportDocs('markdown')} loading={busyAction === 'docs-md'} disabled={!hasFiles}>
          <FileText className="h-4 w-4" />
          Docs
        </Button>
        <Button variant="secondary" onClick={() => handleExportDocs('pdf')} loading={busyAction === 'docs-pdf'} disabled={!hasFiles}>
          <FileDown className="h-4 w-4" />
          Docs PDF
        </Button>
        <Button variant="secondary" onClick={() => handleExportLogs('markdown')} loading={busyAction === 'logs-md'}>
          <FileDown className="h-4 w-4" />
          Export logs
        </Button>
        <Button variant="secondary" onClick={() => setDeployOpen(true)}>
          <Rocket className="h-4 w-4" />
          Deploy
        </Button>
        <Button variant="secondary" onClick={handleRebuild} loading={rebuilding} disabled={isBuilding}>
          <RefreshCw className={cn('h-4 w-4', isBuilding && 'animate-spin')} />
          Rebuild
        </Button>
        <Button variant="secondary" onClick={handleValidate} loading={validating || validationRunning} disabled={isBuilding || !hasFiles}>
          <Wrench className="h-4 w-4" />
          {project.validated ? 'Re-validate' : 'Validate & Fix'}
        </Button>
        <Button variant="danger" onClick={() => setDeleteOpen(true)} className="ml-auto">
          <Trash2 className="h-4 w-4" />
          Delete
        </Button>
      </div>

      {/* Building banner */}
      <AnimatePresence>
        {isBuilding && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-3 rounded-2xl border border-accent/30 bg-accent/10 p-4"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/20 text-accent-soft">
              <Cpu className="h-5 w-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Build in progress</p>
              <p className="truncate text-xs text-accent-soft/80">
                {agents.length} agents engaged · streaming live — files and logs update automatically.
              </p>
            </div>
            <Building2 className="hidden h-5 w-5 shrink-0 text-accent-soft/60 sm:block" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Generation failure banner */}
      {!isBuilding && project.status === 'failed' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4"
        >
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-300">Generation failed</p>
            <p className="mt-1 text-sm break-words text-rose-200/80">
              {project.error || 'The AI pipeline could not generate this project.'}
            </p>
            <p className="mt-1 text-xs text-rose-300/60">Open the Console tab for the full build log, then try Rebuilding.</p>
          </div>
          <Button variant="danger" size="sm" onClick={handleRebuild} loading={rebuilding}>
            <RefreshCw className="h-4 w-4" /> Rebuild
          </Button>
        </motion.div>
      )}

      {/* Validation in progress banner */}
      {!isBuilding && (validationRunning || validating) && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4"
        >
          <Loader2 className="h-5 w-5 animate-spin text-amber-300" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-amber-200">Build validation in progress</p>
            <p className="truncate text-xs text-amber-200/70">
              Installing dependencies, building the frontend and booting the backend. This can take a few minutes.
            </p>
          </div>
        </motion.div>
      )}

      {/* Validation failure banner */}
      {!isBuilding && !validationRunning && !validating && project.validated === false && project.validationStatus === 'failed' && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-rose-300">Project needs validation</p>
            <p className="mt-1 text-sm break-words text-rose-200/80">
              {project.validationError || 'This project has not passed build validation and cannot be exported or previewed.'}
            </p>
            <p className="mt-1 text-xs text-rose-300/60">
              The self-healing pipeline repairs missing files, broken imports and failing builds automatically — run Validate &amp; Fix.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="danger" size="sm" onClick={handleValidate} loading={validating || validationRunning}>
                <Wrench className="h-4 w-4" /> Validate &amp; Fix
              </Button>
              {validation && (
                <Button variant="ghost" size="sm" onClick={() => setValidationOpen(true)}>
                  View report
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-base-900/60 p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200',
              tab === key ? 'bg-accent/15 text-white shadow-sm' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
            {key === 'console' && logs.length > 0 && (
              <span className="rounded-md bg-base-800 px-1.5 py-0.5 text-[10px] text-slate-400">{logs.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.18 }}
        >
          {tab === 'overview' && (
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="space-y-6 lg:col-span-3">
                <AgentPipeline agents={agents} />
              </div>
              <div className="space-y-6 lg:col-span-2">
                <ProgressTimeline agents={agents} />
                <ActivityLog logs={logs} />
              </div>
            </div>
          )}

          {tab === 'preview' && (
            <PreviewPanel projectId={projectId} />
          )}

          {tab === 'files' && (
            <div className="grid h-[70vh] gap-0 overflow-hidden rounded-2xl border border-white/[0.06] lg:grid-cols-[280px_1fr]">
              <div className="border-b border-white/[0.06] bg-base-900/60 p-3 lg:border-b-0 lg:border-r">
                <FileExplorer fileTree={fileTree} selectedPath={selectedFileObj?.path} onSelect={setSelectedFile} fileCount={files.length} />
              </div>
              <div className="min-w-0 overflow-hidden bg-base-900/40">
                <FileViewer file={selectedFileObj} />
              </div>
            </div>
          )}

          {tab === 'versions' && (
            <VersionsPanel projectId={projectId} onRestored={handleVersionRestored} />
          )}

          {tab === 'console' && (
            <div className="h-[70vh]">
              <Console logs={logs} onExport={() => handleExportLogs('markdown')} />
            </div>
          )}

          {tab === 'activity' && (
            <ActivityLog logs={logs} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Delete modal */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this project?"
        description="This permanently deletes the project, generated files and logs."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>
              <Trash2 className="h-4 w-4" /> Delete project
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          Are you sure you want to delete <span className="font-semibold text-white">"{project.title}"</span>? This cannot be undone.
        </p>
      </Modal>

      <DeploymentModal
        projectId={projectId}
        title={project.title}
        open={deployOpen}
        onClose={() => setDeployOpen(false)}
      />

      {/* Validation report modal */}
      <Modal
        open={validationOpen}
        onClose={() => setValidationOpen(false)}
        title="Build Validation Report"
        description={validation && validation.ok ? 'This project passed the Build Validation Pipeline.' : 'Issues found while validating this project.'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setValidationOpen(false)}>Close</Button>
            {!validation?.ok && (
              <Button variant="danger" onClick={handleValidate} loading={validating || validationRunning}>
                <Wrench className="h-4 w-4" /> Validate &amp; Fix
              </Button>
            )}
          </>
        }
      >
        {validation?.ok ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <ShieldCheck className="h-12 w-12 text-emerald-400" />
            <p className="text-sm text-slate-300">
              Frontend builds successfully and backend starts. This project is ready to export and preview.
            </p>
            {typeof validation.attempts === 'number' && (
              <p className="text-xs text-slate-500">Passed on attempt {validation.attempts}.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {(!validation?.issues || validation.issues.length === 0) && (
              <p className="text-sm text-slate-400">No issues reported by the validator.</p>
            )}
            {validation?.issues?.map((issue, idx) => (
              <div key={idx} className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-rose-400" />
                  <p className="text-sm font-semibold text-rose-200">{issue.title}</p>
                </div>
                {issue.detail && <p className="mt-1.5 text-sm break-words whitespace-pre-wrap text-slate-300">{issue.detail}</p>}
                {issue.log && (
                  <pre className="mt-2 max-h-44 overflow-auto rounded-lg bg-black/40 p-3 text-xs leading-relaxed text-slate-400">
                    {issue.log}
                  </pre>
                )}
                {issue.suggestedFix && (
                  <p className="mt-2 text-xs text-amber-300/90">Fix: {issue.suggestedFix}</p>
                )}
              </div>
            ))}
            {validation?.logs && validation.logs.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Build logs</p>
                <pre className="max-h-56 overflow-auto rounded-xl bg-black/40 p-3 text-xs leading-relaxed text-slate-400">
                  {validation.logs.join('\n')}
                </pre>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
