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
  stats: () => apiFetch('/projects/stats'),
  toggleFavorite: (id) => apiFetch(`/projects/${id}/favorite`, { method: 'PATCH' }),
  get: (id) => apiFetch(`/projects/${id}`),
  generate: (data) => apiFetch('/projects/generate', { method: 'POST', body: data, timeout: 20000 }),
  update: (id, data) => apiFetch(`/projects/${id}`, { method: 'PATCH', body: data }),
  remove: (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' }),
  rebuild: (id) => apiFetch(`/projects/${id}/rebuild`, { method: 'POST' }),
  validate: (id) => apiFetch(`/projects/${id}/validate`, { method: 'POST', timeout: 600000 }),
  repair: (id, area) => apiFetch(`/projects/${id}/repair`, { method: 'POST', body: { area }, timeout: 20000 }),
  listRepairs: (id) => apiFetch(`/projects/${id}/repairs`),
  logs: (id, after) => apiFetch(`/projects/${id}/logs${after ? `?after=${after}` : ''}`),
  status: () => apiFetch('/projects/status'),
  downloadZip: (id) => apiBlob(`/projects/${id}/download`, { timeout: 600000 }),
  exportLogs: (id, format = 'markdown') => apiBlob(`/projects/${id}/export/logs?format=${format}`),
  exportDocs: (id, format = 'markdown') => apiBlob(`/projects/${id}/export/docs?format=${format}`),
  listVersions: (id) => apiFetch(`/projects/${id}/versions`),
  getVersion: (id, versionId) => apiFetch(`/projects/${id}/versions/${versionId}`),
  createVersion: (id, data) => apiFetch(`/projects/${id}/versions`, { method: 'POST', body: data }),
  restoreVersion: (id, versionId) => apiFetch(`/projects/${id}/versions/${versionId}/restore`, { method: 'POST' }),
  diffVersions: (id, versionId, compareId) => apiFetch(`/projects/${id}/versions/${versionId}/diff/${compareId}`),
  migration: (id, versionId) => apiFetch(`/projects/${id}/versions/${versionId}/migration`, { timeout: 120000 }),
  previewStatus: (id) => apiFetch(`/projects/${id}/preview/status`),
  previewStart: (id) => apiFetch(`/projects/${id}/preview/start`, { method: 'POST' }),
  previewStop: (id) => apiFetch(`/projects/${id}/preview/stop`, { method: 'POST' }),
  previewLogs: (id, after) => apiFetch(`/projects/${id}/preview/logs${after ? `?after=${after}` : ''}`),
  deployment: (id) => apiFetch(`/projects/${id}/deployment`),
  downloadDeployment: (id) => apiBlob(`/projects/${id}/export/deployment`),
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
