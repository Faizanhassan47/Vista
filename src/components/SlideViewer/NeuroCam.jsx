import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';

const CLASSES = [
  'AD Mild',
  'AD Moderate',
  'AD Very Mild',
  'BT Glioma',
  'BT Meningioma',
  'BT Pituitary',
  'Brain Stroke',
  'Multiple Sclerosis',
  'Normal',
  'Parkinson Disease',
];

export function NeuroCamControls({ slideId, plane, index, frameIndex, result, disabled, onOverlay }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [cam, setCam] = useState(null);
  const [target, setTarget] = useState('');
  const [mode, setMode] = useState('overlay');
  const [opacity, setOpacity] = useState(70);
  const [visible, setVisible] = useState(true);
  const selection = result && !result.stale ? `${slideId}:${plane}:${index}:${result.predicted_class}` : '';
  const overlayRef = useRef(onOverlay);
  overlayRef.current = onOverlay;

  useEffect(() => {
    setCam(null);
    setError('');
    setTarget('');
    overlayRef.current(null);
  }, [selection]);

  if (!result || result.stale) return null;

  const show = async (nextTarget) => {
    const requestSelection = selection;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`${API_BASE_URL}/api/ai/neuromri/gradcam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slide_id: slideId,
          plane: plane || 'axial',
          index: index || 0,
          frame_index: frameIndex || 0,
          target_class: nextTarget || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail || 'Grad-CAM could not be generated');
      if (requestSelection !== selection) return;
      const next = {
        overlay: `data:image/png;base64,${body.overlay_png_base64}`,
        heatmap: `data:image/png;base64,${body.heatmap_png_base64}`,
        target: body.target_class,
        score: body.target_softmax_score,
        predicted: body.predicted_class,
      };
      setCam(next);
      setVisible(true);
      setMode('overlay');
      onOverlay({ src: next.overlay, opacity });
    } catch (err) {
      setError(err.message || 'Grad-CAM could not be generated');
    } finally {
      setBusy(false);
    }
  };

  const applyView = (nextMode, nextVisible, nextOpacity, nextCam = cam) => {
    if (!nextCam || !nextVisible || nextMode === 'original') {
      onOverlay(null);
      return;
    }
    onOverlay({
      src: nextMode === 'heatmap' ? nextCam.heatmap : nextCam.overlay,
      opacity: nextMode === 'heatmap' ? 100 : nextOpacity,
    });
  };

  return (
    <div className="ai-feature-selector">
      <p className="ai-feature-selector__label">Visual explanation — Grad-CAM</p>
      <p className="ai-feature-selector__description">Shows regions that influenced the selected class score. This is not a lesion boundary or a diagnosis. Ground truth: not available.</p>
      <label className="ai-panel-subtitle">
        Target class
        <select
          value={target}
          disabled={busy || disabled}
          onChange={(event) => {
            const value = event.target.value;
            setTarget(value);
            if (cam) show(value);
          }}
        >
          <option value="">Predicted class ({result.predicted_class})</option>
          {CLASSES.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      <div className="ai-actions">
        <button type="button" className="ai-action-btn" disabled={busy || disabled} onClick={() => show(target)}>
          {busy ? 'Generating heatmap…' : 'Generate heatmap'}
        </button>
        {cam && (
          <button type="button" className="ai-action-btn" onClick={() => {
            const next = !visible;
            setVisible(next);
            applyView(mode, next, opacity);
          }}>{visible ? 'Hide heatmap' : 'Show heatmap'}</button>
        )}
      </div>
      {busy && <div className="ai-progress-card" role="status"><Loader2 size={13} className="spin" aria-hidden="true" /> Building Grad-CAM…</div>}
      {error && <p className="imaging-note imaging-note--error">{error}</p>}
      {cam && (
        <>
          <p className="ai-panel-subtitle">Explained class: {cam.target} · score {Number(cam.score).toFixed(4)}</p>
          <p className="ai-panel-subtitle">Predicted class remains {cam.predicted}. Method: Grad-CAM.</p>
          <div className="ai-actions">
            {['original', 'heatmap', 'overlay'].map((item) => (
              <button key={item} type="button" className="ai-action-btn" aria-pressed={mode === item} onClick={() => { setMode(item); applyView(item, visible, opacity); }}>
                {item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <label className="ai-panel-subtitle">
            Opacity {opacity}%
            <input type="range" min="0" max="100" value={opacity} onChange={(event) => {
              const value = Number(event.target.value);
              setOpacity(value);
              applyView(mode, visible, value);
            }} />
          </label>
          <p className="ai-feature-selector__description">Grad-CAM highlights image regions influencing the model output. It is not a validated lesion segmentation or diagnosis.</p>
        </>
      )}
      {disabled && <p className="ai-feature-selector__description">This explanation is available in 2D slice mode only. It is not projected onto MPR or the 3D volume.</p>}
    </div>
  );
}
