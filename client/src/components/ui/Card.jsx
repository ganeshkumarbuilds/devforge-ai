import { cn } from '../../lib/utils';

export default function Card({ className, children, ...props }) {
  return (
    <div className={cn('card-surface p-5', className)} {...props}>
      {children}
    </div>
  );
}
