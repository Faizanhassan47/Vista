import { apiFetch } from '../api';
import { API_BASE_URL } from '../config';

function errorMessage(data, fallback) {
  const detail = data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => (typeof item?.msg === 'string' ? item.msg : '')).filter(Boolean);
    if (messages.length) return messages.join('; ');
  }
  return fallback;
}

export function claheUsesTiles(imagePixelsPerScreen, overviewDownsample) {
  return Number(imagePixelsPerScreen) < Number(overviewDownsample);
}

export const dipService = {
  async runOtsu(slideId, { mode = 'roi', roi = null, gaussianKernel = 5 } = {}, signal) {
    const body = {
      algorithm: 'otsu',
      mode,
      parameters: { gaussian_kernel: gaussianKernel },
    };
    if (mode !== 'whole_slide') {
      body.roi = {
        x: Math.floor(roi.x),
        y: Math.floor(roi.y),
        width: Math.floor(roi.width),
        height: Math.floor(roi.height),
      };
    }
    const response = await apiFetch(`${API_BASE_URL}/api/slides/${slideId}/dip/segmentation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(data, 'Otsu segmentation failed'));
    return data;
  },

  async runCanny(slideId, { mode = 'roi', roi = null, gaussianKernel = 5, lowThreshold = 50, highThreshold = 150 } = {}, signal) {
    const body = {
      algorithm: 'canny',
      mode,
      parameters: {
        gaussian_kernel: gaussianKernel,
        low_threshold: lowThreshold,
        high_threshold: highThreshold,
      },
    };
    if (mode !== 'whole_slide') {
      body.roi = {
        x: Math.floor(roi.x),
        y: Math.floor(roi.y),
        width: Math.floor(roi.width),
        height: Math.floor(roi.height),
      };
    }
    const response = await apiFetch(`${API_BASE_URL}/api/slides/${slideId}/dip/segmentation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(data, 'Canny edge detection failed'));
    return data;
  },

  async runClahe(slideId, { mode = 'roi', roi = null, clipLimit = 2, tileGridSize = 8 } = {}, signal) {
    const body = {
      algorithm: 'clahe',
      mode,
      parameters: { clip_limit: clipLimit, tile_grid_size: tileGridSize },
    };
    if (mode !== 'whole_slide') {
      body.roi = {
        x: Math.floor(roi.x),
        y: Math.floor(roi.y),
        width: Math.floor(roi.width),
        height: Math.floor(roi.height),
      };
    }
    const response = await apiFetch(`${API_BASE_URL}/api/slides/${slideId}/dip/segmentation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorMessage(data, 'CLAHE enhancement failed'));
    return data;
  },

  async claheTile(slideId, { x, y, width, height, clipLimit, tileGridSize }, signal) {
    const params = new URLSearchParams({
      x: String(Math.floor(x)),
      y: String(Math.floor(y)),
      width: String(Math.floor(width)),
      height: String(Math.floor(height)),
      clip_limit: String(clipLimit),
      tile_grid_size: String(tileGridSize),
    });
    const response = await apiFetch(`${API_BASE_URL}/api/slides/${slideId}/dip/clahe-tile?${params}`, { signal });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(errorMessage(data, 'Could not enhance this region'));
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  },

  async loadOverlay(overlayUrl, signal) {
    const url = overlayUrl.startsWith('http') ? overlayUrl : `${API_BASE_URL}${overlayUrl}`;
    const response = await apiFetch(url, { signal });
    if (!response.ok) throw new Error('Could not load the segmentation overlay');
    const blob = await response.blob();
    if (!blob.type.includes('image/png')) throw new Error('Segmentation overlay was not a PNG');
    return URL.createObjectURL(blob);
  },

  async loadViews(record, signal) {
    const views = record.views || { overlay: record.overlay_url };
    const entries = await Promise.all(Object.entries(views).map(async ([name, path]) => [name, await this.loadOverlay(path, signal)]));
    return Object.fromEntries(entries);
  },
};
