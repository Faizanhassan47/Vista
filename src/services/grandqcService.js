import { apiFetch } from '../api';
import { API_BASE_URL } from '../config';

async function readJson(path, signal) {
    const response = await apiFetch(`${API_BASE_URL}${path}`, { signal });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(typeof body.detail === 'string' ? body.detail : `GrandQC request failed (HTTP ${response.status})`);
    }
    return response.json();
}

export const grandqcService = {
    list(slideId, signal) {
        return readJson(`/api/slides/${encodeURIComponent(slideId)}/qc/analyses`, signal);
    },
    detail(analysisId, signal) {
        return readJson(`/api/qc/analyses/${encodeURIComponent(analysisId)}`, signal);
    },
    geojson(analysisId, signal) {
        return readJson(`/api/qc/analyses/${encodeURIComponent(analysisId)}/geojson`, signal);
    },
};
