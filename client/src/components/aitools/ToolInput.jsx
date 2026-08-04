import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square, Code2, X, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

const LANGUAGES = [
  { value: '', label: 'No language' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'python', label: 'Python' },
  { value: 'jsx', label: 'JSX / React' },
  { value: 'tsx', label: 'TSX / React' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
  { value: 'json', label: 'JSON' },
  { value: 'sql', label: 'SQL' },
  { value: 'bash', label: 'Shell' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'csharp', label: 'C#' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
  { value: 'diff', label: 'Diff' },
];

export default function ToolInput({
  tool,
  onSend,
  onStop,
  streaming = false,
  disabled = false,
}) {
  const [prompt, setPrompt] = useState('');
  const [codeOpen, setCodeOpen] = useState(Boolean(tool?.acceptsCode) && false);
  const [code, setCode] = useState('');
  const [language, setLanguage] = useState(tool?.languagePlaceholder || '');
  const promptRef = useRef(null);
  const codeRef = useRef(null);

  const maxPrompt = tool?.maxInputLength || 12000;
  const maxCode = 40000;

  useEffect(() => {
    setCodeOpen(Boolean(tool?.acceptsCode) && false);
    setCode('');
    setLanguage(tool?.languagePlaceholder || '');
    setPrompt('');
    // Reset the composer whenever the tool changes.
  }, [tool?.id, tool?.acceptsCode, tool?.languagePlaceholder]);

  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [prompt]);

  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [code]);

  const hasCode = code.trim().length > 0;
  const canSend = prompt.trim().length > 0 && !streaming && !disabled;

  const submit = () => {
    if (!canSend) return;
    const parts = [];
    if (hasCode) {
      const lang = language.trim();
      parts.push(`\`\`\`${lang}\n${code.trimEnd()}\n\`\`\``);
    }
    if (prompt.trim()) parts.push(prompt.trim());
    onSend(parts.join('\n\n'));
    setPrompt('');
    setCode('');
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-base-850 shadow-2xl shadow-black/40 focus-within:border-accent/50">
        <textarea
          ref={promptRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value.slice(0, maxPrompt))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={tool?.placeholder || 'Describe what you need…'}
          disabled={disabled}
          className="max-h-[220px] w-full resize-none bg-transparent px-4 py-3.5 text-sm leading-relaxed text-slate-100 placeholder:text-slate-500 focus:outline-none disabled:opacity-60"
        />

        {tool?.acceptsCode && (
          <>
            {codeOpen ? (
              <div className="border-t border-white/[0.06] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-base-800 text-accent-soft">
                    <Code2 className="h-3.5 w-3.5" />
                  </span>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="rounded-lg border border-white/10 bg-base-800 px-2 py-1 text-xs text-slate-300 focus:border-accent/50 focus:outline-none"
                  >
                    {LANGUAGES.map((l) => (
                      <option key={l.value || 'none'} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setCodeOpen(false)}
                    className="ml-auto rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/5 hover:text-slate-200"
                    aria-label="Close code panel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="relative">
                  <textarea
                    ref={codeRef}
                    value={code}
                    onChange={(e) => setCode(e.target.value.slice(0, maxCode))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        submit();
                      }
                    }}
                    rows={4}
                    placeholder={tool.codePlaceholder || 'Paste code here…'}
                    className="w-full resize-none rounded-xl border border-white/10 bg-base-900 p-3 font-mono text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-accent/40 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCodeOpen(true)}
                className="flex w-full items-center gap-2 border-t border-white/[0.06] px-4 py-2.5 text-xs font-medium text-slate-500 transition-colors hover:bg-white/5 hover:text-accent-soft"
              >
                <Code2 className="h-3.5 w-3.5" />
                Add code
                {language && <span className="text-slate-600">· {language}</span>}
              </button>
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2">
          <div className="flex items-center gap-2">
            {tool?.acceptsCode && (
              <span className="hidden items-center gap-1 text-[11px] text-slate-600 sm:flex">
                <ChevronDown className="h-3 w-3" />
                Ctrl+Enter to send
              </span>
            )}
            <p className="text-[11px] text-slate-600">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
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
    </div>
  );
}
