import { useEffect, useRef, useState } from 'react';
import { Box, Columns2, Hand, Maximize2, RotateCcw, Scan, SunMedium, ZoomIn, ZoomOut } from 'lucide-react';
import MedicalVolume3DViewer from './MedicalVolume3DViewer';
import RadiologyMprViewer from './RadiologyMprViewer';
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

function midCursor(counts) {
  return {
    axial: Math.floor(((counts?.axial || 1) - 1) / 2),
    coronal: Math.floor(((counts?.coronal || 1) - 1) / 2),
    sagittal: Math.floor(((counts?.sagittal || 1) - 1) / 2),
  };
}

export default function RadiologyViewer({ slide, onError }) {
  const shellRef = useRef(null);
  const stageRef = useRef(null);
  const [meta, setMeta] = useState(null);
  const [index, setIndex] = useState(0);
  const [plane, setPlane] = useState('axial');
  const [preset, setPreset] = useState('');
  const [wlCenter, setWlCenter] = useState(null);
  const [wlWidth, setWlWidth] = useState(null);
  const [wlCenterInput, setWlCenterInput] = useState('');
  const [wlWidthInput, setWlWidthInput] = useState('');
  const [url, setUrl] = useState('');
  const [frameError, setFrameError] = useState('');
  const [viewMode, setViewMode] = useState('2d');
  const [panelOpen, setPanelOpen] = useState(true);
  const [tool, setTool] = useState('zoom');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [fitSize, setFitSize] = useState({ w: 0, h: 0 });
  const drag = useRef(null);
  const wlDrag = useRef(null);
  const wlTimer = useRef(null);
  const [mprCursor, setMprCursor] = useState({ axial: 0, coronal: 0, sagittal: 0 });
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
        if (body.plane_counts) {
          const cursor = midCursor(body.plane_counts);
          setMprCursor(cursor);
          setIndex(cursor.axial);
          if (slide.file_type === 'nifti') setViewMode('mpr');
        } else {
          setIndex(Math.floor((axialCount - 1) / 2));
        }
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
    const params = new URLSearchParams({ index: String(slice), plane });
    if (wlCenter != null && wlWidth != null && wlWidth > 0) {
      params.set('center', String(wlCenter));
      params.set('width', String(wlWidth));
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
  }, [meta, index, plane, wlCenter, wlWidth, slide.id, onError, viewMode]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (huMask) URL.revokeObjectURL(huMask); }, [huMask]);
  useEffect(() => { setHuMask(''); setHuStats(null); setHuError(''); }, [index, slide.id, plane]);
  useEffect(() => { setNatural({ w: 0, h: 0 }); setFitSize({ w: 0, h: 0 }); }, [url]);
  useEffect(() => () => { if (wlTimer.current) window.clearTimeout(wlTimer.current); }, []);

  useEffect(() => {
    function updateFit() {
      const stage = stageRef.current;
      if (!stage || !natural.w || !natural.h) return;
      const pad = 28;
      const availW = Math.max(1, stage.clientWidth - pad);
      const availH = Math.max(1, stage.clientHeight - pad);
      const ratio = Math.min(availW / natural.w, availH / natural.h);
      setFitSize({
        w: Math.max(1, Math.floor(natural.w * ratio)),
        h: Math.max(1, Math.floor(natural.h * ratio)),
      });
    }
    updateFit();
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateFit);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [natural.w, natural.h, panelOpen, viewMode]);

  const count = meta?.plane_counts?.[plane] || meta?.instance_count || 1;
  const huSupported = Boolean(meta?.calibration?.hu_threshold_supported);
  const isCt = huSupported || String(meta?.modality || '').includes('CT');
  const isVolume = slide.file_type === 'nifti' && Boolean(meta?.plane_counts);
  const mprSupported = isVolume;
  const unitLabel = huSupported || (!isVolume && isCt) ? 'HU' : 'intensity';
  const markers = isVolume ? PLANE_MARKERS[plane] : null;
  const windowLabel = preset || (wlCenter != null && wlWidth != null ? `${Math.round(wlCenter)} / ${Math.round(wlWidth)}` : 'Auto');
  const volumeDepth = meta?.plane_counts?.axial || meta?.level_count || meta?.instance_count;
  const dimensionsLabel = meta?.width && meta?.height
    ? (isVolume && volumeDepth ? `${meta.width} × ${meta.height} × ${volumeDepth}` : `${meta.width} × ${meta.height}`)
    : 'Dimensions from the rendered slice.';

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
    const cursorIndex = mprCursor[item] ?? Math.floor((next - 1) / 2);
    setIndex(cursorIndex);
    resetView();
  }

  function applyPreset(name) {
    setPreset(name);
    if (!name) {
      setWlCenter(null);
      setWlWidth(null);
      setWlCenterInput('');
      setWlWidthInput('');
      return;
    }
    const range = PRESETS.CT[name];
    if (!range) return;
    setWlCenter(range[0]);
    setWlWidth(range[1]);
    setWlCenterInput(String(range[0]));
    setWlWidthInput(String(range[1]));
  }

  function commitWl(center, width) {
    if (!Number.isFinite(center) || !Number.isFinite(width) || width <= 0) return;
    setPreset('');
    setWlCenter(center);
    setWlWidth(width);
    setWlCenterInput(String(Math.round(center * 10) / 10));
    setWlWidthInput(String(Math.round(width * 10) / 10));
  }

  function scheduleWl(center, width) {
    if (wlTimer.current) window.clearTimeout(wlTimer.current);
    wlTimer.current = window.setTimeout(() => commitWl(center, width), 60);
  }

  function onWheel(event) {
    event.preventDefault();
    if (tool === 'stack' && count > 1) {
      setIndex((value) => {
        const next = Math.min(count - 1, Math.max(0, value + (event.deltaY > 0 ? 1 : -1)));
        setMprCursor((cursor) => ({ ...cursor, [plane]: next }));
        return next;
      });
      return;
    }
    if (tool === 'zoom' || count === 1) zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
  }

  function onStageDown(event) {
    if (tool === 'pan') {
      drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
      return;
    }
    if (tool === 'wl') {
      const startCenter = wlCenter ?? (isCt ? 40 : 0);
      const startWidth = wlWidth ?? (isCt ? 400 : 1000);
      wlDrag.current = {
        x: event.clientX,
        y: event.clientY,
        center: startCenter,
        width: startWidth,
      };
      setTool('wl');
    }
  }

  function onStageMove(event) {
    if (drag.current) {
      setOffset({
        x: drag.current.ox + event.clientX - drag.current.x,
        y: drag.current.oy + event.clientY - drag.current.y,
      });
      return;
    }
    if (!wlDrag.current) return;
    const dx = event.clientX - wlDrag.current.x;
    const dy = event.clientY - wlDrag.current.y;
    const nextWidth = Math.max(1, wlDrag.current.width + dx * 2);
    const nextCenter = wlDrag.current.center - dy * 1.5;
    scheduleWl(nextCenter, nextWidth);
  }

  function onStageUp() {
    drag.current = null;
    wlDrag.current = null;
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

  function enterMpr() {
    if (!mprSupported) return;
    setViewMode('mpr');
    setMprCursor((cursor) => ({
      ...midCursor(meta?.plane_counts),
      ...cursor,
      [plane]: index,
    }));
  }

  function syncFromMpr(nextCursor) {
    setMprCursor(nextCursor);
    if (viewMode === '2d') setIndex(nextCursor[plane] || 0);
  }

  return (
    <div className="radiology-workstation" ref={shellRef}>
      <div className="radiology-toolbar" role="toolbar" aria-label="Imaging viewer">
        <div className="radiology-toolbar__group">
          <button type="button" className={`btn-control-secondary${viewMode === '2d' ? ' is-active' : ''}`} onClick={() => { if (plane === '3d') setPlane('axial'); setViewMode('2d'); }}><Scan size={14} /> 2D</button>
          <button type="button" className={`btn-control-secondary${viewMode === '3d' ? ' is-active' : ''}`} disabled={!meta?.volume_supported} title={meta?.volume_supported ? 'Full-screen volume rendering' : 'A 3D view needs a NIfTI volume or a DICOM series of at least 8 images'} onClick={() => setViewMode('3d')}><Box size={14} /> 3D</button>
          <button
            type="button"
            className={`btn-control-secondary${viewMode === 'mpr' ? ' is-active' : ''}`}
            disabled={!mprSupported}
            title={mprSupported ? 'Linked axial, coronal, and sagittal planes' : 'MPR needs a NIfTI volume'}
            onClick={enterMpr}
          >
            <Columns2 size={14} /> MPR
          </button>
        </div>
        {(viewMode === '2d' || viewMode === 'mpr') && (
          <div className="radiology-toolbar__group">
            {viewMode === '2d' && (
              <>
                <button type="button" className="btn-control-secondary" title="Zoom in" onClick={() => { setTool('zoom'); zoomBy(1.25); }}><ZoomIn size={14} /></button>
                <button type="button" className="btn-control-secondary" title="Zoom out" onClick={() => { setTool('zoom'); zoomBy(0.8); }}><ZoomOut size={14} /></button>
                <button type="button" className={`btn-control-secondary${tool === 'pan' ? ' is-active' : ''}`} title="Pan" onClick={() => setTool('pan')}><Hand size={14} /></button>
                <button type="button" className="btn-control-secondary" title="Fit" onClick={resetView}>Fit</button>
              </>
            )}
            <button
              type="button"
              className={`btn-control-secondary${tool === 'wl' ? ' is-active' : ''}`}
              title="Window/Level: drag horizontally for width, vertically for level"
              onClick={() => setTool('wl')}
            >
              <SunMedium size={14} /> W/L
            </button>
            <button type="button" className="btn-control-secondary" title="Reset view and window" onClick={() => { resetView(); applyPreset(''); }}><RotateCcw size={14} /></button>
            {viewMode === '2d' && count > 1 && (
              <button type="button" className={`btn-control-secondary${tool === 'stack' ? ' is-active' : ''}`} title="Mouse wheel changes slice" onClick={() => setTool('stack')}>Slices</button>
            )}
            {viewMode === '2d' && isVolume && (
              <div className="radiology-toolbar__group" role="group" aria-label="Plane">
                {['axial', 'coronal', 'sagittal'].map((item) => (
                  <button type="button" key={item} className={`btn-control-secondary${plane === item ? ' is-active' : ''}`} onClick={() => selectPlane(item)}>
                    {item.charAt(0).toUpperCase() + item.slice(1)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="radiology-toolbar__group radiology-toolbar__group--end">
          <button type="button" className="btn-control-secondary" disabled title="Distance and angle tools stay with the pathology annotation workflow. This viewer does not calculate millimeters.">Measure</button>
          <button type="button" className="btn-control-secondary" title="Fullscreen" onClick={toggleFullscreen}><Maximize2 size={14} /></button>
          <button type="button" className={`btn-control-secondary${panelOpen ? ' is-active' : ''}`} onClick={() => setPanelOpen((value) => !value)}>{panelOpen ? 'Hide panel' : 'Show panel'}</button>
        </div>
      </div>

      <div className={`radiology-workstation__body${panelOpen && viewMode !== '3d' ? '' : ' is-panel-closed'}`}>
        {viewMode === '3d' ? (
          <MedicalVolume3DViewer slideId={slide.id} hu={huSupported} />
        ) : viewMode === 'mpr' ? (
          <RadiologyMprViewer
            slideId={slide.id}
            planeCounts={meta?.plane_counts}
            wlCenter={wlCenter}
            wlWidth={wlWidth}
            cursor={mprCursor}
            onCursorChange={syncFromMpr}
            activePlane={plane}
            onActivePlane={(next) => setPlane(next === '3d' ? '3d' : next)}
            hu={huSupported}
            showVolume={Boolean(meta?.volume_supported)}
          />
        ) : (
          <div
            ref={stageRef}
            className={`viewer radiology-stage${tool === 'pan' ? ' is-pan' : ''}${tool === 'wl' ? ' is-wl' : ''}`}
            onWheel={onWheel}
            onMouseDown={onStageDown}
            onMouseMove={onStageMove}
            onMouseUp={onStageUp}
            onMouseLeave={onStageUp}
          >
            {frameError ? <p className="viewer-hint-bar">{frameError}</p> : url && (
              <div
                className="radiology-stage__frame"
                data-fitted={fitSize.w ? '' : undefined}
                style={{
                  width: fitSize.w || undefined,
                  height: fitSize.h || undefined,
                  transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }}
              >
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  onLoad={(event) => {
                    const { naturalWidth: w, naturalHeight: h } = event.currentTarget;
                    if (w && h) setNatural({ w, h });
                  }}
                />
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

        {panelOpen && viewMode !== '3d' && (
          <aside className="imaging-panel" aria-label="Imaging controls">
            <div className="imaging-panel__section">
              <h3>Display</h3>
              <p className="imaging-dims">{dimensionsLabel}</p>
              <p className="imaging-note">
                {viewMode === 'mpr'
                  ? 'VolView-style layout · axial / coronal / sagittal / 3D · click crosshairs · wheel scrolls a plane'
                  : (isVolume ? `${plane.charAt(0).toUpperCase() + plane.slice(1)} plane` : 'Rendered frame')}
                {meta?.modality ? ` · ${meta.modality}` : ''}
              </p>
              <label>Window preset
                <select value={preset} onChange={(event) => applyPreset(event.target.value)}>
                  <option value="">Auto / Custom</option>
                  {Object.keys(PRESETS.CT).map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <div className="imaging-pair">
                <label>Level (center)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={wlCenterInput}
                    placeholder="Auto"
                    onChange={(event) => setWlCenterInput(event.target.value)}
                    onBlur={() => {
                      const center = Number(wlCenterInput);
                      const width = Number(wlWidthInput || wlWidth || (isCt ? 400 : 1000));
                      if (wlCenterInput.trim() === '') applyPreset('');
                      else commitWl(center, width);
                    }}
                  />
                </label>
                <label>Window (width)
                  <input
                    type="text"
                    inputMode="decimal"
                    value={wlWidthInput}
                    placeholder="Auto"
                    onChange={(event) => setWlWidthInput(event.target.value)}
                    onBlur={() => {
                      const width = Number(wlWidthInput);
                      const center = Number(wlCenterInput || wlCenter || (isCt ? 40 : 0));
                      if (wlWidthInput.trim() === '') applyPreset('');
                      else commitWl(center, width);
                    }}
                  />
                </label>
              </div>
              <p className="imaging-note">Select W/L then drag on the image: horizontal = width, vertical = level.</p>
            </div>

            {viewMode === '2d' && (
              <div className="imaging-panel__section">
                <h3>Threshold</h3>
                <form className="imaging-stack" onSubmit={applyHu}>
                  <label className="imaging-check">
                    <input type="checkbox" checked={huVisible} onChange={(event) => setHuVisible(event.target.checked)} />
                    Show overlay
                  </label>
                  <label>Preset
                    <select
                      defaultValue="Custom"
                      onChange={(event) => {
                        const range = HU_PRESETS[event.target.value];
                        if (range) {
                          setHuMin(String(range[0]));
                          setHuMax(String(range[1]));
                        }
                      }}
                    >
                      <option value="Custom">Custom</option>
                      {Object.keys(HU_PRESETS).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                  <div className="imaging-pair">
                    <label>Minimum {unitLabel}
                      <input type="text" inputMode="decimal" value={huMin} onChange={(event) => setHuMin(event.target.value)} />
                    </label>
                    <label>Maximum {unitLabel}
                      <input type="text" inputMode="decimal" value={huMax} onChange={(event) => setHuMax(event.target.value)} />
                    </label>
                  </div>
                  <label>Color
                    <select value={huColor} onChange={(event) => setHuColor(event.target.value)}>
                      <option value="red">Red</option>
                      <option value="green">Green</option>
                      <option value="blue">Blue</option>
                      <option value="yellow">Yellow</option>
                    </select>
                  </label>
                  <label>Overlay opacity {huOpacity}%
                    <input type="range" min="0" max="100" value={huOpacity} onChange={(event) => setHuOpacity(Number(event.target.value))} />
                  </label>
                  <div className="imaging-actions">
                    <button type="submit" className="btn-control-secondary">Apply</button>
                    <button type="button" className="btn-control-secondary" onClick={() => { setHuMask(''); setHuStats(null); setHuError(''); }}>Clear</button>
                  </div>
                  {huError && <p className="imaging-note imaging-note--error">{huError}</p>}
                  {huStats && (
                    <p className="imaging-note">
                      {huStats.matching} matching pixels ({huStats.percentage}% of {huStats.eligible}). {unitLabel} range, not a diagnosis.
                    </p>
                  )}
                </form>
              </div>
            )}

            {viewMode === 'mpr' && (
              <div className="imaging-panel__section">
                <h3>Linked cursor</h3>
                <p className="imaging-note">
                  Axial {mprCursor.axial + 1}/{meta?.plane_counts?.axial || 1}
                  {' · '}Coronal {mprCursor.coronal + 1}/{meta?.plane_counts?.coronal || 1}
                  {' · '}Sagittal {mprCursor.sagittal + 1}/{meta?.plane_counts?.sagittal || 1}
                </p>
                <button
                  type="button"
                  className="btn-control-secondary"
                  onClick={() => setMprCursor(midCursor(meta?.plane_counts))}
                >
                  Center all planes
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

      {viewMode === '2d' && count > 1 && (
        <div className="radiology-viewer__slider">
          <button type="button" className="btn-control-secondary" onClick={() => setIndex((value) => {
            const next = Math.max(0, value - 1);
            setMprCursor((cursor) => ({ ...cursor, [plane]: next }));
            return next;
          })} aria-label="Previous slice">Prev</button>
          <input
            type="range"
            min="0"
            max={count - 1}
            value={Math.min(index, count - 1)}
            onChange={(event) => {
              const next = Number(event.target.value);
              setIndex(next);
              setMprCursor((cursor) => ({ ...cursor, [plane]: next }));
            }}
            aria-label="Slice"
          />
          <button type="button" className="btn-control-secondary" onClick={() => setIndex((value) => {
            const next = Math.min(count - 1, value + 1);
            setMprCursor((cursor) => ({ ...cursor, [plane]: next }));
            return next;
          })} aria-label="Next slice">Next</button>
          <span>{Math.min(index + 1, count)} / {count}</span>
        </div>
      )}
    </div>
  );
}
