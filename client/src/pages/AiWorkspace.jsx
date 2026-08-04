import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, MessageSquare, PanelLeft, Sparkles } from 'lucide-react';
import { useChat } from '../hooks/useChat';
import { useToast } from '../context/ToastContext';
import ChatSidebar from '../components/chat/ChatSidebar';
import ChatMessage from '../components/chat/ChatMessage';
import ChatInput from '../components/chat/ChatInput';
import { Spinner } from '../components/ui/Spinner';

const SUGGESTIONS = [
  {
    icon: Bot,
    title: 'Design an architecture',
    prompt: 'Design a scalable architecture for a multi-tenant SaaS with real-time features.',
  },
  {
    icon: Sparkles,
    title: 'Optimize performance',
    prompt: 'How do I optimize slow PostgreSQL queries with large datasets?',
  },
  {
    icon: MessageSquare,
    title: 'Review my approach',
    prompt: 'What are the best practices for securing a Node.js and Express REST API?',
  },
];

function WelcomeScreen({ onSuggestion }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-violet-600 shadow-lg shadow-accent/30">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold text-white">AI Workspace</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your software engineering copilot. Ask anything — from architecture to debugging.
          </p>
        </div>
      </div>

      <div className="grid w-full max-w-2xl gap-3 sm:grid-cols-3">
        {SUGGESTIONS.map(({ icon: Icon, title, prompt }, i) => (
          <motion.button
            key={title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * i }}
            onClick={() => onSuggestion(prompt)}
            className="group flex flex-col items-start gap-3 rounded-2xl border border-white/[0.06] bg-base-850 p-4 text-left transition-all duration-200 hover:border-accent/40 hover:bg-base-800"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/15 text-accent-soft transition-colors group-hover:bg-accent/25">
              <Icon className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold text-slate-200">{title}</span>
            <span className="text-xs leading-relaxed text-slate-500">{prompt}</span>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

export default function AiWorkspace() {
  const toast = useToast();
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef(null);

  const {
    conversations,
    conversationsLoading,
    activeId,
    conversation,
    messages,
    messagesLoading,
    streaming,
    creating,
    openConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    send,
    stop,
  } = chat;

  const hasContent = messages.length > 0 || messagesLoading;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, activeId, messagesLoading]);

  const handleSend = async (content) => {
    try {
      await send(content);
    } catch (err) {
      toast.error('Failed to send message', err.message);
    }
  };

  const handleRename = async (id, title) => {
    try {
      await renameConversation(id, title);
      toast.success('Conversation renamed', title);
    } catch (err) {
      toast.error('Rename failed', err.message);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteConversation(id);
      toast.success('Conversation deleted', 'The conversation was removed.');
    } catch (err) {
      toast.error('Delete failed', err.message);
    }
  };

  return (
    <div className="flex h-[calc(100dvh-4rem)] -mx-4 -my-6 overflow-hidden sm:-mx-6 lg:-mx-8 lg:-my-8">
      {/* Desktop conversation sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-white/[0.06] md:block">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          loading={conversationsLoading}
          creating={creating}
          onSelect={openConversation}
          onCreate={newConversation}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      </aside>

      {/* Mobile conversation sidebar */}
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
              <ChatSidebar
                conversations={conversations}
                activeId={activeId}
                loading={conversationsLoading}
                creating={creating}
                onSelect={(id) => {
                  setSidebarOpen(false);
                  openConversation(id);
                }}
                onCreate={newConversation}
                onRename={handleRename}
                onDelete={handleDelete}
              />
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
            aria-label="Open conversations"
          >
            <PanelLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold text-white">
              {conversation?.title || 'AI Workspace'}
            </h1>
            <p className="hidden text-[11px] text-slate-500 sm:block">
              {conversation ? `${conversation.messageCount ?? messages.length} messages` : 'Start a conversation'}
            </p>
          </div>
          <button
            onClick={newConversation}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-200"
          >
            New chat
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6">
            {messagesLoading ? (
              <div className="flex flex-1 items-center justify-center">
                <Spinner />
              </div>
            ) : hasContent ? (
              messages.map((message, i) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  streaming={streaming && i === messages.length - 1 && message.role === 'assistant'}
                  error={message.error}
                />
              ))
            ) : (
              <WelcomeScreen onSuggestion={(prompt) => handleSend(prompt)} />
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.06] p-3 sm:p-4">
          <ChatInput onSend={handleSend} onStop={stop} streaming={streaming} />
        </div>
      </div>
    </div>
  );
}
