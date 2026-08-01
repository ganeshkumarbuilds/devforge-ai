import { Link } from 'react-router-dom';
import { Compass, ArrowLeft } from 'lucide-react';
import Logo from '../components/ui/Logo';

export default function NotFoundPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-base-950 p-4">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-1/3 h-[300px] w-[500px] -translate-x-1/2 rounded-full bg-accent/10 blur-[120px]" />
      </div>
      <div className="relative z-10 flex flex-col items-center text-center">
        <Compass className="h-16 w-16 text-accent-soft" />
        <h1 className="mt-6 text-7xl font-extrabold text-white">404</h1>
        <p className="mt-2 text-lg text-slate-400">This page wandered off into the build pipeline.</p>
        <div className="mt-8 flex gap-3">
          <Link to="/" className="btn-secondary">
            <ArrowLeft className="h-4 w-4" />
            Back home
          </Link>
          <Link to="/app/dashboard" className="btn-primary">
            Go to dashboard
          </Link>
        </div>
      </div>
      <div className="absolute bottom-8">
        <Logo size="sm" />
      </div>
    </div>
  );
}
