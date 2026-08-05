import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Star, FolderGit2, Loader2, AlertTriangle, ShieldAlert, ArrowRight } from 'lucide-react';
import Card from '../ui/Card';
import Badge from '../ui/Badge';
import { cn, statusTone, truncate, projectStatusLabel } from '../../lib/utils';

export default function FavoritesRow({ favorites = [] }) {
  const navigate = useNavigate();

  if (favorites.length === 0) {
    return (
      <Card className="flex flex-col items-center justify-center gap-2 border-dashed p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-base-800 text-slate-500">
          <Star className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-white">No favorite projects yet</p>
        <p className="max-w-xs text-xs text-slate-400">
          Star a project from the grid below to pin it here for quick access.
        </p>
      </Card>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
      {favorites.map((p, i) => {
        const tone = statusTone(p.status);
        const busy = p.status === 'running' || p.status === 'validating';
        const icon = busy ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : p.status === 'failed' ? (
          <AlertTriangle className="h-5 w-5" />
        ) : p.status === 'validation_failed' ? (
          <ShieldAlert className="h-5 w-5" />
        ) : (
          <FolderGit2 className="h-5 w-5" />
        );
        return (
          <motion.button
            key={p.id}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: i * 0.05 }}
            onClick={() => navigate(`/app/projects/${p.id}`)}
            className="group flex w-60 shrink-0 flex-col gap-3 rounded-2xl border border-white/10 bg-base-850 p-4 text-left transition-all duration-300 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5"
          >
            <div className="flex items-start justify-between gap-2">
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                  p.status === 'running' || p.status === 'validating'
                    ? 'bg-accent/15 text-accent-soft'
                    : p.status === 'failed' || p.status === 'validation_failed'
                      ? 'bg-rose-500/15 text-rose-400'
                      : 'bg-emerald-500/15 text-emerald-400'
                )}
              >
                {icon}
              </div>
              <span className="flex items-center gap-1 text-amber-400">
                <Star className="h-4 w-4 fill-amber-400" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white transition-colors group-hover:text-accent-soft">
                {p.title}
              </p>
              <p className="mt-0.5 truncate text-xs text-slate-500">
                {truncate(p.description, 48)}
              </p>
            </div>
            <div className="mt-auto flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Badge tone={tone} dot={busy} pulse={busy}>
                  {projectStatusLabel(p.status)}
                </Badge>
                <Badge tone="violet">{p.stack || 'Auto'}</Badge>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-slate-600 transition-colors group-hover:text-accent-soft" />
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}