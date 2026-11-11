import { apiFetch } from '../api';
import { API_BASE_URL } from '../config';

const apiRoot = `${API_BASE_URL}/api`;
const platformRoot = `${apiRoot}/platform`;

async function request(url, options = {}) {
  const response = await apiFetch(url, options);
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.detail || `Viewer request failed (${response.status})`);
  return data;
}

export const viewerService = {
  annotations: (slideId, signal) => request(`${apiRoot}/slides/${slideId}/annotations`, { signal }),
  createAnnotation: (slideId, annotation) => request(`${apiRoot}/slides/${slideId}/annotations`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(annotation),
  }),
  updateAnnotation: (slideId, annotationId, annotation) => request(`${apiRoot}/slides/${slideId}/annotations/${annotationId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(annotation),
  }),
  deleteAnnotation: (slideId, annotationId) => request(`${apiRoot}/slides/${slideId}/annotations/${annotationId}`, { method: 'DELETE' }),
  validation: (slideId, signal) => request(`${apiRoot}/slides/${slideId}/validation`, { signal }),
  saveCalibration: (slideId, calibration) => request(`${platformRoot}/slides/${slideId}/calibration`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(calibration),
  }),
  aiResults: (slideId, signal) => request(`${platformRoot}/ai/slides/${slideId}/results`, { signal }),

  // ── AI Evidence Map (Phase 1) ────────────────────────────────────────────
  getEvidenceFindings: (slideId, params = {}, signal) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value != null && value !== '') qs.set(key, String(value));
    });
    const query = qs.toString();
    return request(`${apiRoot}/slides/${slideId}/ai/evidence${query ? `?${query}` : ''}`, { signal });
  },
  projectEvidence: (slideId) => request(`${apiRoot}/slides/${slideId}/ai/evidence/project`, { method: 'POST' }),
  getEvidenceFinding: (findingId, signal) => request(`${apiRoot}/ai/evidence/${findingId}`, { signal }),
  getEvidenceHistory: (findingId, signal) => request(`${apiRoot}/ai/evidence/${findingId}/history`, { signal }),
  reviewEvidenceFinding: (findingId, payload) => request(`${apiRoot}/ai/evidence/${findingId}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),

  // ── AI Fusion v1 (Phase 2) ───────────────────────────────────────────────
  listFusionRuns: (slideId, signal) => request(`${apiRoot}/slides/${slideId}/ai/fusion/runs`, { signal }),
  runFusion: (slideId, payload = {}) => request(`${apiRoot}/slides/${slideId}/ai/fusion/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }),
  getFusionRun: (runId, signal) => request(`${apiRoot}/ai/fusion/runs/${runId}`, { signal }),
  getFusionGroup: (groupId, signal) => request(`${apiRoot}/ai/fusion/groups/${groupId}`, { signal }),
  bookmarks: (slideId, signal) => request(`${platformRoot}/slides/${slideId}/bookmarks`, { signal }),
  preferences: (slideId, signal) => request(`${platformRoot}/slides/${slideId}/viewer-preferences`, { signal }),
  savePreferences: (slideId, settings, signal) => request(`${platformRoot}/slides/${slideId}/viewer-preferences`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings), signal,
  }),
  createBookmark: (slideId, bookmark) => request(`${platformRoot}/slides/${slideId}/bookmarks`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bookmark),
  }),
  renameBookmark: (slideId, bookmarkId, name) => request(`${platformRoot}/slides/${slideId}/bookmarks/${bookmarkId}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  }),
  deleteBookmark: (slideId, bookmarkId) => request(`${platformRoot}/slides/${slideId}/bookmarks/${bookmarkId}`, { method: 'DELETE' }),

  // ── Viewing trail coverage ───────────────────────────────────────────────
  getTrail: (slideId, signal) => request(`${apiRoot}/slides/${slideId}/trail`, { signal }),
  saveTrail: (slideId, trail, signal) => request(`${apiRoot}/slides/${slideId}/trail`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trail), signal,
  }),
  clearTrail: (slideId) => request(`${apiRoot}/slides/${slideId}/trail`, { method: 'DELETE' }),

  // ── HoVer-Net AI analysis ────────────────────────────────────────────────
  /** Submit a new AI analysis for the given slide + optional ROI. */
  runAiAnalysis: (slideId, payload, signal) => request(`${apiRoot}/slides/${slideId}/ai/analyses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  }),
  /** Retrieve the list of past AI analyses for a slide. */
  getAiAnalyses: (slideId, signal) => request(`${apiRoot}/slides/${slideId}/ai/analyses`, { signal }),
  /** Retrieve a single AI analysis record by its ID. */
  getAiAnalysis: (analysisId, signal) => request(`${apiRoot}/ai/analyses/${analysisId}`, { signal }),
  /** Retrieve patch count and duration estimation for ROI or slide. */
  getAiEstimate: (slideId, params, signal) => {
    const qs = params ? new URLSearchParams(params).toString() : '';
    return request(`${apiRoot}/slides/${slideId}/ai/estimate${qs ? `?${qs}` : ''}`, { signal });
  },
  /** Retrieve real-time progress status of an AI background job. */
  getAiJobStatus: (jobId, signal) => request(`${apiRoot}/ai/jobs/${jobId}`, { signal }),
  /** Cancel a running AI background job. */
  cancelAiJob: (jobId) => request(`${apiRoot}/ai/jobs/${jobId}/cancel`, { method: 'POST' }),
  /** Returns the absolute URL for downloading the AI PDF report. */
  aiReportPdfUrl: (analysisId) => `${API_BASE_URL}/api/ai/analyses/${analysisId}/report.pdf`,
  /** Generate or re-generate AI PDF report on demand. */
  generateAiReport: (analysisId) => request(`${apiRoot}/ai/analyses/${analysisId}/report`, {
    method: 'POST',
  }),
  /** Download AI PDF report using authenticated fetch and blob. */
  downloadAiReportPdf: async (analysisId) => {
    const response = await apiFetch(`${apiRoot}/ai/analyses/${analysisId}/report.pdf`);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to download AI report (${response.status})`);
    }
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const disposition = response.headers.get('Content-Disposition') || response.headers.get('content-disposition');
    let filename = `ai_report_analysis_${analysisId}.pdf`;
    if (disposition) {
      const match = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)["']?/i);
      if (match && match[1]) {
        filename = match[1].trim();
      }
    }

    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => window.URL.revokeObjectURL(url), 10000);
  },
  /** Returns the URL of the ROI image for the analysis. */
  aiRoiImageUrl: (analysisId) => `${API_BASE_URL}/api/ai/analyses/${analysisId}/roi.png`,
  /** Returns the URL of the colored overlay image for the analysis. */
  aiOverlayImageUrl: (analysisId) => `${API_BASE_URL}/api/ai/analyses/${analysisId}/overlay.png`,
};
