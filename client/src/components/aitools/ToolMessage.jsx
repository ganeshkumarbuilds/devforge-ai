import { User, AlertTriangle } from 'lucide-react';
import Markdown from '../chat/Markdown';
import ToolIcon from './ToolIcon';
import { cn } from '../../lib/utils';

function TypingCursor() {
  return <span className="ml-0.5 inline-block h-4 w-[3px] animate-pulse rounded-sm bg-accent-soft align-middle" />;
}

export default function ToolMessage({ message, tool, streaming = false, error = null }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="flex max-w-[85%] items-end gap-2.5">
          <div className="rounded-2xl rounded-br-md border border-accent/25 bg-accent/15 px-4 py-3 text-sm leading-relaxed text-slate-100">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-soft">
            <User className="h-4 w-4" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-violet-600 text-white">
        <ToolIcon name={tool?.icon} size={15} />
      </div>
      <div
        className={cn(
          'min-w-0 flex-1 rounded-2xl rounded-tl-md border border-white/[0.06] bg-base-850 px-4 py-3',
          error && 'border-rose-500/30'
        )}
      >
        {error ? (
          <div className="flex items-start gap-2.5 text-sm text-rose-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold">Something went wrong</p>
              <p className="mt-0.5 text-xs text-rose-300/80">{error}</p>
            </div>
          </div>
        ) : message.content ? (
          <>
            <Markdown content={message.content} />
            {streaming && <TypingCursor />}
          </>
        ) : message.waiting ? (
          <div className="flex items-center gap-2 py-1 text-xs text-amber-300/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            {message.waiting.retryInSec != null
              ? `OpenRouter is rate limited — retrying in ${message.waiting.retryInSec}s${message.waiting.attempt ? ` (attempt ${message.waiting.attempt})` : ''}`
              : 'Waiting for OpenRouter…'}
          </div>
        ) : (
          <div className="flex items-center gap-2 py-1">
            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:120ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-500 [animation-delay:240ms]" />
          </div>
        )}
      </div>
    </div>
  );
}
