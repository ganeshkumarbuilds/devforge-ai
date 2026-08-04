import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { Check, Copy, Terminal } from 'lucide-react';
import { copyText } from '../../lib/utils';
import { cn } from '../../lib/utils';
import 'highlight.js/styles/github-dark.css';

function extractLanguage(children) {
  const codeEl = Array.isArray(children)
    ? children.find((child) => child && child.type === 'code')
    : children;
  if (!codeEl) return null;
  const className = (codeEl.props && codeEl.props.className) || '';
  const match = /language-([\w+-]+)/.exec(className);
  return match ? match[1] : null;
}

function CodeBlock({ children }) {
  const preRef = useRef(null);
  const [copied, setCopied] = useState(false);
  const language = extractLanguage(children) || 'plaintext';

  const handleCopy = async () => {
    const text = preRef.current ? preRef.current.textContent : '';
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="group relative my-4 overflow-hidden rounded-xl border border-white/10 bg-base-900">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-base-850/80 px-4 py-2">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
          <Terminal className="h-3.5 w-3.5" />
          {language}
        </span>
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        ref={preRef}
        className="overflow-x-auto p-4 text-[13px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  );
}

export default function Markdown({ content, className }) {
  return (
    <div className={cn('chat-markdown', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: CodeBlock,
          a: (props) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
