import { cn } from '../../lib/utils';

export function Skeleton({ className }) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-lg bg-gradient-to-r from-base-700 via-base-600 to-base-700 bg-[length:200%_100%]',
        className
      )}
    />
  );
}

export function ProjectCardSkeleton() {
  return (
    <div className="card-surface p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-5 w-16" />
      </div>
      <Skeleton className="mt-4 h-4 w-full" />
      <Skeleton className="mt-2 h-4 w-3/4" />
      <div className="mt-5 flex items-center justify-between">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>
    </div>
  );
}
