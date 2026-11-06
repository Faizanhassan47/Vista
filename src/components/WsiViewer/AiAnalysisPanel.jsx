/**
 * AiAnalysisPanel.jsx
 *
 * HoVer-Net AI nucleus analysis panel for the WSI viewer sidebar.
 * Displays run controls, 6-class PanNuke breakdown, nucleus stats,
 * morphology metrics, history selector, and PDF download.
 *
 * Constraints:
 *  - No inline styles — all CSS in AiAnalysisPanel.css
 *  - Research Use Only disclaimer always visible when results present
 *  - Confidence scores are genuine type_prob values from the model
 *  - Overlays are managed via callbacks into WsiViewer (parent)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, AlertTriangle, ChevronDown, Download,
  Loader2, Play, RefreshCw, StopCircle, X, Zap
} from 'lucide-react';
import Modal from '../Modal/Modal';
import { viewerService } from '../../services/viewerService';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';
import { aiSubscriptionService } from '../../services/aiSubscriptionService';
import { grandqcService } from '../../services/grandqcService';
import { qcClassColor } from './GrandQCOverlay';
import './AiAnalysisPanel.css';

function formatDuration(sec) {
  if (sec == null || isNaN(sec) || sec < 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  if (m === 0) return `${s}s`;
  return `${m}m ${s < 10 ? '0' : ''}${s}s`;
}

function isKongNetAnalysis(analysis) {
  return analysis?.feature_code === 'MITOTIC_DETECTION' || /kongnet/i.test(String(analysis?.model_name ?? ''));
}

const CAMELYON_FEATURE_CODE = 'CAMELYON_TUMOR_DETECTION';
const CAMELYON_PATCH_SIZE = 224;
const CAMELYON_MAX_ROI = 4480;

function isCamelyonAnalysis(analysis) {
  return analysis?.feature_code === CAMELYON_FEATURE_CODE
    || analysis?.summary?.feature_code === CAMELYON_FEATURE_CODE
    || /pathology_tumor_detection/i.test(String(analysis?.model_name ?? ''));
}

function calcCamelyonPatches(width, height) {
  return Math.floor(width / CAMELYON_PATCH_SIZE)
    * Math.floor(height / CAMELYON_PATCH_SIZE);
}

function calcKongnetTiles(w, h, sourceMpp = 0.25) {
  if (!(w > 0 && h > 0 && sourceMpp > 0)) return null;
  const scaledW = Math.max(1, Math.ceil(w * sourceMpp / 0.25));
  const scaledH = Math.max(1, Math.ceil(h * sourceMpp / 0.25));
  const starts = (dim) => dim <= 512 ? 1 : Math.ceil((dim - 512) / 448) + 1;
  return starts(scaledW) * starts(scaledH);
}

function getCandidatePosition(detection) {
  const pt = detection?.center_level0 ?? detection?.centroid_level0 ?? detection?.level0;
  const x = pt?.x ?? (Array.isArray(pt) ? pt[0] : undefined)
    ?? detection?.slide_x ?? detection?.x_level0 ?? detection?.center_x ?? detection?.x;
  const y = pt?.y ?? (Array.isArray(pt) ? pt[1] : undefined)
    ?? detection?.slide_y ?? detection?.y_level0 ?? detection?.center_y ?? detection?.y;
  return x != null && y != null && Number.isFinite(Number(x)) && Number.isFinite(Number(y))
    ? { x: Number(x), y: Number(y) } : null;
}

function calcHovernetPatches(w, h) {
  if (!w || !h || w <= 0 || h <= 0) return 0;
  const nw = Math.max(1, Math.ceil((w - 164) / 164) + 1);
  const nh = Math.max(1, Math.ceil((h - 164) / 164) + 1);
  return nw * nh;
}

// ── PanNuke 6-class colour palette ──────────────────────────────────────────
// ── PanNuke 6-class colour palette (synchronized with Project A HoVer-Net) ──
export const PANNUKE_CLASSES = [
  { key: 'Neoplastic',    label: 'Neoplastic',     color: '#E53935', typeId: 1 },
  { key: 'Inflammatory',  label: 'Inflammatory',   color: '#FFB400', typeId: 2 },
  { key: 'Connective',    label: 'Connective',     color: '#28A745', typeId: 3 },
  { key: 'Necrotic',      label: 'Necrotic',       color: '#BA55D3', typeId: 4 },
  { key: 'Non-neoplastic',label: 'Non-neoplastic', color: '#009AD6', typeId: 5 },
  { key: 'No label',      label: 'No label',       color: '#B4B4B4', typeId: 0 },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function pct(count, total) {
  if (!total) return '0.0%';
  return `${((count / total) * 100).toFixed(1)}%`;
}

function fmtConf(raw) {
  if (raw == null) return '—';
  return `${(raw * 100).toFixed(1)}%`;
}

function fmtNum(v, decimals = 1) {
  if (v == null) return '—';
  return Number(v).toFixed(decimals);
}

function fmtDensity(v) {
  if (v == null) return '—';
  return `${Number(v).toFixed(0)} /mm²`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ClassTable({ breakdown, totalNuclei, hiddenClasses, onToggleClass }) {
  if (!breakdown || !Object.keys(breakdown).length) return null;
  return (
    <div className="ai-class-section">
      <div className="ai-class-section-heading">
        <h4>PanNuke class breakdown</h4>
      </div>
      <table className="ai-class-table" aria-label="Nucleus class breakdown">
        <thead>
          <tr>
            <th>Class</th>
            <th>N</th>
            <th>%</th>
            <th aria-label="Distribution" className="ai-class-bar-cell" />
            <th aria-label="Toggle visibility" />
          </tr>
        </thead>
        <tbody>
          {PANNUKE_CLASSES.map(({ key, label, color }) => {
            const count = breakdown[key] ?? breakdown[label] ?? (key === 'Necrotic' ? (breakdown['Dead'] ?? 0) : 0) ?? (key === 'Non-neoplastic' ? (breakdown['Epithelial'] ?? 0) : 0) ?? (key === 'No label' ? (breakdown['No Label'] ?? 0) : 0) ?? 0;
            const hidden = hiddenClasses.has(key);
            const widthPct = totalNuclei ? Math.round((count / totalNuclei) * 100) : 0;
            return (
              <tr key={key} className={`ai-class-row${hidden ? ' ai-class-row--hidden' : ''}`}>
                <td>
                  <span className="ai-class-chip">
                    <span className="ai-class-swatch" style={{ background: color }} aria-hidden="true" />
                    {label}
                  </span>
                </td>
                <td>{count}</td>
                <td className="ai-class-pct">{pct(count, totalNuclei)}</td>
                <td className="ai-class-bar-cell">
                  <div className="ai-class-bar-track" aria-hidden="true">
                    <div
                      className="ai-class-bar-fill"
                      style={{ width: `${widthPct}%`, background: color }}
                    />
                  </div>
                </td>
                <td>
                  <button
                    type="button"
                    className={`ai-toggle-btn${hidden ? ' ai-toggle-btn--hidden' : ''}`}
                    title={hidden ? `Show ${label}` : `Hide ${label}`}
                    aria-pressed={!hidden}
                    onClick={() => onToggleClass(key)}
                    aria-label={`Toggle ${label} overlay`}
                  >
                    {hidden ? '·' : '✓'}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MorphologyMetrics({ morphology, density }) {
  if (!morphology) return null;
  const items = [
    { label: 'Median area',        value: `${fmtNum(morphology.area_median ?? morphology.median_area_pixels)} px²` },
    { label: 'Median perimeter',   value: `${fmtNum(morphology.perimeter_median ?? morphology.mean_perimeter_pixels)} px` },
    { label: 'Median circularity', value: fmtNum(morphology.circularity_median ?? morphology.mean_circularity, 3) },
    { label: 'Median aspect ratio',value: fmtNum(morphology.aspect_ratio_median ?? morphology.mean_aspect_ratio, 3) },
    { label: 'Nuclear density',    value: fmtDensity(density) },
    { label: 'Total detected',     value: morphology.total_nuclei ?? '—' },
  ];
  return (
    <div className="ai-morph-section">
      <h4>Morphology metrics</h4>
      <div className="ai-morph-grid">
        {items.map(({ label, value }) => (
          <div key={label} className="ai-morph-item">
            <span className="ai-morph-label">{label}</span>
            <span className="ai-morph-value">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NucleusDetail({ nucleus, onClose }) {
  if (!nucleus) return null;
  const cls = PANNUKE_CLASSES.find((c) => c.key === nucleus.type || c.typeId === nucleus.type_id || c.label === nucleus.type) || { color: nucleus.color || '#94a3b8', label: nucleus.type };
  return (
    <div className="ai-nucleus-detail" role="region" aria-label="Selected nucleus detail">
      <div className="ai-nucleus-detail-header">
        <strong>
          <span className="ai-class-swatch" style={{ background: cls.color, display: 'inline-block', marginRight: 6 }} aria-hidden="true" />
          {cls.label}
        </strong>
        <button type="button" className="ai-nucleus-detail-close" onClick={onClose} aria-label="Close nucleus detail">
          <X size={13} />
        </button>
      </div>
      <dl className="ai-nucleus-detail-rows">
        <dt>Nucleus ID</dt><dd>#{nucleus.id}</dd>
        <dt>Confidence</dt><dd>{fmtConf(nucleus.type_prob)}</dd>
        <dt>Area</dt><dd>{fmtNum(nucleus.area, 1)} px²</dd>
        <dt>Circularity</dt><dd>{fmtNum(nucleus.circularity, 3)}</dd>
        <dt>Aspect ratio</dt><dd>{fmtNum(nucleus.aspect_ratio, 3)}</dd>
        <dt>Centroid</dt><dd>({fmtNum(nucleus.centroid?.[0], 0)}, {fmtNum(nucleus.centroid?.[1], 0)})</dd>
      </dl>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AiAnalysisPanel({
  slide,
  roiRect,          // { x, y, width, height } in image coords – null if not selected
  onAnalysisReady,  // callback(analysis) — called when a result arrives
  onError,
  hiddenClasses: externalHiddenClasses,
  onToggleClass: externalOnToggleClass,
  selectedNucleus: externalSelectedNucleus,
  onSelectNucleus: externalOnSelectNucleus,
  onPanToRoi,
  onSelectMitoticCandidate,
  selectedMitoticCandidate,
  sourceMpp,
  onQcAnalysisChange,
  onQcFeatureActiveChange,
  qcClasses = [],
  qcVisible = true,
  onToggleQcVisible,
  qcHiddenClasses = new Set(),
  onToggleQcClass,
}) {
  const [open, setOpen] = useState(true);
  const [entitlements, setEntitlements] = useState(null);
  const [selectedFeatureCode, setSelectedFeatureCode] = useState('');
  const [running, setRunning] = useState(false);
  const [qcJob, setQcJob] = useState(null);
  const [qcResult, setQcResult] = useState(null);
  const [qcHistory, setQcHistory] = useState([]);
  const qcLoadSeqRef = useRef(0);
  const [qcError, setQcError] = useState('');
  const qcPollRef = useRef(null);
  const [activeJob, setActiveJob] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [analyses, setAnalyses] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);   // full analysis record
  const [internalHiddenClasses, setInternalHiddenClasses] = useState(new Set());
  const [internalSelectedNucleus, setInternalSelectedNucleus] = useState(null);
  const [pendingConfirmation, setPendingConfirmation] = useState(null);
  const [retryRequest, setRetryRequest] = useState(null);
  const [completionNotice, setCompletionNotice] = useState('');
  const [showAccessDetails, setShowAccessDetails] = useState(false);
  const [unavailableFeature, setUnavailableFeature] = useState(null);
  const abortRef = useRef(null);
  const pollTimerRef = useRef(null);

  const hiddenClasses = externalHiddenClasses ?? internalHiddenClasses;
  const selectedNucleus = externalSelectedNucleus !== undefined ? externalSelectedNucleus : internalSelectedNucleus;

  const setSelectedNucleus = useCallback((nuc) => {
    setInternalSelectedNucleus(nuc);
    externalOnSelectNucleus?.(nuc);
  }, [externalOnSelectNucleus]);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
      if (qcPollRef.current) clearInterval(qcPollRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [stopPolling]);

  useEffect(() => {
    const controller = new AbortController();
    aiSubscriptionService.entitlements(controller.signal)
      .then((data) => {
        setEntitlements(data);
        const available = (data?.features || []).filter((feature) => (
          feature.is_entitled && feature.is_active && feature.is_implemented && feature.user_enabled
        ));
        setSelectedFeatureCode((current) => available.some((feature) => feature.feature_code === current)
          ? current : (available[0]?.feature_code || ''));
      })
      .catch((error) => { if (error.name !== 'AbortError') setEntitlements({ effective_feature_codes: [] }); });
    return () => controller.abort();
  }, []);

  const showSavedQc = useCallback(async (id, signal) => {
    const sequence = ++qcLoadSeqRef.current;
    try {
      const data = await grandqcService.detail(id, signal);
      if (sequence !== qcLoadSeqRef.current || signal?.aborted) return;
      setQcResult(data);
      setQcError('');
      onQcAnalysisChange?.(data);
    } catch (error) {
      if (error.name !== 'AbortError' && sequence === qcLoadSeqRef.current) {
        setQcError(`Could not load saved GrandQC analysis: ${error.message}`);
      }
    }
  }, [onQcAnalysisChange]);

  const loadQcHistory = useCallback(async (signal) => {
    try {
      const response = await grandqcService.list(slide.id, signal);
      const records = Array.isArray(response) ? response : response?.analyses || response?.items || [];
      if (signal?.aborted) return;
      const complete = records.filter((row) => String(row.status || '').toLowerCase() === 'completed');
      setQcHistory(complete);
      if (complete[0]?.id) await showSavedQc(complete[0].id, signal);
    } catch (error) {
      if (error.name !== 'AbortError') setQcError(`Could not load GrandQC history: ${error.message}`);
    }
  }, [slide.id, showSavedQc]);

  // ── Load analysis history on mount / slide change ───────────────────────
  const loadHistory = useCallback(async () => {
    try {
      const list = await viewerService.getAiAnalyses(slide.id);
      setAnalyses(list);
    } catch {
      /* history unavailable — non-fatal */
    }
  }, [slide.id]);

  useEffect(() => {
    stopPolling();
    if (qcPollRef.current) clearInterval(qcPollRef.current);
    qcPollRef.current = null;
    setQcJob(null);
    setQcResult(null);
    setQcHistory([]);
    qcLoadSeqRef.current += 1;
    onQcAnalysisChange?.(null);
    setQcError('');
    if (abortRef.current) abortRef.current.abort();
    setRunning(false);
    setActiveJob(null);
    setAnalyses([]);
    setSelectedId(null);
    setDetail(null);
    setSelectedNucleus(null);
    loadHistory();
    const qcController = new AbortController();
    loadQcHistory(qcController.signal);
    return () => qcController.abort();
  }, [slide.id, stopPolling, loadHistory, loadQcHistory]);

  const startPollingJob = useCallback((jobId, autoTissue, featureCode) => {
    stopPolling();
    const poll = async () => {
      try {
        const job = await viewerService.getAiJobStatus(jobId);
        setActiveJob(job);
        if (job.status === 'completed') {
          stopPolling();
          setRunning(false);
          setActiveJob(null);
          const result = job.result;
          if (result) {
            setDetail(result);
            setSelectedId(result.id);
            setAnalyses((prev) => [result, ...prev.filter((a) => a.id !== result.id)]);
            onAnalysisReady?.(result);
            if (result.roi) onPanToRoi?.(result.roi);
            setCompletionNotice('AI analysis completed. Results are ready to review.');
          }
        } else if (job.status === 'failed' || job.status === 'timeout') {
          stopPolling();
          setRunning(false);
          setActiveJob(null);
          setRetryRequest({ autoTissue, featureCode });
          onError?.(job.error || 'AI analysis failed');
        } else if (job.status === 'cancelled') {
          stopPolling();
          setRunning(false);
          setActiveJob(null);
          onError?.('AI analysis was cancelled.');
        }
      } catch (err) {
        console.warn('Polling error:', err);
      }
    };

    pollTimerRef.current = setInterval(poll, 1000);
    poll();
  }, [onAnalysisReady, onError, onPanToRoi, stopPolling]);

  const handleCancelJob = useCallback(async () => {
    if (activeJob?.id || activeJob?.job_id) {
      const jid = activeJob.id || activeJob.job_id;
      setCancelling(true);
      try {
        await viewerService.cancelAiJob(jid);
      } catch (err) {
        console.warn('Cancel failed:', err);
      } finally {
        setCancelling(false);
        stopPolling();
        setRunning(false);
        setActiveJob(null);
      }
    } else {
      if (abortRef.current) abortRef.current.abort();
      setRunning(false);
    }
  }, [activeJob, stopPolling]);

  // ── Run AI analysis ───────────────────────────────────────────────────────
  const runAnalysis = useCallback(async (autoTissue = false, featureCode = selectedFeatureCode) => {
    if (running || !['HOVERNET', 'MITOTIC_DETECTION', CAMELYON_FEATURE_CODE].includes(featureCode) ||
        !(entitlements?.features || []).some((feature) =>
          feature.feature_code === featureCode &&
          feature.is_entitled && feature.is_active &&
          feature.is_implemented && feature.user_enabled
        )) return;
    setSelectedFeatureCode(featureCode);
    setRunning(true);
    setActiveJob(null);
    setSelectedNucleus(null);
    // Clear previously displayed analysis immediately so old contours are not mistaken for the new run
    onAnalysisReady?.(null);
    setDetail(null);

    abortRef.current = new AbortController();
    try {
      const freshEntitlements = await aiSubscriptionService.entitlements(abortRef.current.signal);
      setEntitlements(freshEntitlements);
      if (!freshEntitlements?.effective_feature_codes?.includes(featureCode)) {
        throw new Error('This AI feature is no longer available to your account.');
      }
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err.message || 'Could not verify AI feature access.');
      setRunning(false);
      abortRef.current = null;
      return;
    }
    if (featureCode === CAMELYON_FEATURE_CODE && !autoTissue) {
      if (!roiRect) {
        onError?.('CAMELYON requires a manually selected ROI.');
        setRunning(false);
        abortRef.current = null;
        return;
      }

      const x = Math.floor(roiRect.x);
      const y = Math.floor(roiRect.y);
      const width = Math.floor(roiRect.width);
      const height = Math.floor(roiRect.height);

      const slideWidth = Number(slide.width);
      const slideHeight = Number(slide.height);

      if (
        ![x, y, width, height].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        width < 224 ||
        height < 224 ||
        width > 4480 ||
        height > 4480 ||
        !Number.isFinite(slideWidth) ||
        !Number.isFinite(slideHeight) ||
        x + width > slideWidth ||
        y + height > slideHeight
      ) {
        onError?.('CAMELYON ROI must be within the slide and between 224 and 4480 pixels per dimension.');
        setRunning(false);
        abortRef.current = null;
        return;
      }
    }
    const payload = featureCode === CAMELYON_FEATURE_CODE
      ? (autoTissue
        ? {
            feature_code: CAMELYON_FEATURE_CODE,
            auto_tissue: true,
            level: 0,
            run_in_background: true,
          }
        : {
            feature_code: CAMELYON_FEATURE_CODE,
            x: Math.floor(roiRect.x),
            y: Math.floor(roiRect.y),
            width: Math.floor(roiRect.width),
            height: Math.floor(roiRect.height),
            level: 0,
            auto_tissue: false,
            run_in_background: true,
          })
      : autoTissue
        ? { feature_code: featureCode, auto_tissue: true }
        : roiRect
        ? {
            feature_code: featureCode,
            x: Math.round(roiRect.x),
            y: Math.round(roiRect.y),
            width: Math.round(roiRect.width),
            height: Math.round(roiRect.height),
            roi_x: Math.round(roiRect.x),
            roi_y: Math.round(roiRect.y),
            roi_width: Math.round(roiRect.width),
            roi_height: Math.round(roiRect.height),
          }
        : { feature_code: featureCode, auto_tissue: true };

    try {
      const result = await viewerService.runAiAnalysis(slide.id, payload, abortRef.current.signal);
      if (result && result.job_id && (result.status === 'processing' || result.status === 'queued')) {
        // Dispatched as background job (large ROI)
        setActiveJob({
          id: result.job_id,
          job_id: result.job_id,
          status: result.status,
          progress: result.progress || {
            current: 0,
            total: result.estimated_patches || 0,
            percentage: 0,
            elapsed_seconds: 0,
            remaining_seconds: result.estimated_duration_seconds || null,
            stage: 'Started inference worker...',
          },
        });
        startPollingJob(result.job_id, autoTissue, featureCode);
      } else if (result) {
        // Completed synchronously (small ROI)
        setDetail(result);
        setSelectedId(result.id);
        setAnalyses((prev) => [result, ...prev.filter((a) => a.id !== result.id)]);
        onAnalysisReady?.(result);
        if (result.roi) onPanToRoi?.(result.roi);
        setCompletionNotice('AI analysis completed. Results are ready to review.');
        setRunning(false);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setRetryRequest({ autoTissue, featureCode });
        onError?.(`AI analysis failed: ${err.message}`);
      }
      setRunning(false);
    } finally {
      abortRef.current = null;
    }
  }, [running, selectedFeatureCode, entitlements, roiRect, slide.id, slide.width, slide.height, onAnalysisReady, onError, onPanToRoi, startPollingJob]);

  // GrandQC analyzes the complete slide, independent of the ROI-based AI API.
  const startGrandQc = useCallback(async () => {
    if (running || !slide?.id || selectedFeatureCode !== 'SLIDE_QUALITY_CONTROL') return;
    const permitted = (entitlements?.features || []).some((feature) =>
      feature.feature_code === 'SLIDE_QUALITY_CONTROL' && feature.is_entitled &&
      feature.is_active && feature.is_implemented && feature.user_enabled
    );
    if (!permitted) { onError?.('GrandQC access is unavailable.'); return; }
    setRunning(true);
    setQcError('');
    qcLoadSeqRef.current += 1;
    setQcResult(null);
    onQcAnalysisChange?.(null);
    setQcJob(null);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/slides/${slide.id}/qc/analyses`, { method: 'POST' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not start GrandQC');
      const jobId = body.job_id || body.id;
      if (!jobId) throw new Error('GrandQC response has no job ID. Check the backend response schema.');
      setQcJob({ job_id: jobId, status: body.status || 'queued', progress: body.progress });
      if (qcPollRef.current) clearInterval(qcPollRef.current);
      let polling = false;
      const poll = async () => {
        if (polling) return;
        polling = true;
        try {
          const statusResponse = await apiFetch(`${API_BASE_URL}/api/qc/jobs/${encodeURIComponent(jobId)}`);
          const job = await statusResponse.json().catch(() => ({}));
          if (!statusResponse.ok) throw new Error(typeof job.detail === 'string' ? job.detail : 'Unable to retrieve GrandQC job');
          setQcJob(job);
          const status = String(job.status || '').toLowerCase();
          if (['completed', 'failed', 'cancelled', 'canceled'].includes(status)) {
            clearInterval(qcPollRef.current);
            qcPollRef.current = null;
            setRunning(false);
            if (status === 'completed') {
              const analysisId = job.analysis_id || job.result?.analysis_id || job.result?.id;
              if (analysisId) {
                const resultResponse = await apiFetch(`${API_BASE_URL}/api/qc/analyses/${analysisId}`);
                const resultBody = await resultResponse.json().catch(() => ({}));
                if (!resultResponse.ok) throw new Error(typeof resultBody.detail === 'string' ? resultBody.detail : 'Unable to retrieve GrandQC results');
                setQcResult(resultBody);
                onQcAnalysisChange?.(resultBody);
                grandqcService.list(slide.id).then((items) => {
                  const records = Array.isArray(items) ? items : items?.analyses || items?.items || [];
                  setQcHistory(records.filter((row) => String(row.status || '').toLowerCase() === 'completed'));
                }).catch(() => {});
              } else {
                setQcResult(job.result || job);
                onQcAnalysisChange?.(null);
              }
              setCompletionNotice('GrandQC whole-slide analysis completed.');
            } else {
              const message = job.error || `GrandQC job ${status}.`;
              setQcError(message);
              onError?.(message);
            }
          }
        } catch (error) {
          setQcError(error.message);
          // Keep polling after transient network errors; the job may still be running.
        } finally { polling = false; }
      };
      qcPollRef.current = setInterval(poll, 3000);
      poll();
    } catch (error) {
      setRunning(false);
      setQcError(error.message);
      onError?.(error.message);
    }
  }, [running, slide?.id, selectedFeatureCode, entitlements, onError, onQcAnalysisChange]);

  const cancelGrandQc = useCallback(async () => {
    const jobId = qcJob?.job_id || qcJob?.id;
    if (!jobId) return;
    setCancelling(true);
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/qc/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || 'Could not cancel GrandQC');
      }
      if (qcPollRef.current) clearInterval(qcPollRef.current);
      qcPollRef.current = null;
      setRunning(false);
      setQcJob((current) => ({ ...current, status: 'cancelled' }));
    } catch (error) { onError?.(error.message); }
    finally { setCancelling(false); }
  }, [qcJob, onError]);

  // ── PDF actions ───────────────────────────────────────────────────────────
  const handleDownloadPdf = useCallback(async () => {
    if (!detail?.id || downloadingPdf) return;
    setDownloadingPdf(true);
    try {
      await viewerService.downloadAiReportPdf(detail.id);
    } catch (err) {
      onError?.(`PDF download failed: ${err.message}`);
    } finally {
      setDownloadingPdf(false);
    }
  }, [detail?.id, downloadingPdf, onError]);

  const handleGenerateReport = useCallback(async () => {
    if (!detail?.id || generatingReport) return;
    setGeneratingReport(true);
    try {
      const res = await viewerService.generateAiReport(detail.id);
      if (res?.report_url) {
        setDetail((prev) => ({ ...prev, report_url: res.report_url }));
      }
      await viewerService.downloadAiReportPdf(detail.id);
    } catch (err) {
      onError?.(`Report generation failed: ${err.message}`);
    } finally {
      setGeneratingReport(false);
    }
  }, [detail?.id, generatingReport, onError]);

  // ── Switch to a past analysis ─────────────────────────────────────────────
  const selectAnalysis = useCallback(async (id) => {
    if (!id) {
      setSelectedId(null);
      setDetail(null);
      setSelectedNucleus(null);
      onAnalysisReady?.(null);
      return;
    }
    setSelectedId(Number(id));
    setSelectedNucleus(null);
    const cached = analyses.find((a) => a.id === Number(id));
    if (cached?.nuclei) {
      setDetail(cached);
      onAnalysisReady?.(cached);
      if (cached.roi) onPanToRoi?.(cached.roi);
      return;
    }
    try {
      const rec = await viewerService.getAiAnalysis(Number(id));
      setDetail(rec);
      setAnalyses((prev) => prev.map((a) => a.id === rec.id ? rec : a));
      onAnalysisReady?.(rec);
      if (rec.roi) onPanToRoi?.(rec.roi);
    } catch (err) {
      onError?.(`Could not load analysis: ${err.message}`);
    }
  }, [analyses, onAnalysisReady, onError, onPanToRoi]);

  const toggleClass = useCallback((key) => {
    if (externalOnToggleClass) {
      externalOnToggleClass(key);
    } else {
      setInternalHiddenClasses((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
    }
  }, [externalOnToggleClass]);

  // ── Derived data ──────────────────────────────────────────────────────────
  const breakdown = detail?.classification_breakdown ?? detail?.analysis?.classification_breakdown ?? null;
  const morphology = detail?.morphology ?? detail?.analysis?.morphology ?? null;
  const density = detail?.nuclear_density ?? detail?.analysis?.nuclear_density_per_mm2 ?? null;
  const confidence = detail?.confidence_summary ?? (detail?.confidence_statistics?.overall) ?? null;
  const isMitotic = isKongNetAnalysis(detail);
  const isKongNetSelected = selectedFeatureCode === 'MITOTIC_DETECTION';
  const isCamelyonSelected = selectedFeatureCode === CAMELYON_FEATURE_CODE;
  const isCamelyonResult = isCamelyonAnalysis(detail);
  const isGrandQcSelected = selectedFeatureCode === 'SLIDE_QUALITY_CONTROL';
  useEffect(() => {
    onQcFeatureActiveChange?.(isGrandQcSelected);
    return () => onQcFeatureActiveChange?.(false);
  }, [isGrandQcSelected, onQcFeatureActiveChange]);
  const detections = detail?.detections ?? detail?.predictions?.detections ?? [];
  const mitoticGallery = detail?.candidate_gallery ?? detail?.gallery ?? {};
  const candidateImages = Array.isArray(mitoticGallery) ? mitoticGallery : (mitoticGallery?.items ?? []);
  const mitoticCount = detail?.candidate_count ?? detections.length;
  const mitoticDensity = detail?.candidate_density_per_mm2 ?? detail?.summary?.candidate_density_per_mm2;
  const mitoticMeanScore = detail?.mean_score ?? detail?.confidence_summary?.mean;
  const totalNuclei = detail?.total_nuclei ?? detail?.analysis?.total_nuclei ?? detail?.counts?.total ?? 0;
  const hasResults = Boolean(
    detail && (
      (isMitotic ? mitoticCount : totalNuclei) > 0 ||
      String(detail.status || '').toLowerCase() === 'completed'
    )
  );
  const elapsedSec = detail?.elapsed_seconds ?? detail?.inference_duration ?? null;
  const availableFeatures = (entitlements?.features || []).filter((feature) => (
    feature.is_entitled && feature.is_active && feature.is_implemented && feature.user_enabled
  ));
  const selectedFeature = availableFeatures.find((feature) => feature.feature_code === selectedFeatureCode);
  const canRunSelectedFeature = [
    'HOVERNET',
    'MITOTIC_DETECTION',
    CAMELYON_FEATURE_CODE,
  ].includes(selectedFeatureCode) && Boolean(selectedFeature);
  const accessDetail = !entitlements?.features?.length
    ? 'Your AI access could not be loaded.'
    : entitlements.features.every((feature) => !feature.is_entitled)
      ? 'Your account does not have an active subscription or feature grant.'
      : entitlements.features.every((feature) => !feature.user_enabled)
        ? 'Your available AI features are turned off in your preferences.'
        : entitlements.features.every((feature) => !feature.is_active)
          ? 'AI features are currently disabled by an administrator.'
          : 'No executable AI features are currently available.';

  if (entitlements && !availableFeatures.length) {
    return (
      <section className="ai-panel" aria-label="AI analysis">
        <div className="ai-panel-header">
          <div className="ai-panel-header-left">
            <Activity size={15} aria-hidden="true" />
            <p className="ai-panel-title">AI Analysis</p>
          </div>
        </div>
        <p className="ai-access-empty" role="status">
          No AI features are available for your account. Contact an administrator.
          <button type="button" className="ai-access-details-button" onClick={() => setShowAccessDetails((value) => !value)} aria-expanded={showAccessDetails}>
            {showAccessDetails ? 'Hide details' : 'Why unavailable?'}
          </button>
          {showAccessDetails && <span className="ai-access-empty__detail">{accessDetail}</span>}
        </p>
      </section>
    );
  }

  if (!entitlements) return null;

  return (
    <section className="ai-panel" aria-label="AI analysis">

      {/* ── Header / toggle ───────────────────────────────────────── */}
      <div
        className="ai-panel-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpen((v) => !v)}
      >
        <div className="ai-panel-header-left">
          <Activity size={15} aria-hidden="true" />
          <div>
            <p className="ai-panel-title">AI Analysis</p>
            {hasResults && (
              <p className="ai-panel-subtitle">{isCamelyonResult
                ? `${detail.patch_count ?? detail.summary?.patch_count ?? '—'} patches · CAMELYON`
                : isMitotic
                  ? `${mitoticCount} mitotic candidates · KongNet-Det`
                  : `${totalNuclei} nuclei · ${detail?.model_name || 'HoVer-Net'}`}</p>
            )}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={`ai-panel-chevron${open ? ' ai-panel-chevron--open' : ''}`}
          aria-hidden="true"
        />
      </div>

      {open && (
        <>
          {/* ── Research-use disclaimer ───────────────────────────── */}
          <p className="ai-disclaimer" role="note">
            <AlertTriangle size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Research Use Only — Not for Clinical Diagnosis
          </p>

          <div className="ai-feature-selector">
            <p className="ai-feature-selector__label">AI features on this slide</p>
            <div className="ai-feature-list">
              {availableFeatures.map((feature) => {
                const executable = ['HOVERNET', 'MITOTIC_DETECTION', 'SLIDE_QUALITY_CONTROL'].includes(feature.feature_code);
                const saved = analyses.find((item) => (item.feature_code || (isKongNetAnalysis(item) ? 'MITOTIC_DETECTION' : 'HOVERNET')) === feature.feature_code);
                const viewing = detail?.id === saved?.id;
                const featureTitle = feature.catalog_title || feature.feature_name;
                const featureSummary = feature.catalog_summary || feature.description;
                return (
                  <div className={`ai-feature-list__item${selectedFeatureCode === feature.feature_code ? ' is-selected' : ''}`} key={feature.feature_code}>
                    <div>
                      <strong>{featureTitle}</strong>
                      <span>{!executable ? 'Cannot run in the viewer' : saved ? (viewing ? 'Showing on slide' : 'Saved on this slide') : 'Not run on this slide'}</span>
                      {featureSummary && <p className="ai-feature-list__tip" role="tooltip">{featureSummary}</p>}
                    </div>
                    <div className="ai-feature-list__actions">
                      {saved && (
                        <button type="button" onClick={() => selectAnalysis(saved.id)} disabled={running || viewing}>Show</button>
                      )}
                      <button type="button" onClick={() => { if (!executable) { setUnavailableFeature(featureTitle); return; } setSelectedFeatureCode(feature.feature_code); }} disabled={running} aria-pressed={selectedFeatureCode === feature.feature_code}>
                        {selectedFeatureCode === feature.feature_code ? 'Selected' : 'Use'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="ai-feature-selector__description">This slide can run HoVer-Net, KongNet, and GrandQC. HoVer-Net and KongNet results stay saved. Camelyon does not run by adding another slide.</p>
          </div>

          {completionNotice && <p className="ai-completion-notice" role="status">{completionNotice}</p>}

          {/* ── Status / Progress ───────────────────────────────── */}
          {running && (
            <div className="ai-progress-card" role="status" aria-live="polite">
              <div className="ai-progress-header">
                <div className="ai-progress-title-row">
                  <Loader2 size={13} className="spin ai-progress-spinner" aria-hidden="true" />
                  <span className="ai-progress-stage">
                    {(isGrandQcSelected ? qcJob?.progress?.stage : activeJob?.progress?.stage) || (isGrandQcSelected ? 'Running GrandQC whole-slide analysis…' : isKongNetSelected ? 'Running KongNet inference…' : 'Running HoVer-Net inference…')}
                  </span>
                </div>
                <button
                  id="ai-cancel-job-btn"
                  type="button"
                  className="ai-progress-cancel-btn"
                  onClick={isGrandQcSelected ? cancelGrandQc : handleCancelJob}
                  disabled={cancelling}
                  title="Cancel AI analysis"
                  aria-label="Cancel AI analysis"
                >
                  <StopCircle size={13} aria-hidden="true" />
                  <span>{cancelling ? 'Cancelling…' : 'Cancel'}</span>
                </button>
              </div>

              {!isGrandQcSelected && activeJob?.progress && (
                <>
                  <div className="ai-progress-bar-track" aria-hidden="true">
                    <div
                      className="ai-progress-bar-fill"
                      style={{ width: `${Math.min(100, Math.max(0, activeJob.progress.percentage || 0))}%` }}
                    />
                  </div>

                  <div className="ai-progress-metrics">
                    <span className="ai-progress-patches">
                      {activeJob.progress.total > 0
                        ? `Patches: ${activeJob.progress.current} / ${activeJob.progress.total} (${activeJob.progress.percentage || 0}%)`
                        : 'Starting patch pipeline…'}
                    </span>
                    <span className="ai-progress-times">
                      {activeJob.progress.elapsed_seconds != null && (
                        <span>Elapsed: {formatDuration(activeJob.progress.elapsed_seconds)}</span>
                      )}
                      {activeJob.progress.remaining_seconds != null && activeJob.progress.remaining_seconds > 0 && (
                        <span> · Rem: ~{formatDuration(activeJob.progress.remaining_seconds)}</span>
                      )}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Run buttons ───────────────────────────────────────── */}
          {!running && (
            <div className="ai-actions">
              {pendingConfirmation && (
                <div className="ai-confirmation" role="alert">
                  <strong>Large analysis request</strong>
                  <span>{pendingConfirmation.patches ?? 'Unknown number of'} {isKongNetSelected ? 'tiles' : 'patches'}; estimated time {formatDuration(pendingConfirmation.estSec)}. This will run in the background.</span>
                  <div className="ai-confirmation__actions">
                    <button type="button" className="ai-action-btn ai-action-btn--secondary" onClick={() => setPendingConfirmation(null)}>Cancel</button>
                    <button type="button" className="ai-action-btn" onClick={() => { const request = pendingConfirmation; setPendingConfirmation(null); runAnalysis(request.autoTissue); }}>Start analysis</button>
                  </div>
                </div>
              )}
              {isGrandQcSelected ? (
                <>
                  <p className="ai-roi-prompt">GrandQC checks the entire slide. No ROI selection is required.</p>
                  <button id="ai-run-grandqc-btn" type="button" className="ai-action-btn"
                    disabled={!selectedFeature || !slide?.id} onClick={startGrandQc}>
                    <Play size={14} aria-hidden="true" /> Analyze Whole Slide
                  </button>
                </>
              ) : roiRect ? (() => {
                const w = Math.floor(roiRect.width);
                const h = Math.floor(roiRect.height);

                const patches = isCamelyonSelected
                  ? calcCamelyonPatches(w, h)
                  : isKongNetSelected
                    ? calcKongnetTiles(w, h, sourceMpp)
                    : calcHovernetPatches(w, h);

                const isTooLarge = isCamelyonSelected
                  ? w > CAMELYON_MAX_ROI || h > CAMELYON_MAX_ROI
                  : w > 8192 || h > 8192;

                const isTooSmall = isCamelyonSelected
                  ? w < CAMELYON_PATCH_SIZE || h < CAMELYON_PATCH_SIZE
                  : w < 32 || h < 32;

                const isOutOfBounds = isCamelyonSelected && (
                  Math.floor(roiRect.x) < 0 ||
                  Math.floor(roiRect.y) < 0 ||
                  Math.floor(roiRect.x) + w > Number(slide.width) ||
                  Math.floor(roiRect.y) + h > Number(slide.height)
                );

                const isLargeJob = isCamelyonSelected
                  ? true
                  : patches == null
                    ? true
                    : patches > (isKongNetSelected ? 16 : 25);

                const estSec = isCamelyonSelected || isKongNetSelected
                  ? null
                  : Math.round(patches * 2.8);

                return (
                  <>
                    <div className={`ai-roi-badge${isTooLarge || isTooSmall || isOutOfBounds ? ' ai-roi-badge--warning' : ''}`} role="status">
                      <div className="ai-roi-badge-title">
                        <span>Target: {roiRect.label || 'Selected Region'}</span>
                        <span>{w} × {h} px</span>
                      </div>
                      <div className="ai-roi-badge-coords">
                        Level-0 coordinates: ({Math.round(roiRect.x)}, {Math.round(roiRect.y)})
                      </div>
                      <div className="ai-roi-badge-meta">
                        <span className="ai-roi-badge-patches">
                          {patches == null ? 'Tile estimate requires slide MPP' : `${patches} ${isKongNetSelected ? (patches === 1 ? 'tile' : 'tiles') : (patches === 1 ? 'patch' : 'patches')}`}
                        </span>
                        <span className="ai-roi-badge-time">
                          {estSec == null ? 'Duration not estimated' : `~${formatDuration(estSec)}`} ({isLargeJob ? 'Background Job' : 'Fast Analysis'})
                        </span>
                      </div>
                      {isTooLarge && (
                        <div className="ai-roi-badge-error">
                          {isCamelyonSelected
                            ? 'ROI exceeds the CAMELYON maximum of 4,480 px per dimension. Please crop a smaller region.'
                            : 'ROI exceeds maximum dimension of 8,192 px. Please crop a smaller region.'}
                        </div>
                      )}
                      {isTooSmall && (
                        <div className="ai-roi-badge-error">
                          {isCamelyonSelected
                            ? 'ROI is smaller than the CAMELYON minimum of 224 px per dimension.'
                            : 'ROI is smaller than minimum dimension of 32 px.'}
                        </div>
                      )}
                      {isOutOfBounds && (
                        <div className="ai-roi-badge-error">
                          CAMELYON ROI must stay inside the slide bounds.
                        </div>
                      )}
                    </div>
                    <button
                      id="ai-run-roi-btn"
                      type="button"
                      className="ai-action-btn"
                      onClick={() => isLargeJob ? setPendingConfirmation({ autoTissue: false, patches, estSec }) : runAnalysis(false)}
                      disabled={isTooLarge || isTooSmall || isOutOfBounds || !canRunSelectedFeature}
                      aria-label={`Analyze selected ROI with ${selectedFeature?.feature_name || 'the selected AI feature'}`}
                    >
                      <Play size={14} aria-hidden="true" />
                      Analyze Selected ROI
                    </button>
                  </>
                );
              })() : (
                <p className="ai-roi-prompt">
                  Draw or select a rectangle, circle, or pen region to define the analysis area.
                </p>
              )}
              {!isGrandQcSelected && <button
                id="ai-auto-detect-btn"
                type="button"
                className="ai-action-btn ai-action-btn--secondary"
                onClick={() => runAnalysis(true)}
                disabled={!canRunSelectedFeature}
                aria-label={`Auto-detect tissue and analyze with ${selectedFeature?.feature_name || 'the selected AI feature'}`}
              >
                <Zap size={14} aria-hidden="true" />
                Auto-Detect &amp; Analyze
              </button>}
              {!isGrandQcSelected && retryRequest && (
                <button type="button" className="ai-action-btn ai-action-btn--secondary" onClick={() => runAnalysis(retryRequest.autoTissue, retryRequest.featureCode)}>
                  Retry last analysis
                </button>
              )}
            </div>
          )}

          {isGrandQcSelected && qcError && <p className="ai-roi-badge-error" role="alert">{qcError}</p>}
          {isGrandQcSelected && qcJob && <p className="ai-completion-notice" role="status">
            GrandQC job: {qcJob.status || 'queued'}
            {qcJob.progress?.stage ? ` · ${qcJob.progress.stage}` : ''}
            {qcJob.progress?.percentage != null ? ` · ${qcJob.progress.percentage}%` : ''}
          </p>}
          {isGrandQcSelected && qcResult && !running && (
            <section className="ai-class-section" aria-label="GrandQC results">
              <h4>GrandQC whole-slide results</h4>
              <p className="ai-feature-selector__description">Whole-slide QC analysis is complete. Review the artifact map and overlay for research purposes only.</p>
              {qcResult.id && <p>Analysis #{qcResult.id} · {qcResult.polygon_count ?? qcResult.result?.polygon_count ?? '—'} artifact polygons</p>}
              <div className="grandqc-summary">
                {qcHistory.length > 0 && <label>Saved QC analyses
                  <select className="grandqc-summary__history" value={qcResult?.id || ''}
                    onChange={(event) => showSavedQc(Number(event.target.value))}>
                    {qcHistory.map((row) => <option value={row.id} key={row.id}>
                      #{row.id} · {row.polygon_count ?? '—'} regions · {row.completed_at ? new Date(row.completed_at).toLocaleString() : 'Completed'}
                    </option>)}
                  </select>
                </label>}
                <div className="grandqc-summary__row">
                  <strong>Artifact polygons on slide</strong>
                  <button type="button" aria-pressed={qcVisible} onClick={onToggleQcVisible}>{qcVisible ? 'Hide' : 'Show'}</button>
                </div>
                {qcClasses.map(({ name, count }) => <div className="grandqc-summary__row" key={name}>
                  <button type="button" aria-pressed={!qcHiddenClasses.has(name)} onClick={() => onToggleQcClass?.(name)}>
                    <span className="grandqc-summary__swatch" style={{ backgroundColor: qcClassColor(name) }} />
                    {name} {qcHiddenClasses.has(name) ? '(hidden)' : ''}
                  </button><span>{count}</span>
                </div>)}
              </div>
              <div className="ai-actions">
                {qcResult.id && <a className="ai-action-btn ai-action-btn--secondary" href={`${API_BASE_URL}/api/qc/analyses/${qcResult.id}/overlay`} target="_blank" rel="noreferrer">View QC overlay</a>}
                {qcResult.id && <a className="ai-action-btn ai-action-btn--secondary" href={`${API_BASE_URL}/api/qc/analyses/${qcResult.id}/artifact-map`} target="_blank" rel="noreferrer">View artifact map</a>}
                {qcResult.id && <a className="ai-action-btn ai-action-btn--secondary" href={`${API_BASE_URL}/api/qc/analyses/${qcResult.id}/geojson`} target="_blank" rel="noreferrer">View GeoJSON</a>}
              </div>
            </section>
          )}

          {/* ── Summary stats ─────────────────────────────────────── */}
          {hasResults && !running && !isGrandQcSelected && (
            <>
              <div className="ai-panel-roi-header">
                <span className="ai-panel-subtitle">
                  {detail.roi ? `ROI: (${detail.roi.x}, ${detail.roi.y}) · ${detail.roi.width}×${detail.roi.height} px` : `Analysis #${detail.id}`}
                </span>
                <button
                  type="button"
                  className="ai-clear-btn"
                  onClick={() => {
                    onAnalysisReady?.(null);
                    setDetail(null);
                    setSelectedId(null);
                    setSelectedNucleus(null);
                  }}
                  title="Hide AI overlay"
                >
                  Clear overlay
                </button>
              </div>

              {isCamelyonResult ? (
                <>
                <div className="ai-stats-grid">
                  {[
                    ['Analysis mode', (detail.analysis_mode ?? detail.summary?.analysis_mode) === 'whole_slide' ? 'Whole slide' : 'Selected ROI'],
                    ['Analyzed patches', detail.patch_count ?? detail.summary?.patch_count ?? '—'],
                    ['Eligible tissue patches', detail.eligible_patch_count ?? detail.summary?.eligible_patch_count ?? '—'],
                    ['Tissue coverage', fmtNum(detail.coverage_fraction ?? detail.summary?.coverage_fraction, 2)],
                    ['Mean model score', fmtNum(detail.mean_score ?? detail.summary?.mean_score, 4)],
                    ['Minimum score', fmtNum(detail.min_score ?? detail.summary?.min_score, 4)],
                    ['Maximum score', fmtNum(detail.max_score ?? detail.summary?.max_score, 4)],
                    ['Execution time', formatDuration(detail.elapsed_seconds ?? detail.execution_time_seconds)],
                  ].map(([label, value]) => (
                    <div className="ai-stat-card" key={label}>
                      <span className="ai-stat-value">{value}</span>
                      <span className="ai-stat-label">{label}</span>
                    </div>
                  ))}
                </div>
                {(detail.partial_coverage ?? detail.summary?.partial_coverage) && (
                  <p className="ai-roi-badge-error">Partial coverage research run. Unanalyzed tissue is transparent on the heatmap and is not tumor-negative.</p>
                )}
                </>
              ) : isMitotic ? (
                <>
                  <div className="ai-stats-grid">
                    {[
                      ['Mitotic candidates', mitoticCount],
                      ['Candidate density', mitoticDensity == null ? '—' : `${Number(mitoticDensity).toFixed(1)} /mm²`],
                      ['Analyzed area', detail.analyzed_area_mm2 == null ? '—' : `${Number(detail.analyzed_area_mm2).toFixed(3)} mm²`],
                      ['Mean model score', mitoticMeanScore == null ? '—' : Number(mitoticMeanScore).toFixed(3)],
                      ['Detection threshold', detail.threshold == null ? '—' : Number(detail.threshold).toFixed(2)],
                      ['Execution time', detail.execution_time_seconds == null ? '—' : formatDuration(detail.execution_time_seconds)],
                    ].map(([label, value]) => (
                      <div className="ai-stat-card" key={label}>
                        <span className="ai-stat-value">{value}</span>
                        <span className="ai-stat-label">{label}</span>
                      </div>
                    ))}
                  </div>
                  <section className="ai-mitotic-section" aria-label="Mitotic candidate review">
                    <h4>Mitotic candidates ({detections.length})</h4>
                    <p className="ai-mitotic-hint">Raw, uncalibrated model scores. Select a candidate to locate it on the slide.</p>
                    {detections.length === 0 && <p className="ai-mitotic-hint">No mitotic candidates detected in this ROI.</p>}
                    <div className="ai-mitotic-list">
                      {detections.map((det, index) => {
                        const pos = getCandidatePosition(det);
                        const score = det.score ?? det.probability ?? det.confidence;
                        const crop = candidateImages.find(item => String(item.detection_id ?? item.id ?? item.det_id) === String(det.id)) ?? candidateImages[index];
                        const imageUrl = crop?.image_url;
                        const isSelected = selectedMitoticCandidate === det || (selectedMitoticCandidate?.id != null && selectedMitoticCandidate.id === det.id);
                        return (
                          <button type="button" key={det.id ?? index}
                            className={`ai-mitotic-item${isSelected ? ' ai-mitotic-item--selected' : ''}`}
                            onClick={() => onSelectMitoticCandidate?.(det)} disabled={!pos}>
                            {imageUrl ? <img className="ai-mitotic-crop" src={imageUrl.startsWith('/') ? `${API_BASE_URL}${imageUrl}` : imageUrl} alt={`Candidate ${index + 1}`} /> : <span className="ai-mitotic-placeholder">#{index + 1}</span>}
                            <span className="ai-mitotic-content"><strong>Candidate {det.id ?? index + 1}</strong><small>{pos ? `X ${Math.round(pos.x)} · Y ${Math.round(pos.y)}` : 'Coordinates unavailable'}</small><small>Model score: {score == null ? '—' : Number(score).toFixed(3)}</small></span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </>
              ) : (
                <>
              <div className="ai-stats-grid">
                <div className="ai-stat-card">
                  <span className="ai-stat-value">{totalNuclei}</span>
                  <span className="ai-stat-label">Total nuclei</span>
                </div>
                <div className="ai-stat-card">
                  <span className="ai-stat-value">{fmtDensity(density)}</span>
                  <span className="ai-stat-label">Density</span>
                </div>
                {confidence && (
                  <>
                    <div className="ai-stat-card">
                      <span className="ai-stat-value">{fmtConf(confidence.mean)}</span>
                      <span className="ai-stat-label">Mean conf.</span>
                    </div>
                    <div className="ai-stat-card">
                      <span className="ai-stat-value">{fmtConf(confidence.median)}</span>
                      <span className="ai-stat-label">Median conf.</span>
                    </div>
                  </>
                )}
                {elapsedSec != null && (
                  <div className="ai-stat-card">
                    <span className="ai-stat-value">{elapsedSec}s</span>
                    <span className="ai-stat-label">Inference time</span>
                  </div>
                )}
              </div>

              {/* ── Overlay image preview ─────────────────────────── */}
              <img
                className="ai-overlay-preview"
                src={viewerService.aiOverlayImageUrl(detail.id)}
                alt="AI nucleus overlay preview"
                crossOrigin="use-credentials"
                title="Click to zoom to analyzed ROI"
                onClick={() => {
                  if (detail.roi) onPanToRoi?.(detail.roi);
                }}
              />

              {/* ── Class breakdown table ─────────────────────────── */}
              <ClassTable
                breakdown={breakdown}
                totalNuclei={totalNuclei}
                hiddenClasses={hiddenClasses}
                onToggleClass={toggleClass}
              />

              {/* ── Morphology metrics ────────────────────────────── */}
              <MorphologyMetrics morphology={morphology} density={density} />

              {/* ── Selected nucleus detail ───────────────────────── */}
              {selectedNucleus && (
                <NucleusDetail
                  nucleus={selectedNucleus}
                  onClose={() => setSelectedNucleus(null)}
                />
              )}

                </>
              )}

              {/* ── PDF download and report actions ─────────────────── */}
              {!isCamelyonResult && (
              <div className="ai-actions ai-actions--reports">
                <button
                  id="ai-pdf-download-btn"
                  type="button"
                  className="ai-pdf-btn ai-pdf-btn--full"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  aria-label="Download AI analysis PDF report"
                >
                  {downloadingPdf ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
                  {downloadingPdf ? 'Downloading PDF…' : 'Download AI PDF'}
                </button>
                <button
                  id="ai-generate-report-btn"
                  type="button"
                  className="ai-action-btn ai-action-btn--secondary"
                  onClick={handleGenerateReport}
                  disabled={generatingReport}
                  aria-label="Generate fresh AI report"
                >
                  {generatingReport ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <RefreshCw size={14} aria-hidden="true" />}
                  {generatingReport ? 'Generating…' : 'Generate AI Report'}
                </button>
              </div>
              )}

              {/* ── Model info ────────────────────────────────────── */}
              <div className="ai-model-info">
                {isCamelyonResult
                  ? 'CAMELYON16 · MONAI pathology_tumor_detection · 224 × 224 patches'
                  : isMitotic
                    ? 'KongNet-Det · MIDOG mitotic candidate detection'
                    : 'HoVer-Net Fast · PanNuke weights · 256 × 256 patch'}
                {elapsedSec != null && ` · ${elapsedSec}s`}
                {detail.created_at && ` · ${new Date(detail.created_at).toLocaleString()}`}
              </div>
            </>
          )}

          {/* ── History switcher ──────────────────────────────────── */}
          {analyses.length > 1 && !running && !isGrandQcSelected && (
            <div className="ai-history-section">
              <h4>
                <RefreshCw size={12} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
                Past analyses
              </h4>
              <select
                id="ai-history-select"
                className="ai-history-select"
                value={selectedId ?? ''}
                onChange={(e) => selectAnalysis(e.target.value)}
                aria-label="Select past AI analysis"
              >
                {analyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {isCamelyonAnalysis(a)
                      ? `Camelyon · ${a.patch_count ?? a.summary?.patch_count ?? '?'} patches${(a.analysis_mode ?? a.summary?.analysis_mode) === 'whole_slide' ? ' · whole slide' : ''}`
                      : isKongNetAnalysis(a)
                        ? `KongNet · ${a.candidate_count ?? a.total_nuclei ?? '?'} candidates`
                        : `${a.model_name || 'HoVer-Net'} · ${a.total_nuclei ?? '?'} nuclei`} · {a.created_at ? new Date(a.created_at).toLocaleString() : `#${a.id}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </>
      )}
      <Modal open={Boolean(unavailableFeature)} title="This AI feature cannot run" onClose={() => setUnavailableFeature(null)} footer={<button type="button" className="modal-button modal-button--secondary" onClick={() => setUnavailableFeature(null)}>Close</button>}>
        <p>This slide can run HoVer-Net, KongNet-Det, and GrandQC. HoVer-Net and KongNet results stay saved. {unavailableFeature} is not connected to the viewer, so it cannot be started on any slide. Adding another slide does not run it.</p>
      </Modal>
    </section>
  );
}
