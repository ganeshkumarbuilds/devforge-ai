import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { aiToolsApi } from '../api/aiTools';

let tempId = 0;
const nextTempId = () => `temp-${Date.now()}-${tempId++}`;

/**
 * Per-tool copilot state. Each tool keeps its own independent message history,
 * so switching tools preserves context the way Cursor/Copilot sessions do.
 */
export function useAiTools() {
  const [tools, setTools] = useState([]);
  const [categories, setCategories] = useState([]);
  const [toolsLoading, setToolsLoading] = useState(true);
  const [toolsError, setToolsError] = useState(null);
  const [activeToolId, setActiveToolId] = useState(null);
  const [sessions, setSessions] = useState({});
  const [streamingToolId, setStreamingToolId] = useState(null);
  const abortRef = useRef(null);

  const loadTools = useCallback(async () => {
    try {
      setToolsLoading(true);
      const data = await aiToolsApi.list();
      setTools(data.tools || []);
      setCategories(data.categories || []);
      setActiveToolId((prev) => {
        if (prev && (data.tools || []).some((t) => t.id === prev)) return prev;
        return (data.tools && data.tools[0]?.id) || null;
      });
    } catch (err) {
      setToolsError(err.message);
    } finally {
      setToolsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const activeTool = useMemo(
    () => tools.find((t) => t.id === activeToolId) || null,
    [tools, activeToolId]
  );

  const activeMessages = activeToolId ? sessions[activeToolId] || [] : [];

  const selectTool = useCallback((id) => {
    if (abortRef.current) abortRef.current.abort();
    setActiveToolId(id);
  }, []);

  const clearSession = useCallback((toolId) => {
    if (abortRef.current) abortRef.current.abort();
    setSessions((prev) => ({ ...prev, [toolId]: [] }));
  }, []);

  const send = useCallback(
    async (toolId, content) => {
      if (streamingToolId) return;

      const userMessage = { id: nextTempId(), role: 'user', content, createdAt: new Date().toISOString() };
      const assistantMessage = { id: nextTempId(), role: 'assistant', content: '', createdAt: new Date().toISOString() };

      setSessions((prev) => ({
        ...prev,
        [toolId]: [...(prev[toolId] || []), userMessage, assistantMessage],
      }));
      setStreamingToolId(toolId);

      const history = [...(sessions[toolId] || []), userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const controller = new AbortController();
      abortRef.current = controller;

      let streamError = null;

      try {
        await aiToolsApi.run(
          toolId,
          history,
          {
            onEvent: (payload) => {
              if (payload.delta) {
                setSessions((prev) => ({
                  ...prev,
                  [toolId]: prev[toolId].map((m) =>
                    m.id === assistantMessage.id ? { ...m, content: m.content + payload.delta } : m
                  ),
                }));
              } else if (payload.done) {
                setSessions((prev) => ({
                  ...prev,
                  [toolId]: prev[toolId].map((m) =>
                    m.id === assistantMessage.id ? { ...m, content: payload.content || m.content } : m
                  ),
                }));
              } else if (payload.error) {
                streamError = payload.error;
              }
            },
          },
          controller.signal
        );
      } catch (err) {
        if (err.status !== 499) streamError = err.message;
      } finally {
        abortRef.current = null;
        setStreamingToolId(null);
        if (streamError) {
          setSessions((prev) => ({
            ...prev,
            [toolId]: prev[toolId].map((m) =>
              m.id === assistantMessage.id
                ? { ...m, error: streamError, content: m.content || 'Sorry, I could not generate a response.' }
                : m
            ),
          }));
        }
      }
    },
    [streamingToolId, sessions]
  );

  const stop = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
  }, []);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setSessions({});
    loadTools();
  }, [loadTools]);

  return {
    tools,
    categories,
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
    reset,
  };
}
