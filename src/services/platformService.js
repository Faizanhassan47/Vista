import { apiFetch } from '../api';
import { API_BASE_URL } from '../config';

const root = `${API_BASE_URL}/api/platform`;

async function request(path, options = {}) {
  const response = await apiFetch(`${root}${path}`, options);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `Request failed (${response.status})`);
  return data;
}

export const platformService = {
  branding: (signal) => request('/branding', { signal }),
  updateSetting: (key, value) => request(`/settings/${encodeURIComponent(key)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }) }),
  health: (signal) => request('/health', { signal }),
  dashboardMetrics: (signal) => request('/dashboard/metrics', { signal }),
  workQueue: (signal) => request('/dashboard/work-queue', { signal }),
  notifications: (unreadOnly = false, signal) => request(`/notifications?unread_only=${unreadOnly ? 'true' : 'false'}`, { signal }),
  markNotificationRead: (notificationId) => request(`/notifications/${notificationId}/read`, { method: 'PATCH' }),
  searchCases: (params = {}, signal) => {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, val]) => {
      if (val !== null && val !== undefined && val !== '') query.append(key, val);
    });
    const qs = query.toString();
    return request(`/cases/search${qs ? `?${qs}` : ''}`, { signal });
  },
  caseTimeline: (caseId, signal) => request(`/cases/${caseId}/timeline`, { signal }),
  caseLinks: (caseId, signal) => request(`/cases/${caseId}/links`, { signal }),
  createCaseLink: (caseId, body) => request(`/cases/${caseId}/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  createConsultation: (caseId, body) => request(`/cases/${caseId}/consultations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  reportTemplates: (signal) => request('/report-templates', { signal }),
  createReportTemplate: (body) => request('/report-templates', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  ingestionJobs: (signal) => request('/ingestion/jobs', { signal }),
  batchIngestion: (action, job_ids) => request('/ingestion/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, job_ids }),
  }),
  reconciliationItems: (signal) => request('/reconciliation', { signal }),
  resolveReconciliation: (itemId, resolvedCaseId) => request(`/reconciliation/${itemId}/resolve`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resolved_case_id: resolvedCaseId }),
  }),
  aiModels: (signal) => request('/ai/models', { signal }),
  aiJobs: (signal) => request('/ai/jobs', { signal }),
  hl7Events: (signal) => request('/hl7/events', { signal }),
  compatibility: (signal) => request('/compatibility', { signal }),
  addCompatibility: (body) => request('/compatibility', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }),
  backups: (signal) => request('/backups', { signal }),
  retryIngestion: (id) => request(`/ingestion/jobs/${id}/retry`, { method: 'POST' }),
  processIngestion: (id) => request(`/ingestion/jobs/${id}/process`, { method: 'POST' }),
  replayHl7: (id) => request(`/hl7/events/${id}/replay`, { method: 'POST' }),
  createBackup: (name = 'pathology') => request('/backups', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  getViewerPreferences: (slideId, signal) => request(`/slides/${slideId}/viewer-preferences`, { signal }),
  saveViewerPreferences: (slideId, prefs) => request(`/slides/${slideId}/viewer-preferences`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  }),
  deleteSlide: (slideId) => request(`/slides/${slideId}`, { method: 'DELETE' }),
  deleteCase: (caseId, { confirmFinalized = false } = {}) => request(`/cases/${caseId}${confirmFinalized ? '?confirm_finalized=true' : ''}`, { method: 'DELETE' }),
  hl7Samples: (signal) => request('/hl7/sandbox/samples', { signal }),
  validateHl7: (rawPayload) => request('/hl7/sandbox/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_payload: rawPayload }),
  }),
  simulateHl7: (rawPayload) => request('/hl7/sandbox/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_payload: rawPayload }),
  }),
  exportAnnotations: (slideId, format = 'geojson') => `${root}/slides/${slideId}/annotations/export?format=${format}`,
};
