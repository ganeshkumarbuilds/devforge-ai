import { motion } from 'framer-motion';
import { Plus, Search } from 'lucide-react';
import { useState, useMemo } from 'react';
import ToolIcon from './ToolIcon';
import { cn } from '../../lib/utils';

function ToolItem({ tool, active, streaming, onClick }) {
  return (
    <motion.button
      layout
      onClick={onClick}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm transition-colors',
        active
          ? 'bg-accent/15 text-white ring-1 ring-inset ring-accent/30'
          : 'text-slate-400 hover:bg-base-800 hover:text-slate-200'
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          active ? 'bg-accent/25 text-accent-soft' : 'bg-base-800 text-slate-500 group-hover:text-accent-soft'
        )}
      >
        <ToolIcon name={tool.icon} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{tool.name}</span>
        <span className="block truncate text-[11px] text-slate-500">{tool.tagline}</span>
      </span>
      {streaming && (
        <span className="flex h-1.5 w-1.5 shrink-0 rounded-full bg-accent-soft">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-accent-soft" />
        </span>
      )}
    </motion.button>
  );
}

export default function ToolsSidebar({ tools, activeToolId, streamingToolId, onSelect, onNew }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return tools;
    const q = query.trim().toLowerCase();
    return tools.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.tagline || '').toLowerCase().includes(q)
    );
  }, [tools, query]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const t of filtered) {
      const key = t.category || 'other';
      const label = t.categoryLabel || 'Other';
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key).items.push(t);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="flex h-full flex-col bg-base-900/95 backdrop-blur-xl">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] px-4">
        <div>
          <h2 className="text-sm font-bold text-white">AI Tools</h2>
          <p className="text-[11px] text-slate-500">Software engineering copilot</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            title="New session for the active tool"
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="border-b border-white/[0.06] px-4 py-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tools…"
            className="w-full rounded-xl border border-white/10 bg-base-800/70 py-2 pl-8 pr-2 text-xs text-slate-200 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {grouped.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-slate-500">No tools match your search.</p>
        )}
        {grouped.map(([key, { label, items }]) => (
          <div key={key}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
              {label}
            </p>
            <div className="space-y-0.5">
              {items.map((tool) => (
                <ToolItem
                  key={tool.id}
                  tool={tool}
                  active={tool.id === activeToolId}
                  streaming={tool.id === streamingToolId}
                  onClick={() => onSelect(tool.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="shrink-0 border-t border-white/[0.06] p-3">
        <p className="px-2 text-center text-[10px] leading-relaxed text-slate-600">
          Responses are AI-generated. Review important code before using it.
        </p>
      </div>
    </div>
  );
}
