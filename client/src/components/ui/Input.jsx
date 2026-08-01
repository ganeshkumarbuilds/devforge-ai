import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

const Input = forwardRef(function Input({ label, error, icon: Icon, rightElement, className, id, ...props }, ref) {
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={id} className="label-field">
          {label}
        </label>
      )}
      <div className="relative">
        {Icon && (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        )}
        <input
          ref={ref}
          id={id}
          className={cn('input-field', Icon && 'pl-9', rightElement && 'pr-10', error && 'border-rose-500/50 focus:border-rose-500 focus:ring-rose-500/20', className)}
          {...props}
        />
        {rightElement && <div className="absolute right-2 top-1/2 -translate-y-1/2">{rightElement}</div>}
      </div>
      {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
    </div>
  );
});

export default Input;
