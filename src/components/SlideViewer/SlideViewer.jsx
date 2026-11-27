import { useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ChevronDown, Loader2 } from 'lucide-react';
import WsiViewer from '../WsiViewer/WsiViewer';
import RadiologyViewer from './RadiologyViewer';
import Tabs from '../Tabs/Tabs';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';
import '../WsiViewer/AiAnalysisPanel.css';
import './SlideViewer.css';

function PictureAiPanel({ slide }) {
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const classifyAbort = useRef(null);
  const scores = result?.class_scores ? Object.entries(result.class_scores).sort((a, b) => b[1] - a[1]) : [];
  useEffect(() => () => { classifyAbort.current?.abort(); }, []);
  return (
    <aside className="imaging-panel" aria-label="AI analysis">
      <Tabs className="findings-tabs" ariaLabel="Viewer findings" value="ai" onChange={() => {}} items={[{ value: 'ai', label: 'AI insights' }]} />
      <section className="ai-panel" aria-label="AI analysis">
        <div className="ai-panel-header" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <div className="ai-panel-header-left">
            <Activity size={15} aria-hidden="true" />
            <div>
              <p className="ai-panel-title">AI Analysis</p>
              {result && <p className="ai-panel-subtitle">{result.predicted_class} · NeuroMRI EfficientNet-B0</p>}
            </div>
          </div>
          <ChevronDown size={14} className={`ai-panel-chevron${open ? ' ai-panel-chevron--open' : ''}`} aria-hidden="true" />
        </div>
        {open && (
          <>
            <p className="ai-disclaimer" role="note"><AlertTriangle size={11} aria-hidden="true" /> Research Use Only — Not for Clinical Diagnosis</p>
            <div className="ai-feature-selector">
              <p className="ai-feature-selector__label">AI features on this image</p>
              <div className="ai-feature-list">
                <div className="ai-feature-list__item is-selected">
                  <div>
                    <strong>NeuroMRI EfficientNet-B0</strong>
                    <span>{result ? 'Showing this image' : 'Not run on this image'}</span>
                    <p className="ai-feature-selector__description">Classifies this JPG or PNG brain MRI picture. Scores are uncalibrated model outputs, not a diagnosis.</p>
                  </div>
                  <div className="ai-feature-list__actions"><button type="button" disabled aria-pressed="true">Selected</button></div>
                </div>
              </div>
            </div>
            {busy && <div className="ai-progress-card" role="status"><Loader2 size={13} className="spin" aria-hidden="true" /> Classifying this image…</div>}
            {!busy && (
              <div className="ai-actions">
                <button type="button" className="ai-action-btn" onClick={async () => {
                  classifyAbort.current?.abort();
                  const controller = new AbortController();
                  classifyAbort.current = controller;
                  setBusy(true);
                  setError('');
                  try {
                    const response = await apiFetch(`${API_BASE_URL}/api/ai/neuromri/predict`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ slide_id: slide.id, plane: 'axial', index: 0, frame_index: 0 }),
                      signal: controller.signal,
                    });
                    const body = await response.json().catch(() => ({}));
                    if (!response.ok) throw new Error(body.detail || 'NeuroMRI could not classify this image');
                    if (!controller.signal.aborted) setResult(body);
                  } catch (err) {
                    if (err.name === 'AbortError') return;
                    setError(err.message || 'NeuroMRI could not classify this image');
                  } finally {
                    if (!controller.signal.aborted) setBusy(false);
                  }
                }}>Classify this image</button>
              </div>
            )}
            {error && <p className="imaging-note imaging-note--error">{error}</p>}
            {result && (
              <div className="ai-feature-selector">
                <p className="ai-panel-subtitle">Predicted class: {result.predicted_class}</p>
                {scores.map(([name, score]) => <p key={name} className="ai-panel-subtitle">{name}: {Number(score).toFixed(4)}</p>)}
              </div>
            )}
          </>
        )}
      </section>
    </aside>
  );
}

export default function SlideViewer({ slide, zoom, setZoom, position, setPosition, dragStart, setDragStart,
  isDragging, setIsDragging, viewerRef, reset, onError, syncViews, syncedViewerRef, onOpenRegistration, onOpenCompare, activePanel }) {
  const transformRef = useRef(null);
  const imageRef = useRef(null);

  useEffect(() => {
    if (transformRef.current) transformRef.current.style.transform = `translate(${position.x}px, ${position.y}px)`;
    if (imageRef.current) imageRef.current.style.width = `${zoom * 100}%`;
  }, [position.x, position.y, zoom]);

  useEffect(() => {
    if (slide.file_type === 'wsi' || slide.file_type === 'dicom-wsi') return;
    const keydown = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      const panStep = 40;
      switch (event.key.toLowerCase()) {
        case '+':
        case '=':
          event.preventDefault();
          setZoom((v) => Math.min(10, v * 1.25));
          break;
        case '-':
        case '_':
          event.preventDefault();
          setZoom((v) => Math.max(0.2, v / 1.25));
          break;
        case '0':
        case 'f':
          event.preventDefault();
          setZoom(0.5);
          setPosition({ x: 0, y: 0 });
          break;
        case 'arrowup':
          event.preventDefault();
          setPosition((p) => ({ ...p, y: p.y + panStep }));
          break;
        case 'arrowdown':
          event.preventDefault();
          setPosition((p) => ({ ...p, y: p.y - panStep }));
          break;
        case 'arrowleft':
          event.preventDefault();
          setPosition((p) => ({ ...p, x: p.x + panStep }));
          break;
        case 'arrowright':
          event.preventDefault();
          setPosition((p) => ({ ...p, x: p.x - panStep }));
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [slide.file_type, setPosition, setZoom]);

  if (slide.file_type === 'wsi' || slide.file_type === 'dicom-wsi') return <WsiViewer slide={slide} onError={onError} syncViews={syncViews} syncedViewerRef={syncedViewerRef} externalViewerRef={viewerRef} onOpenRegistration={onOpenRegistration} onOpenCompare={onOpenCompare} activePanel={activePanel} />;
  if (slide.file_type === 'dicom-stack' || slide.file_type === 'nifti') return <RadiologyViewer slide={slide} onError={onError} activePanel={activePanel} />;

  const down = (event) => {
    setIsDragging(true);
    setDragStart({ x: event.clientX - position.x, y: event.clientY - position.y });
  };
  const move = (event) => isDragging && setPosition({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y });
  const up = () => setIsDragging(false);

  return (
    <div className="radiology-workstation">
      <div className="radiology-workstation__body">
        <div
          ref={viewerRef}
          className={`viewer radiology-stage${isDragging ? ' is-pan' : ''}`}
          onWheel={(event) => { event.preventDefault(); setZoom((value) => event.deltaY < 0 ? Math.min(10, value * 1.15) : Math.max(.2, value / 1.15)); }}
          onMouseDown={down}
          onMouseMove={move}
          onMouseUp={up}
          onMouseLeave={up}
        >
          <div ref={transformRef} className="radiology-stage__frame">
            <span ref={imageRef} className="neuromri-cam-host" style={{ width: `${Math.round(zoom * 100)}%` }}>
              <img src={slide.image_url} alt={`Slide ${slide.label}`} draggable={false} />
            </span>
          </div>
          <div className="radiology-overlay radiology-overlay--tl">
            <span>{slide.label || slide.name || 'Image'}</span>
            <span>{slide.format || 'JPG'}</span>
            <span>Single image</span>
          </div>
          <div className="radiology-overlay radiology-overlay--tr">
            <span>Zoom {Math.round(zoom * 100)}%</span>
          </div>
        </div>
        <PictureAiPanel slide={slide} />
      </div>
    </div>
  );
}
