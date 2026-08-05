import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, FileCode2, FolderGit2, Loader2, AlertTriangle, ShieldAlert } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { cn, statusTone, timeAgo, truncate, projectStatusLabel } from '../../lib/utils';

export default function RecentProjects({ projects = [], onViewAll }) {
  return (
    <Card className="flex h-full flex-col p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-base-800 text-accent-soft">
            <FolderGit2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white">Recent generations</h2>
            <p className="text-xs text-slate-500">Latest projects built by your AI team</p>
          </div>
        </div>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="inline-flex items-center gap-1 text-xs font-semibold text-accent-soft transition-colors hover:text-accent"
          >
            View all <ArrowRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-1 flex-col divide-y divide-white/[0.06]">
        {projects.length === 0 && (
          <p className="py-8 text-center text-sm text-slate-500">No projects generated yet.</p>
        )}
        {projects.map((p, i) => {
          const tone = statusTone(p.status);
          const busy = p.status === 'running' || p.status === 'validating' || p.status === 'recovering';
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: i * 0.04 }}
            >
              <Link
                to={`/app/projects/${p.id}`}
                className="group flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-white/5"
              >
                <div
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    busy
                      ? 'bg-accent/15 text-accent-soft'
                      : p.status === 'failed' || p.status === 'validation_failed'
                        ? 'bg-rose-500/15 text-rose-400'
                        : 'bg-emerald-500/15 text-emerald-400'
                  )}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : p.status === 'failed' ? (
                    <AlertTriangle className="h-4 w-4" />
                  ) : p.status === 'validation_failed' ? (
                    <ShieldAlert className="h-4 w-4" />
                  ) : (
                    <FolderGit2 className="h-4 w-4" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white transition-colors group-hover:text-accent-soft">
                    {p.title}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {truncate(p.description, 60)} · {timeAgo(p.createdAt)}
                  </p>
                </div>
                <div className="hidden shrink-0 items-center gap-2 sm:flex">
                  <Badge tone={tone} dot pulse={busy}>
                    {projectStatusLabel(p.status)}
                  </Badge>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                    <FileCode2 className="h-3.5 w-3.5" /> {p.fileCount ?? 0}
                  </span>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </Card>
  );
}