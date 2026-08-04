import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '../../lib/utils';

const MAX_LENGTH = 12000;

export default function ChatInput({ onSend, onStop, streaming = false, disabled = false }) {
  const [value, setValue] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const submit = () => {
    const content = value.trim();
    if (!content || streaming || disabled) return;
    onSend(content);
    setValue('');
  };

  const canSend = value.trim().length > 0 && !streaming && !disabled;

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="rounded-2xl border border-white/10 bg-base-850 shadow-2xl shadow-black/40 focus-within:border-accent/50">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask DevForge AI anything…"
          disabled={disabled}
          className="max-h-[200px] w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
        />
        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
          <p className="text-[11px] text-slate-500">
            {value.length >= MAX_LENGTH ? (
              <span className="text-amber-400">Character limit reached</span>
            ) : (
              <span>
                Enter to send · Shift+Enter for a new line · {value.length}/{MAX_LENGTH}
              </span>
            )}
          </p>
          <button
            onClick={streaming ? onStop : submit}
            disabled={streaming ? false : !canSend}
            className={cn(
              'flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:pointer-events-none',
              streaming
                ? 'border border-white/15 bg-base-800 text-slate-200 hover:bg-rose-500/20 hover:text-rose-300'
                : 'bg-accent text-white shadow-lg shadow-accent/25 hover:bg-accent-soft'
            )}
            aria-label={streaming ? 'Stop generating' : 'Send message'}
          >
            {streaming ? <Square className="h-4 w-4" /> : <ArrowUp className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-600">
        DevForge AI can make mistakes. Verify important code before using it.
      </p>
    </div>
  );
}
