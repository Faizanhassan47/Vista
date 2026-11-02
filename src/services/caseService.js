import { apiFetch } from '../api';
import { API_BASE_URL } from '../config';

async function request(path, options = {}) {
  const response = await apiFetch(`${API_BASE_URL}${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `Request failed (${response.status})`);
  return data;
}

export const caseService = {
  nextId: (signal) => request('/api/cases/next-id', { signal }),
  list: (paramsOrSignal = {}, optionalSignal) => {
    const signal = paramsOrSignal?.aborted !== undefined ? paramsOrSignal : optionalSignal;
    const params = paramsOrSignal?.aborted !== undefined ? {} : paramsOrSignal;
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined && value !== '') query.set(key, value);
    });
    const suffix = query.size ? `?${query.toString()}` : '';
    return request(`/api/cases${suffix}`, { signal });
  },
  reviewers: (signal) => request('/api/reviewers', { signal }),
  updateStatus: (caseId, status, signal) => request(`/api/cases/${caseId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
    signal,
  }),
};
