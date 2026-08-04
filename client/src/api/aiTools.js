import { apiFetch, apiStream } from './client';

export const aiToolsApi = {
  list: () => apiFetch('/ai-tools'),
  run: (tool, messages, handlers, signal) =>
    apiStream('/ai-tools/run', {
      method: 'POST',
      body: { tool, messages },
      onEvent: handlers.onEvent,
      signal,
    }),
};
