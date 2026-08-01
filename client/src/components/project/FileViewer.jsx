import { Copy, Download, FileCode2, Check } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { downloadTextFile } from '../../lib/utils';
import { useState } from 'react';

const LANG_LABELS = {
  javascript: 'JavaScript',
  jsx: 'JSX',
  typescript: 'TypeScript',
  tsx: 'TSX',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  markdown: 'Markdown',
  sql: 'SQL',
  yaml: 'YAML',
  shell: 'Shell',
  docker: 'Docker',
};

export default function FileViewer({ file }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  if (!file) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-base-800 text-slate-600">
          <FileCode2 className="h-6 w-6" />
        </div>
        <p className="font-semibold text-white">Select a file to view it</p>
        <p className="max-w-xs text-sm text-slate-400">
          Pick a file from the explorer to inspect the generated code.
        </p>
      </div>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(file.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('Copy failed', 'Clipboard unavailable in this browser.');
    }
  };

  const download = () => {
    const name = file.path.split('/').pop() || 'file.txt';
    downloadTextFile(file.content, name);
    toast.success('Downloaded', name);
  };

  const lines = file.content.split('\n').length;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] bg-base-900/50 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-accent-soft" />
          <span className="truncate font-mono text-sm text-slate-200">{file.path}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {file.language && (
            <span className="hidden rounded-md bg-base-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:block">
              {LANG_LABELS[file.language] || file.language}
            </span>
          )}
          <span className="hidden text-[11px] text-slate-500 sm:block">{lines} lines</span>
          <button onClick={copy} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200" aria-label="Copy file">
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </button>
          <button onClick={download} className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200" aria-label="Download file">
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-base-950/60">
        <pre className="min-w-full p-4 font-mono text-[12.5px] leading-relaxed text-slate-300">
          <code>{file.content}</code>
        </pre>
      </div>
    </div>
  );
}
