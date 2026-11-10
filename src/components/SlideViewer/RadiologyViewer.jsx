import { useEffect, useRef, useState } from 'react';
import { Box, Columns2, Hand, Maximize2, RotateCcw, Scan, ZoomIn, ZoomOut } from 'lucide-react';
import MedicalVolume3DViewer from './MedicalVolume3DViewer';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';

const PRESETS = {
  CT: { Lung: [-600, 1500], 'Soft tissue': [40, 400], Bone: [300, 1500] },
};
const HU_PRESETS = {
  'Air / lung attenuation': [-1000, -500],
  'Fat attenuation': [-190, -30],
  'Soft-tissue attenuation': [20, 100],
  'Dense material': [300, 1500],
};
const MIN_SCALE = 0.25;
const MAX_SCALE = 8;
const PLANE_MARKERS = {
  axial: { left: 'R', right: 'L', top: 'A', bottom: 'P' },
  coronal: { left: 'R', right: 'L', top: 'S', bottom: 'I' },
  sagittal: { left: 'A', right: 'P', top: 'S', bottom: 'I' },
};

export default function RadiologyViewer({ slide, onError }) {
  const shellRef = useRef(null);
  const [meta, setMeta] = useState(null);
  const [index, setIndex] = useState(0);
  const [plane, setPlane] = useState('axial');
  const [preset, setPreset] = useState('');
  const [url, setUrl] = useState('');
  const [frameError, setFrameError] = useState('');
  const [viewMode, setViewMode] = useState('2d');
  const [panelOpen, setPanelOpen] = useState(true);
  const [tool, setTool] = useState('zoom');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const [huMin, setHuMin] = useState('-1000');
  const [huMax, setHuMax] = useState('-500');
  const [huColor, setHuColor] = useState('red');
  const [huOpacity, setHuOpacity] = useState(55);
  const [huVisible, setHuVisible] = useState(true);
  const [huMask, setHuMask] = useState('');
  const [huStats, setHuStats] = useState(null);
  const [huError, setHuError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    apiFetch(`${API_BASE_URL}/api/slides/${slide.id}/radiology`, { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.detail || 'Could not read imaging metadata');
        setMeta(body);
        const axialCount = body.plane_counts?.axial || body.instance_count || 1;
        if (body.plane_counts) setIndex(Math.floor((axialCount - 1) / 2));
        setTool(axialCount > 1 ? 'stack' : 'zoom');
      })
      .catch((error) => { if (error.name !== 'AbortError') onError?.(error.message); });
    return () => controller.abort();
  }, [slide.id, onError]);

  useEffect(() => {
    if (!meta || viewMode !== '2d') return undefined;
    const controller = new AbortController();
    const countForPlane = meta.plane_counts?.[plane] || meta.instance_count || 1;
    const slice = Math.min(index, countForPlane - 1);
    const window = PRESETS.CT?.[preset];
    const params = new URLSearchParams({ index: String(slice), plane });
    if (window) {
      params.set('center', String(window[0]));
      params.set('width', String(window[1]));
    }
    setFrameError('');
    apiFetch(`${API_BASE_URL}/api/slides/${slide.id}/radiology/frame?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || 'Could not render this slice');
        }
        const blob = await response.blob();
        const next = URL.createObjectURL(blob);
        setUrl((current) => { if (current) URL.revokeObjectURL(current); return next; });
      })
      .catch((error) => { if (error.name !== 'AbortError') { setFrameError(error.message); onError?.(error.message); } });
    return () => controller.abort();
  }, [meta, index, plane, preset, slide.id, onError, viewMode]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (huMask) URL.revokeObjectURL(huMask); }, [huMask]);
  useEffect(() => { setHuMask(''); setHuStats(null); setHuError(''); }, [index, slide.id, plane]);

  const count = meta?.plane_counts?.[plane] || meta?.instance_count || 1;
  const huSupported = Boolean(meta?.calibration?.hu_threshold_supported);
  const isCt = huSupported || String(meta?.modality || '').includes('CT');
  const isVolume = slide.file_type === 'nifti';
  const unitLabel = huSupported || (!isVolume && isCt) ? 'HU' : 'intensity';
  const markers = isVolume ? PLANE_MARKERS[plane] : null;
  const windowLabel = preset || 'Auto';

  function zoomBy(factor) {
    setScale((value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value * factor)));
  }

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }

  function selectPlane(item) {
    const next = meta?.plane_counts?.[item] || 1;
    setPlane(item);
    setIndex(Math.floor((next - 1) / 2));
    resetView();
  }

  function onWheel(event) {
    event.preventDefault();
    if (tool === 'stack' && count > 1) {
      setIndex((value) => Math.min(count - 1, Math.max(0, value + (event.deltaY > 0 ? 1 : -1))));
      return;
    }
    if (tool === 'zoom' || count === 1) zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
  }

  async function applyHu(event) {
    event.preventDefault();
    setHuError('');
    const low = Number(huMin);
    const high = Number(huMax);
    if (!Number.isFinite(low) || !Number.isFinite(high)) {
      setHuError('Enter a numeric minimum and maximum.');
      return;
    }
    if (low > high) {
      setHuError('Maximum must be greater than or equal to the minimum.');
      return;
    }
    const params = new URLSearchParams({
      index: String(Math.min(index, count - 1)),
      min_hu: String(low),
      max_hu: String(high),
      color: huColor,
      plane,
      scale: huSupported || !isVolume ? 'hu' : 'native',
    });
    const response = await apiFetch(`${API_BASE_URL}/api/slides/${slide.id}/radiology/hu-mask?${params}`);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = typeof body.detail === 'string' ? body.detail : '';
      setHuError(detail || 'Threshold is not available for this image');
      return;
    }
    const blob = await response.blob();
    const next = URL.createObjectURL(blob);
    setHuMask((current) => { if (current) URL.revokeObjectURL(current); return next; });
    setHuStats({
      matching: Number(response.headers.get('X-Matching-Pixels') || 0),
      eligible: Number(response.headers.get('X-Eligible-Pixels') || 0),
      percentage: response.headers.get('X-Percentage') || '0',
      width: response.headers.get('X-Width'),
      height: response.headers.get('X-Height'),
    });
    setHuVisible(true);
  }

  function toggleFullscreen() {
    const node = shellRef.current;
    if (!node) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else node.requestFullscreen?.();
  }

  return (
    <div className="radiology-workstation" ref={shellRef}>
      <div className="radiology-toolbar" role="toolbar" aria-label="Imaging viewer">
        <div className="radiology-toolbar__group">
          <button type="button" className={`btn-control-secondary${viewMode === '2d' ? ' is-active' : ''}`} onClick={() => setViewMode('2d')}><Scan size={14} /> 2D</button>
          <button type="button" className={`btn-control-secondary${viewMode === '3d' ? ' is-active' : ''}`} disabled={!meta?.volume_supported} title={meta?.volume_supported ? 'Volume rendering' : 'A 3D view needs a NIfTI volume or a DICOM series of at least 8 images'} onClick={() => setViewMode('3d')}><Box size={14} /> 3D</button>
          <button type="button" className="btn-control-secondary" disabled title="Synchronized MPR is not available. Axial, coronal, and sagittal are separate 2D planes."><Columns2 size={14} /> MPR</button>
        </div>
        {viewMode === '2d' && (
          <div className="radiology-toolbar__group">
            <button type="button" className="btn-control-secondary" title="Zoom in" onClick={() => { setTool('zoom'); zoomBy(1.25); }}><ZoomIn size={14} /></button>
            <button type="button" className="btn-control-secondary" title="Zoom out" onClick={() => { setTool('zoom'); zoomBy(0.8); }}><ZoomOut size={14} /></button>
            <button type="button" className={`btn-control-secondary${tool === 'pan' ? ' is-active' : ''}`} title="Pan" onClick={() => setTool('pan')}><Hand size={14} /></button>
            <button type="button" className="btn-control-secondary" title="Fit" onClick={resetView}>Fit</button>
            <button type="button" className="btn-control-secondary" title="Reset view" onClick={() => { resetView(); setPreset(''); }}><RotateCcw size={14} /></button>
            {count > 1 && <button type="button" className={`btn-control-secondary${tool === 'stack' ? ' is-active' : ''}`} title="Mouse wheel changes slice" onClick={() => setTool('stack')}>Slices</button>}
            {isVolume && ['axial', 'coronal', 'sagittal'].map((item) => (
              <button type="button" key={item} className={`btn-control-secondary${plane === item ? ' is-active' : ''}`} onClick={() => selectPlane(item)}>{item}</button>
            ))}
          </div>
        )}
        <div className="radiology-toolbar__group">
          <button type="button" className="btn-control-secondary" disabled title="Distance and angle tools stay with the pathology annotation workflow. This viewer does not calculate millimeters.">Measure</button>
          <button type="button" className="btn-control-secondary" title="Fullscreen" onClick={toggleFullscreen}><Maximize2 size={14} /></button>
          <button type="button" className={`btn-control-secondary${panelOpen ? ' is-active' : ''}`} onClick={() => setPanelOpen((value) => !value)}>{panelOpen ? 'Hide panel' : 'Show panel'}</button>
        </div>
      </div>

      <div className={`radiology-workstation__body${panelOpen && viewMode === '2d' ? '' : ' is-panel-closed'}`}>
        {viewMode === '3d' ? (
          <MedicalVolume3DViewer slideId={slide.id} hu={huSupported} />
        ) : (
          <div
            className={`viewer radiology-stage${tool === 'pan' ? ' is-pan' : ''}`}
            onWheel={onWheel}
            onMouseDown={(event) => { if (tool === 'pan') drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y }; }}
            onMouseMove={(event) => {
              if (!drag.current) return;
              setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
            }}
            onMouseUp={() => { drag.current = null; }}
            onMouseLeave={() => { drag.current = null; }}
          >
            {frameError ? <p className="viewer-hint-bar">{frameError}</p> : url && (
              <div className="radiology-stage__frame" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
                <img src={url} alt="" draggable={false} />
                {huVisible && huMask && <img className="radiology-stage__overlay" src={huMask} alt="" style={{ opacity: huOpacity / 100 }} />}
              </div>
            )}
            <div className="radiology-overlay radiology-overlay--tl">
              <span>{meta?.modality || slide.format || 'Image'}</span>
              <span>{count > 1 ? `Slice ${Math.min(index + 1, count)} / ${count}` : 'Single image'}</span>
            </div>
            <div className="radiology-overlay radiology-overlay--tr">
              <span>Zoom {Math.round(scale * 100)}%</span>
              <span>W/L {windowLabel}</span>
              {meta && !meta.spacing_available && <span>Spacing not available</span>}
            </div>
            {markers && (
              <>
                <span className="radiology-marker radiology-marker--left">{markers.left}</span>
                <span className="radiology-marker radiology-marker--right">{markers.right}</span>
                <span className="radiology-marker radiology-marker--top">{markers.top}</span>
                <span className="radiology-marker radiology-marker--bottom">{markers.bottom}</span>
              </>
            )}
          </div>
        )}

        {panelOpen && viewMode === '2d' && (
          <aside className="imaging-panel">
            <h3>Display</h3>
            {isCt && (
              <label>Window preset
                <select value={preset} onChange={(event) => setPreset(event.target.value)}>
                  <option value="">Auto</option>
                  {Object.keys(PRESETS.CT).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            )}
            <p className="imaging-note">{meta?.width && meta?.height ? `${meta.width} × ${meta.height}` : 'Dimensions from the rendered slice.'}{isVolume ? ` · ${plane}` : ''}</p>

            <h3>Threshold</h3>
            <form className="imaging-stack" onSubmit={applyHu}>
              <label className="imaging-check"><input type="checkbox" checked={huVisible} onChange={(event) => setHuVisible(event.target.checked)} /> Show overlay</label>
              <label>Preset
                <select onChange={(event) => { const range = HU_PRESETS[event.target.value]; if (range) { setHuMin(String(range[0])); setHuMax(String(range[1])); } }}>
                  <option>Custom</option>
                  {Object.keys(HU_PRESETS).map((name) => <option key={name}>{name}</option>)}
                </select>
              </label>
              <div className="imaging-pair">
                <label>Minimum {unitLabel}<input type="text" inputMode="decimal" value={huMin} onChange={(event) => setHuMin(event.target.value)} /></label>
                <label>Maximum {unitLabel}<input type="text" inputMode="decimal" value={huMax} onChange={(event) => setHuMax(event.target.value)} /></label>
              </div>
              <label>Color
                <select value={huColor} onChange={(event) => setHuColor(event.target.value)}>
                  <option value="red">Red</option>
                  <option value="green">Green</option>
                  <option value="blue">Blue</option>
                  <option value="yellow">Yellow</option>
                </select>
              </label>
              <label>Overlay opacity {huOpacity}%<input type="range" min="0" max="100" value={huOpacity} onChange={(event) => setHuOpacity(Number(event.target.value))} /></label>
              <button type="submit" className="btn-control-secondary">Apply threshold</button>
              <button type="button" className="btn-control-secondary" onClick={() => { setHuMask(''); setHuStats(null); setHuError(''); }}>Clear threshold</button>
              {huError && <p className="imaging-note">{huError}</p>}
              {huStats && <p className="imaging-note">{huStats.matching} matching pixels ({huStats.percentage}% of {huStats.eligible}). {unitLabel} range, not a diagnosis.</p>}
            </form>
          </aside>
        )}
      </div>

      {viewMode === '2d' && count > 1 && (
        <div className="radiology-viewer__slider">
          <button type="button" className="btn-control-secondary" onClick={() => setIndex((value) => Math.max(0, value - 1))}>Prev</button>
          <input type="range" min="0" max={count - 1} value={Math.min(index, count - 1)} onChange={(event) => setIndex(Number(event.target.value))} />
          <button type="button" className="btn-control-secondary" onClick={() => setIndex((value) => Math.min(count - 1, value + 1))}>Next</button>
          <span>{Math.min(index + 1, count)} / {count}</span>
        </div>
      )}
    </div>
  );
}
