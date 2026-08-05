import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FolderGit2, FileCode2, Bot, ArrowRight, Loader2, AlertTriangle, ShieldAlert, MoreHorizontal, Trash2, Eye, Star } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { cn, formatDate, truncate, projectStatusLabel } from '../../lib/utils';
import { useState } from 'react';

export function ProjectCard({ project, index = 0, onDelete, onToggleFavorite }) {
  const [menuOpen, setMenuOpen] = useState(false);

  const status = project.status;
  const busy = status === 'running' || status === 'validating' || status === 'recovering';
  const tone = status === 'completed' ? 'green' : busy ? 'accent' : status === 'failed' || status === 'validation_failed' ? 'red' : 'slate';
  const label = projectStatusLabel(status);
  const icon = busy ? (
    <Loader2 className="h-5 w-5 animate-spin" />
  ) : status === 'failed' ? (
    <AlertTriangle className="h-5 w-5" />
  ) : status === 'validation_failed' ? (
    <ShieldAlert className="h-5 w-5" />
  ) : (
    <FolderGit2 className="h-5 w-5" />
  );
  const iconBg = busy
    ? 'bg-accent/15 text-accent-soft'
    : status === 'failed' || status === 'validation_failed'
      ? 'bg-rose-500/15 text-rose-400'
      : 'bg-emerald-500/15 text-emerald-400';
  const favorite = Boolean(project.favorite);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05 }}
      className="group relative"
    >
      <Card className="flex h-full flex-col p-5 transition-all duration-300 hover:border-accent/40 hover:shadow-xl hover:shadow-accent/5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconBg)}>
              {icon}
            </div>
            <div className="min-w-0">
              <Link to={`/app/projects/${project.id}`} className="block">
                <h3 className="truncate text-sm font-bold text-white transition-colors group-hover:text-accent-soft">
                  {project.title}
                </h3>
              </Link>
              <p className="text-xs text-slate-500">Created {formatDate(project.createdAt)}</p>
            </div>
          </div>

          <div className="relative flex shrink-0 items-center gap-1">
            <button
              onClick={() => onToggleFavorite?.(project)}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
              className={cn(
                'rounded-lg p-1.5 transition-all duration-200',
                favorite
                  ? 'text-amber-400 hover:bg-amber-500/10'
                  : 'text-slate-500 hover:bg-white/5 hover:text-amber-300'
              )}
            >
              <Star className={cn('h-[18px] w-[18px]', favorite && 'fill-amber-400')} />
            </button>
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
              aria-label="Project options"
            >
              <MoreHorizontal className="h-[18px] w-[18px]" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-1 w-44 overflow-hidden rounded-xl border border-white/10 bg-base-850 shadow-xl">
                  <Link
                    to={`/app/projects/${project.id}`}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-white/5"
                  >
                    <Eye className="h-4 w-4 text-slate-500" /> Open workspace
                  </Link>
                  <button
                    onClick={() => {
                      setMenuOpen(false);
                      if (onDelete) onDelete(project);
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-rose-300 transition-colors hover:bg-rose-500/10"
                  >
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        <p className="mt-3 line-clamp-2 flex-1 text-sm leading-relaxed text-slate-400">
          {truncate(project.description, 140)}
        </p>

        <div className="mt-4 flex items-center gap-2">
          <Badge tone={tone} dot pulse={busy}>
            {label}
          </Badge>
          <Badge tone="violet">{project.stack || 'Auto'}</Badge>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <FileCode2 className="h-3.5 w-3.5" />
              {project.fileCount ?? 0} files
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Bot className="h-3.5 w-3.5" />
              {project.agentCount ?? 0} agents
            </span>
          </div>
          <Link
            to={`/app/projects/${project.id}`}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-soft transition-colors hover:text-accent"
          >
            Open <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </Card>
    </motion.div>
  );
}
