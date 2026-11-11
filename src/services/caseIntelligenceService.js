import { API_BASE_URL } from '../config';
import { apiFetch } from '../api';

async function request(path, options = {}) {
  const response = await apiFetch(`${API_BASE_URL}${path}`, options);
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || `Request failed (${response.status})`);
  return data;
}

export const caseIntelligenceService = {
  fusionSummary: (caseId, signal) => request(`/api/cases/${caseId}/ai/fusion/summary`, { signal }),
  reportEvidence: (caseId, signal) => request(`/api/cases/${caseId}/ai/report-evidence`, { signal }),
  buildReportDraft: (caseId, payload = {}) => request(`/api/cases/${caseId}/ai-report-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  compareFusionRuns: (fromRunId, toRunId, signal) => (
    request(`/api/ai/fusion/runs/${fromRunId}/compare/${toRunId}`, { signal })
  ),
};
