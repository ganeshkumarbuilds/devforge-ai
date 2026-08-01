import { cn } from '../../lib/utils';

export function Spinner({ size = 'md', className }) {
  const sizes = { sm: 'h-4 w-4', md: 'h-6 w-6', lg: 'h-10 w-10' };
  return (
    <span
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-slate-600 border-t-accent',
        sizes[size],
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

export function FullPageLoader({ label = 'Loading…' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-base-950">
      <Spinner size="lg" />
      <p className="text-sm text-slate-400">{label}</p>
    </div>
  );
}
