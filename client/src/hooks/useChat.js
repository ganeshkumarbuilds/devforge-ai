import { useCallback, useEffect, useRef, useState } from 'react';
import { chatApi } from '../api/chat';

let tempId = 0;
const nextTempId = () => `temp-${Date.now()}-${tempId++}`;

export function useChat() {
  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [activeId, setActiveId] = useState(null);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [creating, setCreating] = useState(false);
  const abortRef = useRef(null);

  const loadConversations = useCallback(async () => {
    try {
      setConversationsLoading(true);
      const data = await chatApi.listConversations();
      setConversations(data.conversations);
    } catch {
      // Sidebar will render the empty state; errors surface on retry.
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const upsertConversationInList = useCallback((updated) => {
    setConversations((prev) => {
      const exists = prev.some((c) => c.id === updated.id);
      if (exists) return prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c));
      return [updated, ...prev];
    });
  }, []);

  const openConversation = useCallback(async (id) => {
    if (abortRef.current) abortRef.current.abort();
    setActiveId(id);
    setMessages([]);
    setMessagesLoading(true);
    try {
      const data = await chatApi.getConversation(id);
      setConversation(data.conversation);
      setMessages(data.messages);
      upsertConversationInList(data.conversation);
    } catch {
      setMessages([]);
    } finally {
      setMessagesLoading(false);
    }
  }, [upsertConversationInList]);

  const createConversation = useCallback(async (title) => {
    const data = await chatApi.createConversation(title ? { title } : {});
    setConversations((prev) => [data.conversation, ...prev]);
    return data.conversation;
  }, []);

  const newConversation = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    setCreating(true);
    try {
      const created = await createConversation();
      setActiveId(created.id);
      setConversation(created);
      setMessages([]);
      return created;
    } finally {
      setCreating(false);
    }
  }, [createConversation]);

  const renameConversation = useCallback(
    async (id, title) => {
      const data = await chatApi.renameConversation(id, title);
      upsertConversationInList(data.conversation);
      if (conversation && conversation.id === id) setConversation(data.conversation);
    },
    [conversation, upsertConversationInList]
  );

  const deleteConversation = useCallback(
    async (id) => {
      await chatApi.deleteConversation(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setConversation(null);
        setMessages([]);
      }
    },
    [activeId]
  );

  const send = useCallback(
    async (content) => {
      if (streaming) return;

      let conversationId = activeId;
      if (!conversationId) {
        try {
          const created = await createConversation();
          conversationId = created.id;
          setActiveId(created.id);
          setConversation(created);
        } catch {
          return;
        }
      }

      const userMessage = { id: nextTempId(), role: 'user', content, createdAt: new Date().toISOString() };
      const assistantMessage = { id: nextTempId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      let streamError = null;

      try {
        await chatApi.sendMessage(
          conversationId,
          content,
          {
            onEvent: (payload) => {
              if (payload.delta) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMessage.id ? { ...m, content: m.content + payload.delta } : m))
                );
              } else if (payload.done) {
                setMessages((prev) =>
                  prev.map((m) => (m.id === assistantMessage.id ? { ...payload.message, content: m.content } : m))
                );
                setConversation((prev) =>
                  prev && prev.id === conversationId ? { ...prev, updatedAt: new Date().toISOString() } : prev
                );
              } else if (payload.error) {
                streamError = payload.error;
              } else if (payload.waiting) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMessage.id ? { ...m, waiting: payload, error: null } : m
                  )
                );
              }
            },
          },
          controller.signal
        );
      } catch (err) {
        if (err.status !== 499) streamError = err.message;
      } finally {
        abortRef.current = null;
        setStreaming(false);
        if (streamError) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMessage.id
                ? { ...m, error: streamError, content: m.content || 'Sorry, I could not generate a response.' }
                : m
            )
          );
        }
        loadConversations();
      }
    },
    [activeId, streaming, createConversation, loadConversations]
  );

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  return {
    conversations,
    conversationsLoading,
    activeId,
    conversation,
    messages,
    messagesLoading,
    streaming,
    creating,
    loadConversations,
    openConversation,
    createConversation,
    newConversation,
    renameConversation,
    deleteConversation,
    send,
    stop,
  };
}
