import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PanelLeft, Sparkles, RotateCcw, Inbox } from 'lucide-react';
import { useAiTools } from '../hooks/useAiTools';
import { useToast } from '../context/ToastContext';
import ToolsSidebar from '../components/aitools/ToolsSidebar';
import ToolMessage from '../components/aitools/ToolMessage';
import ToolInput from '../components/aitools/ToolInput';
import ToolIcon from '../components/aitools/ToolIcon';
import { Spinner } from '../components/ui/Spinner';
import Button from '../components/ui/Button';

function WelcomeScreen({ tool, onExample }) {
  if (!tool) return null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet-600 shadow-lg shadow-accent/30">
          <ToolIcon name={tool.icon} size={30} className="text-white" />
        </div>
        <div className="max-w-xl">
          <h1 className="text-2xl font-extrabold text-white">{tool.name}</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">{tool.description}</p>
        </div>
      </div>

      {tool.examples?.length > 0 && (
        <div className="w-full max-w-2xl">
          <p className="mb-3 flex items-center justify-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-slate-500">
            <Sparkles className="h-3.5 w-3.5" /> Try one of these
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {tool.examples.map((ex, i) => (
              <motion.button
                key={ex}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.06 * i }}
                onClick={() => onExample(ex)}
                className="group flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-base-850 p-4 text-left transition-all duration-200 hover:border-accent/40 hover:bg-base-800"
              >
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-soft transition-colors group-hover:bg-accent/25">
                  <ToolIcon name={tool.icon} size={15} />
                </span>
                <span className="text-sm leading-relaxed text-slate-400 transition-colors group-hover:text-slate-300">
                  {ex}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AiToolsPage() {
  const toast = useToast();
  const chat = useAiTools();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef(null);

  const {
    tools,
    toolsLoading,
    toolsError,
    activeTool,
    activeToolId,
    activeMessages,
    streamingToolId,
    selectTool,
    clearSession,
    send,
    stop,
  } = chat;

  const streaming = streamingToolId === activeToolId;
  const hasContent = activeMessages.length > 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeMessages, activeToolId]);

  const handleSend = async (content) => {
    if (!activeToolId) return;
    try {
      await send(activeToolId, content);
    } catch (err) {
      toast.error('Failed to send', err.message);
    }
  };

  const handleNew = () => {
    if (activeToolId) {
      clearSession(activeToolId);
      toast.info('Session cleared', `Started a fresh ${activeTool?.name || ''} session.`);
    }
  };

  const sidebar = (
    <ToolsSidebar
      tools={tools}
      activeToolId={activeToolId}
      streamingToolId={streamingToolId}
      onSelect={(id) => {
        setSidebarOpen(false);
        selectTool(id);
      }}
      onNew={handleNew}
    />
  );

  if (toolsLoading) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-slate-500">Loading AI tools…</p>
        </div>
      </div>
    );
  }

  if (toolsError) {
    return (
      <div className="flex h-[calc(100dvh-4rem)] items-center justify-center">
        <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-rose-500/25 bg-rose-500/10 p-8 text-center">
          <Inbox className="h-8 w-8 text-rose-400" />
          <p className="font-semibold text-white">Could not load AI tools</p>
          <p className="text-sm text-rose-200/80">{toolsError}</p>
          <Button variant="secondary" onClick={() => chat.reset()}>
            <RotateCcw className="h-4 w-4" /> Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] -mx-4 -my-6 overflow-hidden sm:-mx-6 lg:-mx-8 lg:-my-8">
      {/* Desktop tool sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-white/[0.06] md:block">{sidebar}</aside>

      {/* Mobile tool sidebar */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              className="fixed inset-y-0 left-0 z-50 w-72 md:hidden"
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', duration: 0.4, bounce: 0.2 }}
            >
              {sidebar}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col bg-base-950">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200 md:hidden"
            aria-label="Open tools"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent-soft">
              <ToolIcon name={activeTool?.icon} size={16} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-bold text-white">
                {activeTool?.name || 'AI Tools'}
              </h1>
              <p className="hidden truncate text-[11px] text-slate-500 sm:block">
                {activeTool?.tagline || 'Select a tool to get started'}
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {hasContent && (
              <button
                onClick={handleNew}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
              >
                New session
              </button>
            )}
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {hasContent ? (
              activeMessages.map((message, i) => (
                <ToolMessage
                  key={message.id}
                  message={message}
                  tool={activeTool}
                  streaming={streaming && i === activeMessages.length - 1 && message.role === 'assistant'}
                  error={message.error}
                />
              ))
            ) : (
              <WelcomeScreen tool={activeTool} onExample={(prompt) => handleSend(prompt)} />
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.06] p-3 sm:p-4">
          <ToolInput
            tool={activeTool}
            onSend={handleSend}
            onStop={stop}
            streaming={streaming}
          />
        </div>
      </div>
    </div>
  );
}
