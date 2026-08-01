import { Boxes } from 'lucide-react';
import { cn } from '../../lib/utils';

export default function Logo({ size = 'md', className }) {
  const sizes = {
    sm: 'h-7 w-7',
    md: 'h-9 w-9',
    lg: 'h-12 w-12',
  };
  const textSizes = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  };
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <div className={cn('relative shrink-0', sizes[size])}>
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent to-violet-500 opacity-90 blur-[2px]" />
        <div className="relative flex h-full w-full items-center justify-center rounded-xl bg-gradient-to-br from-accent to-violet-600 text-white shadow-lg shadow-accent/30">
          <Boxes className="h-[60%] w-[60%]" />
        </div>
      </div>
      <div className="leading-none">
        <span className={cn('font-extrabold tracking-tight text-white', textSizes[size])}>
          Dev<span className="text-gradient">Forge</span>
        </span>
        <span className={cn('block text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500', size === 'lg' && 'text-xs')}>
          AI
        </span>
      </div>
    </div>
  );
}
