import { apiFetch } from './client';

export const authApi = {
  register: (data) => apiFetch('/auth/register', { method: 'POST', body: data }),
  login: (data) => apiFetch('/auth/login', { method: 'POST', body: data }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  me: () => apiFetch('/auth/me'),
  updateProfile: (data) => apiFetch('/auth/profile', { method: 'PATCH', body: data }),
  updateSettings: (data) => apiFetch('/auth/settings', { method: 'PATCH', body: { settings: data } }),
  changePassword: (data) => apiFetch('/auth/change-password', { method: 'POST', body: data }),
  sessions: () => apiFetch('/auth/sessions'),
};
