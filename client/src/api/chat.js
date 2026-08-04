import { apiFetch, apiStream } from './client';

export const chatApi = {
  listConversations: () => apiFetch('/chat/conversations'),
  createConversation: (data = {}) => apiFetch('/chat/conversations', { method: 'POST', body: data }),
  getConversation: (id) => apiFetch(`/chat/conversations/${id}`),
  renameConversation: (id, title) => apiFetch(`/chat/conversations/${id}`, { method: 'PATCH', body: { title } }),
  deleteConversation: (id) => apiFetch(`/chat/conversations/${id}`, { method: 'DELETE' }),
  sendMessage: (id, content, handlers, signal) =>
    apiStream(`/chat/conversations/${id}/messages`, {
      method: 'POST',
      body: { content },
      onEvent: handlers.onEvent,
      signal,
    }),
};
