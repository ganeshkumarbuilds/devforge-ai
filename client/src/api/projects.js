import { apiFetch, apiBlob } from './client';

export const projectsApi = {
  list: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') qs.set(k, v);
    });
    const q = qs.toString();
    return apiFetch(`/projects${q ? `?${q}` : ''}`);
  },
  get: (id) => apiFetch(`/projects/${id}`),
  generate: (data) => apiFetch('/projects/generate', { method: 'POST', body: data, timeout: 20000 }),
  update: (id, data) => apiFetch(`/projects/${id}`, { method: 'PATCH', body: data }),
  remove: (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' }),
  rebuild: (id) => apiFetch(`/projects/${id}/rebuild`, { method: 'POST' }),
  logs: (id, after) => apiFetch(`/projects/${id}/logs${after ? `?after=${after}` : ''}`),
  status: () => apiFetch('/projects/status'),
  downloadZip: (id) => apiBlob(`/projects/${id}/download`),
  exportLogs: (id, format = 'markdown') => apiBlob(`/projects/${id}/export/logs?format=${format}`),
  exportDocs: (id, format = 'markdown') => apiBlob(`/projects/${id}/export/docs?format=${format}`),
};

export const aiApi = {
  status: () => apiFetch('/ai/status'),
};

export function downloadFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function downloadArtifact(loader, fallbackName) {
  const { blob, filename } = await loader();
  downloadFile(blob, filename || fallbackName);
}
