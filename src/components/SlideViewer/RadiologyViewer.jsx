import { useEffect, useRef, useState } from 'react';
import { Box, Columns2, Hand, Maximize2, RotateCcw, Scan, SunMedium, ZoomIn, ZoomOut } from 'lucide-react';
import MedicalVolume3DViewer from './MedicalVolume3DViewer';
import RadiologyMprViewer from './RadiologyMprViewer';
import { findHuTissuePreset, HU_TISSUE_PRESETS } from './huTissuePresets';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';

const PRESETS = {
  CT: { Lung: [-600, 1500], 'Soft tissue': [40, 400], Bone: [300, 1500] },
};
const INTENSITY_PRESETS = {
  'Lower third': 'lower',
  'Mid intensities': 'mid',
  'Upper third': 'upper',
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
  const [fullscreen, setFullscreen] = useState(false);
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
  const toolRef = useRef(tool);
  const countRef = useRef(1);
  const planeRef = useRef(plane);
  toolRef.current = tool;
  planeRef.current = plane;
  const [mprCursor, setMprCursor] = useState({ axial: 0, coronal: 0, sagittal: 0 });
  const [huMin, setHuMin] = useState('-1000');
  const [huMax, setHuMax] = useState('-500');
  const [huColor, setHuColor] = useState('red');
  const [huOpacity, setHuOpacity] = useState(55);
  const [huVisible, setHuVisible] = useState(true);
  const [huMask, setHuMask] = useState('');
  const [huStats, setHuStats] = useState(null);
  const [huError, setHuError] = useState('');
  const [huTissueId, setHuTissueId] = useState('air');
  const [appliedThreshold, setAppliedThreshold] = useState(null);
  const thresholdReq = useRef(0);

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
          const mid = Math.floor((axialCount - 1) / 2);
          setIndex(mid);
          setMprCursor({ axial: mid, coronal: 0, sagittal: 0 });
        }
        setTool(axialCount > 1 || body.plane_counts ? 'stack' : 'zoom');
        const supportsHu = Boolean(body.calibration?.hu_threshold_supported);
        if (supportsHu) {
          const air = findHuTissuePreset('air');
          setHuTissueId('air');
          setHuMin(String(air.min));
          setHuMax(String(air.max));
        } else {
          setHuTissueId('');
          setHuMin('0');
          setHuMax('100');
        }
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
  useEffect(() => {
    setHuMask('');
    setHuStats(null);
    setHuError('');
    setAppliedThreshold(null);
  }, [slide.id]);
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
  countRef.current = count;
  const huSupported = Boolean(meta?.calibration?.hu_threshold_supported);
  const isCt = huSupported || String(meta?.modality || '').includes('CT');
  const isVolume = slide.file_type === 'nifti' && Boolean(meta?.plane_counts);
  const mprSupported = isVolume;
  const unitLabel = huSupported ? 'HU' : 'intensity';
  const selectedTissue = findHuTissuePreset(huTissueId);
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
    // Update readout immediately; debounce the image refetch so drags do not cancel every request.
    setPreset('');
    setWlCenterInput(String(Math.round(center * 10) / 10));
    setWlWidthInput(String(Math.round(width * 10) / 10));
    if (wlTimer.current) window.clearTimeout(wlTimer.current);
    wlTimer.current = window.setTimeout(() => commitWl(center, width), 120);
  }

  function flushWl() {
    if (wlTimer.current) {
      window.clearTimeout(wlTimer.current);
      wlTimer.current = null;
    }
    if (!wlDrag.current?.last) return;
    commitWl(wlDrag.current.last.center, wlDrag.current.last.width);
  }

  function stepSlice(delta) {
    const total = countRef.current;
    const activePlane = planeRef.current;
    if (total <= 1) return;
    setIndex((value) => {
      const next = Math.min(total - 1, Math.max(0, value + delta));
      setMprCursor((cursor) => ({ ...cursor, [activePlane]: next }));
      return next;
    });
  }

  // Attach wheel when the 2D stage mounts (callback ref survives view-mode switches).
  const attachStage = (node) => {
    if (stageRef.current?.__vistaWheelCleanup) {
      stageRef.current.__vistaWheelCleanup();
      delete stageRef.current.__vistaWheelCleanup;
    }
    stageRef.current = node;
    if (!node) return;
    const onWheelNative = (event) => {
      event.preventDefault();
      const currentTool = toolRef.current;
      if (event.ctrlKey || event.metaKey || currentTool === 'zoom' || countRef.current <= 1) {
        zoomBy(event.deltaY > 0 ? 0.9 : 1.1);
        return;
      }
      stepSlice(event.deltaY > 0 ? 1 : -1);
    };
    node.addEventListener('wheel', onWheelNative, { passive: false });
    node.__vistaWheelCleanup = () => node.removeEventListener('wheel', onWheelNative);
  };

  function onStagePointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    const currentTool = toolRef.current;
    if (currentTool === 'pan') {
      drag.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
      return;
    }
    if (currentTool === 'wl') {
      const startCenter = wlCenter ?? (isCt ? 40 : 0);
      const startWidth = wlWidth ?? (isCt ? 400 : 1000);
      wlDrag.current = {
        x: event.clientX,
        y: event.clientY,
        center: startCenter,
        width: startWidth,
        last: { center: startCenter, width: startWidth },
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }
  }

  function onStagePointerMove(event) {
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
    wlDrag.current.last = { center: nextCenter, width: nextWidth };
    scheduleWl(nextCenter, nextWidth);
  }

  function onStagePointerUp(event) {
    if (wlDrag.current) flushWl();
    drag.current = null;
    wlDrag.current = null;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* already released */
    }
  }

  async function fetchThresholdMask(sliceIndex, planeName, low, high, color, signal) {
    const params = new URLSearchParams({
      index: String(sliceIndex),
      min_hu: String(low),
      max_hu: String(high),
      color,
      plane: planeName,
      scale: huSupported ? 'hu' : 'native',
    });
    const response = await apiFetch(`${API_BASE_URL}/api/slides/${slide.id}/radiology/hu-mask?${params}`, { signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = typeof body.detail === 'string' ? body.detail : '';
      throw new Error(detail || 'Threshold is not available for this image');
    }
    const blob = await response.blob();
    return {
      url: URL.createObjectURL(blob),
      stats: {
        matching: Number(response.headers.get('X-Matching-Pixels') || 0),
        eligible: Number(response.headers.get('X-Eligible-Pixels') || 0),
        percentage: response.headers.get('X-Percentage') || '0',
        width: response.headers.get('X-Width'),
        height: response.headers.get('X-Height'),
        unit: response.headers.get('X-Unit') || (huSupported ? 'HU' : 'intensity'),
        valueMin: response.headers.get('X-Value-Min'),
        valueMax: response.headers.get('X-Value-Max'),
      },
    };
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
    setHuVisible(true);
    setAppliedThreshold({ low, high, color: huColor });
  }

  function clearThreshold() {
    thresholdReq.current += 1;
    setAppliedThreshold(null);
    setHuMask((current) => { if (current) URL.revokeObjectURL(current); return ''; });
    setHuStats(null);
    setHuError('');
  }

  // Keep the applied threshold on the current slice when scrolling / changing plane.
  useEffect(() => {
    if (!meta || viewMode !== '2d' || !appliedThreshold) return undefined;
    const { low, high, color } = appliedThreshold;
    const controller = new AbortController();
    const requestId = ++thresholdReq.current;
    const slice = Math.min(index, (meta.plane_counts?.[plane] || meta.instance_count || 1) - 1);
    fetchThresholdMask(slice, plane, low, high, color, controller.signal)
      .then((result) => {
        if (requestId !== thresholdReq.current) {
          URL.revokeObjectURL(result.url);
          return;
        }
        setHuMask((current) => { if (current) URL.revokeObjectURL(current); return result.url; });
        setHuStats(result.stats);
        setHuError(result.stats.matching === 0
          ? `No voxels matched ${low}–${high} ${result.stats.unit} on this slice.`
          : '');
      })
      .catch((error) => {
        if (error.name !== 'AbortError' && requestId === thresholdReq.current) {
          setHuError(error.message);
        }
      });
    return () => controller.abort();
  }, [meta, viewMode, appliedThreshold, index, plane, slide.id]);

  useEffect(() => {
    const changed = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  function toggleFullscreen() {
    const node = shellRef.current;
    if (!node) return;
    if (document.fullscreenElement === node) document.exitFullscreen();
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
    <div className={`radiology-workstation${fullscreen ? ' is-fullscreen' : ''}`} ref={shellRef}>
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
              title="Window/Level: select, then drag on the image — horizontal width, vertical level"
              onClick={() => setTool('wl')}
            >
              <SunMedium size={14} /> W/L
            </button>
            <button type="button" className="btn-control-secondary" title="Reset view and window" onClick={() => { resetView(); applyPreset(''); }}><RotateCcw size={14} /></button>
            {(viewMode === '2d' ? count > 1 : Boolean(meta?.plane_counts || (meta?.instance_count || 0) > 1)) && (
              <button
                type="button"
                className={`btn-control-secondary${tool === 'stack' ? ' is-active' : ''}`}
                title="Scroll slices with the mouse wheel over the image"
                onClick={() => setTool('stack')}
              >
                Slices
              </button>
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

      <div className={`radiology-workstation__body${panelOpen && viewMode !== '3d' ? '' : ' is-panel-closed'}${viewMode === '3d' ? ' is-rail-hidden' : ''}`}>
        {viewMode === '3d' ? (
          <MedicalVolume3DViewer
            slideId={slide.id}
            hu={huSupported}
            showCrosshair
            cursor={{
              axial: plane === 'axial' ? index : mprCursor.axial,
              coronal: plane === 'coronal' ? index : mprCursor.coronal,
              sagittal: plane === 'sagittal' ? index : mprCursor.sagittal,
            }}
            planeCounts={meta?.plane_counts || {
              axial: meta?.instance_count || 1,
              coronal: 1,
              sagittal: 1,
            }}
          />
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
            tool={tool}
            onWlDrag={scheduleWl}
            meta={meta}
            slide={slide}
          />
        ) : (
          <div
            ref={attachStage}
            className={`viewer radiology-stage${tool === 'pan' ? ' is-pan' : ''}${tool === 'wl' ? ' is-wl' : ''}${tool === 'stack' ? ' is-stack' : ''}`}
            onPointerDown={onStagePointerDown}
            onPointerMove={onStagePointerMove}
            onPointerUp={onStagePointerUp}
            onPointerCancel={onStagePointerUp}
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
              <span>{meta?.patient_name || meta?.study_description || slide.name || 'Study'}</span>
              <span>{meta?.modality || slide.format || 'Image'}{meta?.series_description ? ` · ${meta.series_description}` : ''}</span>
              <span>{count > 1 ? `Im: ${Math.min(index + 1, count)} / ${count}` : 'Single image'}</span>
            </div>
            <div className="radiology-overlay radiology-overlay--tr">
              <span>Zoom {Math.round(scale * 100)}%</span>
              <span>W: {wlWidth != null ? Math.round(wlWidth) : 'Auto'} L: {wlCenter != null ? Math.round(wlCenter) : 'Auto'}</span>
              {meta && !meta.spacing_available && <span>Spacing N/A</span>}
            </div>
            <div className="radiology-overlay radiology-overlay--bl">
              <span>{plane.toUpperCase()}</span>
              <span>{meta?.intensity_unit || (huSupported ? 'HU' : '')}</span>
            </div>
            <div className="radiology-overlay radiology-overlay--br">
              <span>{dimensionsLabel}</span>
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

        {viewMode !== '3d' && (
          <aside className="radiology-tool-rail" aria-label="Viewer tools">
            <button type="button" className={`btn-control-secondary${viewMode === '2d' ? ' is-active' : ''}`} title="2D" onClick={() => { if (plane === '3d') setPlane('axial'); setViewMode('2d'); }}><Scan size={15} /></button>
            <button type="button" className={`btn-control-secondary${viewMode === 'mpr' ? ' is-active' : ''}`} title={mprSupported ? 'MPR' : 'MPR needs a NIfTI volume'} disabled={!mprSupported} onClick={enterMpr}><Columns2 size={15} /></button>
            <button type="button" className={`btn-control-secondary${viewMode === '3d' ? ' is-active' : ''}`} title="3D" disabled={!meta?.volume_supported} onClick={() => setViewMode('3d')}><Box size={15} /></button>
            <button type="button" className={`btn-control-secondary${tool === 'zoom' ? ' is-active' : ''}`} title="Zoom" onClick={() => setTool('zoom')}><ZoomIn size={15} /></button>
            <button type="button" className={`btn-control-secondary${tool === 'pan' ? ' is-active' : ''}`} title="Pan" onClick={() => setTool('pan')}><Hand size={15} /></button>
            <button type="button" className={`btn-control-secondary${tool === 'wl' ? ' is-active' : ''}`} title="Window / Level" onClick={() => setTool('wl')}><SunMedium size={15} /></button>
            <button type="button" className={`btn-control-secondary${tool === 'stack' ? ' is-active' : ''}`} title="Scroll slices" onClick={() => setTool('stack')} disabled={!(viewMode === '2d' ? count > 1 : Boolean(meta?.plane_counts))}><RotateCcw size={15} /></button>
            <div className="radiology-tool-rail__spacer" />
            <button type="button" className="btn-control-secondary" title="Fit / reset" onClick={() => { resetView(); applyPreset(''); }}><Maximize2 size={15} /></button>
          </aside>
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
              <p className="imaging-note">
                {viewMode === 'mpr'
                  ? 'MPR: wheel over a plane to scroll slices. Select W/L then drag on a plane to change window/level. Side-panel presets also apply.'
                  : '2D: select W/L then drag on the image (↔ width, ↕ level). Wheel scrolls slices (Ctrl+wheel zooms).'}
              </p>
            </div>

            {viewMode === '2d' && (
              <div className="imaging-panel__section">
                <h3>Threshold</h3>
                <form className="imaging-stack" onSubmit={applyHu}>
                  <label className="imaging-check">
                    <input type="checkbox" checked={huVisible} onChange={(event) => setHuVisible(event.target.checked)} />
                    Show overlay
                  </label>
                  {huSupported ? (
                    <>
                      <label>Material / tissue
                        <select
                          value={huTissueId || 'custom'}
                          onChange={(event) => {
                            const id = event.target.value;
                            if (id === 'custom') {
                              setHuTissueId('');
                              return;
                            }
                            const tissue = findHuTissuePreset(id);
                            if (!tissue) return;
                            setHuTissueId(id);
                            setHuMin(String(tissue.min));
                            setHuMax(String(tissue.max));
                          }}
                        >
                          <option value="custom">Custom</option>
                          {HU_TISSUE_PRESETS.map((tissue) => (
                            <option key={tissue.id} value={tissue.id}>
                              {tissue.label} ({tissue.rangeLabel} HU)
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="hu-tissue-ref" role="table" aria-label="Standard HU ranges">
                        <div className="hu-tissue-ref__head" role="row">
                          <span role="columnheader">Material / tissue</span>
                          <span role="columnheader">HU range</span>
                        </div>
                        {HU_TISSUE_PRESETS.map((tissue) => (
                          <button
                            key={tissue.id}
                            type="button"
                            role="row"
                            className={`hu-tissue-ref__row${huTissueId === tissue.id ? ' is-active' : ''}`}
                            onClick={() => {
                              setHuTissueId(tissue.id);
                              setHuMin(String(tissue.min));
                              setHuMax(String(tissue.max));
                            }}
                          >
                            <span role="cell">{tissue.label}</span>
                            <span role="cell">{tissue.rangeLabel}</span>
                          </button>
                        ))}
                      </div>
                      {selectedTissue && (
                        <p className="imaging-note">{selectedTissue.use}</p>
                      )}
                    </>
                  ) : (
                    <label>Preset
                      <select
                        defaultValue="Custom"
                        onChange={(event) => {
                          const kind = INTENSITY_PRESETS[event.target.value];
                          const stats = huStats;
                          const vmin = Number(stats?.valueMin);
                          const vmax = Number(stats?.valueMax);
                          if (!kind || !Number.isFinite(vmin) || !Number.isFinite(vmax) || vmax <= vmin) return;
                          const span = vmax - vmin;
                          if (kind === 'lower') {
                            setHuMin(String(Math.round(vmin)));
                            setHuMax(String(Math.round(vmin + span / 3)));
                          } else if (kind === 'upper') {
                            setHuMin(String(Math.round(vmax - span / 3)));
                            setHuMax(String(Math.round(vmax)));
                          } else {
                            setHuMin(String(Math.round(vmin + span / 3)));
                            setHuMax(String(Math.round(vmax - span / 3)));
                          }
                        }}
                      >
                        <option value="Custom">Custom</option>
                        {Object.keys(INTENSITY_PRESETS).map((name) => (
                          <option key={name} value={name}>{name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="imaging-pair">
                    <label>Minimum {unitLabel}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={huMin}
                        onChange={(event) => {
                          setHuTissueId('');
                          setHuMin(event.target.value);
                        }}
                      />
                    </label>
                    <label>Maximum {unitLabel}
                      <input
                        type="text"
                        inputMode="decimal"
                        value={huMax}
                        onChange={(event) => {
                          setHuTissueId('');
                          setHuMax(event.target.value);
                        }}
                      />
                    </label>
                  </div>
                  <label>Color
                    <select
                      value={huColor}
                      onChange={(event) => {
                        const next = event.target.value;
                        setHuColor(next);
                        setAppliedThreshold((current) => (current ? { ...current, color: next } : current));
                      }}
                    >
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
                    <button type="button" className="btn-control-secondary" onClick={clearThreshold}>Clear</button>
                  </div>
                  {huError && <p className="imaging-note imaging-note--error">{huError}</p>}
                  {huStats && (
                    <p className="imaging-note">
                      {huStats.matching} matching pixels ({huStats.percentage}% of {huStats.eligible}). {huStats.unit || unitLabel} range, not a diagnosis.
                    </p>
                  )}
                </form>
              </div>
            )}

            {(viewMode === 'mpr' || viewMode === '3d') && (
              <div className="imaging-panel__section">
                <h3>Linked cursor</h3>
                <p className="imaging-note">
                  Axial {(viewMode === '3d' && plane === 'axial' ? index : mprCursor.axial) + 1}/{meta?.plane_counts?.axial || meta?.instance_count || 1}
                  {' · '}Coronal {(viewMode === '3d' && plane === 'coronal' ? index : mprCursor.coronal) + 1}/{meta?.plane_counts?.coronal || 1}
                  {' · '}Sagittal {(viewMode === '3d' && plane === 'sagittal' ? index : mprCursor.sagittal) + 1}/{meta?.plane_counts?.sagittal || 1}
                </p>
                <button
                  type="button"
                  className="btn-control-secondary"
                  onClick={() => {
                    const counts = meta?.plane_counts || {
                      axial: meta?.instance_count || 1,
                      coronal: 1,
                      sagittal: 1,
                    };
                    const centered = midCursor(counts);
                    setMprCursor(centered);
                    if (viewMode === '3d') setIndex(centered[plane] || centered.axial || 0);
                  }}
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
