import { useState } from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, Pencil, Plus, Trash2, Check, X, Loader2, Inbox } from 'lucide-react';
import { cn, timeAgo } from '../../lib/utils';

function ConversationItem({ conversation, active, onSelect, onRename, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  const startRename = () => {
    setDraft(conversation.title);
    setEditing(true);
  };

  const saveRename = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== conversation.title) onRename(conversation.id, title);
  };

  return (
    <div
      className={cn(
        'group relative rounded-xl transition-colors duration-200',
        active ? 'bg-accent/15' : 'hover:bg-base-800/80'
      )}
    >
      {editing ? (
        <div className="flex items-center gap-1 p-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveRename();
              if (e.key === 'Escape') setEditing(false);
            }}
            onBlur={saveRename}
            className="w-full rounded-lg border border-accent/40 bg-base-900 px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
          <button onClick={saveRename} className="shrink-0 rounded-md p-1 text-emerald-400 hover:bg-white/5" aria-label="Save">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setEditing(false)}
            className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-slate-300"
            aria-label="Cancel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : confirming ? (
        <div className="flex items-center justify-between gap-2 p-2">
          <span className="text-xs text-slate-400">Delete?</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setConfirming(false);
                onDelete(conversation.id);
              }}
              className="rounded-lg bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-500/30"
            >
              Yes
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              No
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => onSelect(conversation.id)}
          className={cn(
            'flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors duration-200',
            active ? 'text-white' : 'text-slate-400 hover:text-slate-200'
          )}
        >
          <MessageSquare className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-accent-soft' : 'text-slate-500')} />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{conversation.title}</span>
            <span className="block text-[10px] text-slate-500">{timeAgo(conversation.updatedAt)}</span>
          </span>
        </button>
      )}

      {!editing && !confirming && (
        <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-base-800/95 p-0.5 shadow-lg group-hover:flex">
          <button
            onClick={(e) => {
              e.stopPropagation();
              startRename();
            }}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
            aria-label="Rename conversation"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
            aria-label="Delete conversation"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatSidebar({
  conversations,
  activeId,
  loading,
  creating,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}) {
  return (
    <div className="flex h-full flex-col bg-base-900/80 backdrop-blur-xl">
      <div className="border-b border-white/[0.06] p-3">
        <button
          onClick={onCreate}
          disabled={creating}
          className="btn-primary w-full"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <p className="mb-2 px-3 pt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Conversations
        </p>

        {loading ? (
          <div className="space-y-2 px-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-xl bg-base-800/70" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-3 py-10 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-base-800 text-slate-500">
              <Inbox className="h-5 w-5" />
            </div>
            <p className="text-xs font-medium text-slate-400">No conversations yet</p>
            <p className="text-[11px] text-slate-500">Start a new chat to begin.</p>
          </div>
        ) : (
          <div className="space-y-1">
            {conversations.map((conversation) => (
              <motion.div key={conversation.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                <ConversationItem
                  conversation={conversation}
                  active={conversation.id === activeId}
                  onSelect={onSelect}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
