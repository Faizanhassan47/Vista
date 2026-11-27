import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { TotalSegmentatorPanel } from './TotalSegmentatorPanel';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';
import { aiSubscriptionService } from '../../services/aiSubscriptionService';
import { featureVisibleInWorkspace } from '../../modules/ai/aiListing';
import '../WsiViewer/AiAnalysisPanel.css';

export const RAD_AI_MODELS = [
  {
    id: 'neuromri',
    featureCode: 'NEUROMRI_SLICE_CLASSIFICATION',
    label: 'NeuroMRI EfficientNet-B0',
    hint: 'Classifies the active 2D MRI slice into dataset categories.',
  },
  {
    id: 'totalseg',
    featureCode: 'TOTALSEGMENTATOR',
    label: 'TotalSegmentator',
    hint: 'Anatomical structures on a verified CT or MRI volume.',
  },
];

export default function RadiologyAiPanel({
  slide,
  meta,
  viewMode,
  plane,
  index,
  mprCursor,
  result,
  busy,
  error,
  onRun,
  onVerified,
  onSegOverlay,
  onSegState,
}) {
  const [feature, setFeature] = useState('neuromri');
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [radModels, setRadModels] = useState(RAD_AI_MODELS);
  const [catalogByCode, setCatalogByCode] = useState({});
  const verifyAbort = useRef(null);

  const storedModality = String(meta?.calibration?.modality || '').toUpperCase();
  const dicomModality = slide?.file_type === 'dicom-stack' ? String(meta?.modality || '').toUpperCase() : '';
  const modality = storedModality || dicomModality;
  const isMr = modality === 'MR' || modality === 'MRI';
  const isCt = modality === 'CT';
  const needsMriVerification = slide?.file_type === 'nifti' && !isMr && !isCt;
  const isNifti = slide?.file_type === 'nifti';
  const activePlane = viewMode === '3d'
    ? 'axial'
    : (viewMode === 'mpr' ? (plane === '3d' ? 'axial' : plane) : (isNifti ? plane : 'axial'));
  const activeIndex = (viewMode === 'mpr' || viewMode === '3d') ? (mprCursor?.[activePlane] ?? index) : index;
  const selectedModel = radModels.find((item) => item.id === feature) || radModels[0] || RAD_AI_MODELS[0];

  useEffect(() => {
    const controller = new AbortController();
    aiSubscriptionService.entitlements(controller.signal)
      .then((data) => {
        const byCode = Object.fromEntries((data?.features || []).map((item) => [item.feature_code, item]));
        setCatalogByCode(byCode);
        const visible = RAD_AI_MODELS.filter((model) => {
          const catalog = byCode[model.featureCode];
          if (!catalog) return true;
          return featureVisibleInWorkspace(catalog, 'radiology');
        });
        setRadModels(visible.length ? visible : RAD_AI_MODELS);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setRadModels(RAD_AI_MODELS);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const preferred = isCt ? 'totalseg' : 'neuromri';
    setFeature(radModels.some((item) => item.id === preferred) ? preferred : (radModels[0]?.id || 'neuromri'));
  }, [slide?.id, isCt, radModels]);

  useEffect(() => () => { verifyAbort.current?.abort(); }, []);

  if (!meta) return null;

  const showModel = isMr;
  const scores = result?.class_scores ? Object.entries(result.class_scores).sort((a, b) => b[1] - a[1]) : [];
  const sliceLabel = `${String(activePlane).toUpperCase()} · slice ${(activeIndex ?? 0) + 1}`;

  return (
    <section className="ai-panel" aria-label="AI analysis">
      <p className="ai-disclaimer" role="note">
        <AlertTriangle size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
        Research Use Only — Not for Clinical Diagnosis
      </p>

      <div className="ai-feature-selector">
        <p className="ai-feature-selector__label">AI features on this study</p>
        <div className="ai-feature-list">
          {radModels.map((model) => {
            const catalog = catalogByCode[model.featureCode];
            const title = catalog?.catalog_title || catalog?.feature_name || model.label;
            const summary = catalog?.catalog_summary || model.hint;
            const selected = feature === model.id;
            const status = model.id === 'neuromri' && result && !result.stale
              ? `Last: ${result.predicted_class}`
              : selected
                ? 'Selected for this viewer'
                : 'Available in radiology workspace';
            return (
              <div className={`ai-feature-list__item${selected ? ' is-selected' : ''}`} key={model.id}>
                <div>
                  <strong>{title}</strong>
                  <span>{status}</span>
                  {summary && <p className="ai-feature-list__tip" role="tooltip">{summary}</p>}
                </div>
                <div className="ai-feature-list__actions">
                  <button
                    type="button"
                    onClick={() => setFeature(model.id)}
                    disabled={busy}
                    aria-pressed={selected}
                  >
                    {selected ? 'Selected' : 'Use'}
                  </button>
                </div>
              </div>
            );
          })}
          {!radModels.length && (
            <p className="ai-feature-selector__description">No AI models are assigned to the radiology workspace.</p>
          )}
        </div>
        <p className="ai-feature-selector__description">
          NeuroMRI and TotalSegmentator run when this study and your account allow them. Results stay with the slide.
        </p>
      </div>

      {feature === 'totalseg' ? (
        <div className="ai-panel__section">
          <p className="imaging-note">{selectedModel?.hint}</p>
          <TotalSegmentatorPanel
            embedded
            slide={slide}
            meta={meta}
            viewMode={viewMode}
            plane={activePlane}
            index={activeIndex}
            onOverlay={onSegOverlay}
            onState={onSegState}
          />
        </div>
      ) : !showModel ? (
        needsMriVerification ? (
          <div className="ai-panel__section">
            <p className="imaging-note">NIfTI is a file format, not a modality. Confirm MRI before classification.</p>
            <button
              type="button"
              className="btn-primary"
              disabled={verifying}
              onClick={async () => {
                verifyAbort.current?.abort();
                const controller = new AbortController();
                verifyAbort.current = controller;
                setVerifying(true);
                setVerifyError('');
                try {
                  const response = await apiFetch(`${API_BASE_URL}/api/ai/neuromri/verify-modality`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ slide_id: slide.id }),
                    signal: controller.signal,
                  });
                  const body = await response.json().catch(() => ({}));
                  if (!response.ok) throw new Error(body.detail || 'MRI verification was not saved');
                  onVerified?.(body);
                } catch (err) {
                  if (err.name === 'AbortError') return;
                  setVerifyError(err.message || 'MRI verification was not saved');
                } finally {
                  if (!controller.signal.aborted) setVerifying(false);
                }
              }}
            >
              {verifying ? 'Saving…' : 'Verify as MRI'}
            </button>
            {verifyError && <p className="imaging-note imaging-note--error">{verifyError}</p>}
          </div>
        ) : (
          <p className="imaging-note">
            NeuroMRI is for brain MRI only. This study is {isCt ? 'CT' : (modality || 'not marked as MR')}.
          </p>
        )
      ) : (
        <div className="ai-panel__section">
          <p className="imaging-note">{sliceLabel} · {selectedModel?.hint}</p>
          {busy ? (
            <p className="ai-progress-card" role="status">
              <Loader2 size={13} className="spin" aria-hidden="true" /> Running…
            </p>
          ) : (
            <button
              type="button"
              className="btn-primary"
              onClick={() => onRun({ slide_id: slide.id, plane: activePlane, index: activeIndex, frame_index: 0 })}
            >
              Classify slice
            </button>
          )}
          {error && <p className="imaging-note imaging-note--error">{error}</p>}
          {result && (
            <div className="ai-result-card">
              {result.stale && <p className="imaging-note">Result is from a previous slice — run again.</p>}
              <div className="annotation-panel-heading">
                <div>
                  <h3>{result.predicted_class}</h3>
                  <span>{result.model_version || 'NeuroMRI'}</span>
                </div>
              </div>
              <ul className="rad-ai__scores">
                {scores.map(([name, score]) => (
                  <li key={name}>
                    <span>{name}</span>
                    <output>{Number(score).toFixed(3)}</output>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
