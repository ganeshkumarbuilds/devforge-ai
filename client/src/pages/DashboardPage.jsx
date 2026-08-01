import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FolderGit2,
  Loader2,
  CheckCircle2,
  XCircle,
  Search,
  AlertTriangle,
  Cpu,
  RefreshCw,
  Inbox,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { projectsApi, aiApi } from '../api/projects';
import { useProjects } from '../hooks/useProjects';
import { usePolling } from '../hooks/usePolling';
import PromptEditor from '../components/project/PromptEditor';
import { ProjectCard } from '../components/project/ProjectCard';
import { ProjectCardSkeleton } from '../components/ui/Skeleton';
import Modal from '../components/ui/Modal';
import Button from '../components/ui/Button';
import { cn } from '../lib/utils';

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'running', label: 'Running' },
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
];

function StatCard({ icon: Icon, label, value, tone, pulse }) {
  return (
    <div className="card-surface flex items-center gap-4 p-5">
      <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl', tone)}>
        <Icon className={cn('h-5 w-5', pulse && 'animate-pulse')} />
      </div>
      <div>
        <p className="text-2xl font-extrabold text-white">{value}</p>
        <p className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { projects, counts, loading, filters, setFilters, refresh } = useProjects();
  const [generating, setGenerating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [aiReady, setAiReady] = useState(true);
  const [search, setSearch] = useState('');

  const status = counts.running + counts.completed + counts.failed;

  usePolling(async () => {
    try {
      const data = await aiApi.status();
      setAiReady(!!data.configured);
    } catch {
      setAiReady(false);
    }
  }, 10000, { immediate: true });

  const filtered = useMemo(() => {
    let list = projects;
    if (filters.status) list = list.filter((p) => p.status === filters.status);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.stack.toLowerCase().includes(q)
      );
    }
    return list;
  }, [projects, filters.status, search]);

  const handleGenerate = async ({ prompt, stack }) => {
    setGenerating(true);
    try {
      const data = await projectsApi.generate({ prompt, stack });
      toast.success('Build started', 'Your AI engineering team is on it.');
      navigate(`/app/projects/${data.project.id}`);
    } catch (err) {
      toast.error('Failed to start build', err.message);
    } finally {
      setGenerating(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await projectsApi.remove(deleteTarget.id);
      toast.success('Project deleted', `"${deleteTarget.title}" was removed.`);
      setDeleteTarget(null);
      refresh();
    } catch (err) {
      toast.error('Delete failed', err.message);
    } finally {
      setDeleting(false);
    }
  };

  const firstName = (user?.name || 'there').split(' ')[0];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-2xl font-extrabold text-white sm:text-3xl"
        >
          Welcome back, {firstName}
        </motion.h1>
        <p className="text-sm text-slate-400">Describe an app and watch your AI engineering team build it.</p>
      </div>

      {/* Generate */}
      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
        <PromptEditor onSubmit={handleGenerate} loading={generating} disabled={!aiReady} />
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={FolderGit2} label="Total projects" value={status} tone="bg-sky-500/15 text-sky-400" />
        <StatCard icon={Loader2} label="Running" value={counts.running} tone="bg-indigo-500/15 text-accent-soft" pulse />
        <StatCard icon={CheckCircle2} label="Completed" value={counts.completed} tone="bg-emerald-500/15 text-emerald-400" />
        <StatCard icon={XCircle} label="Failed" value={counts.failed} tone="bg-rose-500/15 text-rose-400" />
      </div>

      {/* Projects */}
      <div className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white">Your projects</h2>
            {counts.running > 0 && (
              <span className="chip border border-accent/30 bg-accent/10 text-accent-soft">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
                {counts.running} building
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="input-field w-48 pl-9 sm:w-56"
              />
            </div>
            <Button variant="ghost" onClick={refresh} className="shrink-0" aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilters((prev) => ({ ...prev, status: f.key }))}
              className={cn(
                'rounded-full border px-4 py-1.5 text-xs font-medium transition-all duration-200',
                filters.status === f.key
                  ? 'border-accent/60 bg-accent/15 text-accent-soft'
                  : 'border-white/10 bg-base-800/60 text-slate-400 hover:border-white/20 hover:text-slate-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card-surface flex flex-col items-center justify-center gap-3 p-14 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-base-800 text-slate-500">
              {search || filters.status ? <Search className="h-6 w-6" /> : <Inbox className="h-6 w-6" />}
            </div>
            <p className="font-semibold text-white">
              {search || filters.status ? 'No projects match your filters' : 'No projects yet'}
            </p>
            <p className="max-w-sm text-sm text-slate-400">
              {search || filters.status
                ? 'Try adjusting your search or filter.'
                : 'Generate your first project using the editor above.'}
            </p>
            {!search && !filters.status && (
              <Button className="mt-2" onClick={() => document.querySelector('textarea')?.focus()}>
                <Plus className="h-4 w-4" /> Describe an app
              </Button>
            )}
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            <AnimatePresence>
              {filtered.map((project, i) => (
                <ProjectCard key={project.id} project={project} index={i} onDelete={setDeleteTarget} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* OpenRouter warning */}
      {!aiReady && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-amber-300">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">OpenRouter is not configured</p>
            <p className="mt-0.5 text-amber-200/80">
              Add your API key in{' '}
              <code className="rounded bg-black/30 px-1.5 py-0.5 font-mono text-xs">server/src/services/openrouterService.js</code> and restart the
              server. Existing projects remain available.
            </p>
          </div>
          <Cpu className="ml-auto hidden h-5 w-5 shrink-0 sm:block" />
        </div>
      )}

      {/* Delete modal */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete project"
        description="This permanently removes the project, its generated files and all logs."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-400">
          Are you sure you want to delete{' '}
          <span className="font-semibold text-white">"{deleteTarget?.title}"</span>? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
