import { useEffect, useRef, useState } from 'react';
import MedicalVolume3DViewer from './MedicalVolume3DViewer';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';

const PLANE_MARKERS = {
  axial: { left: 'R', right: 'L', top: 'A', bottom: 'P' },
  coronal: { left: 'R', right: 'L', top: 'S', bottom: 'I' },
  sagittal: { left: 'A', right: 'P', top: 'S', bottom: 'I' },
};

const PLANES = ['axial', 'coronal', 'sagittal'];

function crosshairFor(plane, cursor, counts) {
  const axial = counts.axial || 1;
  const coronal = counts.coronal || 1;
  const sagittal = counts.sagittal || 1;
  if (plane === 'axial') {
    return {
      x: (cursor.sagittal + 0.5) / sagittal,
      y: (cursor.coronal + 0.5) / coronal,
    };
  }
  if (plane === 'coronal') {
    return {
      x: (cursor.sagittal + 0.5) / sagittal,
      y: (cursor.axial + 0.5) / axial,
    };
  }
  return {
    x: (cursor.coronal + 0.5) / coronal,
    y: (cursor.axial + 0.5) / axial,
  };
}

function cursorFromClick(plane, nx, ny, counts, current) {
  const clamp = (value, max) => Math.min(max - 1, Math.max(0, Math.round(value)));
  const next = { ...current };
  if (plane === 'axial') {
    next.sagittal = clamp(nx * (counts.sagittal || 1), counts.sagittal || 1);
    next.coronal = clamp(ny * (counts.coronal || 1), counts.coronal || 1);
  } else if (plane === 'coronal') {
    next.sagittal = clamp(nx * (counts.sagittal || 1), counts.sagittal || 1);
    next.axial = clamp(ny * (counts.axial || 1), counts.axial || 1);
  } else {
    next.coronal = clamp(nx * (counts.coronal || 1), counts.coronal || 1);
    next.axial = clamp(ny * (counts.axial || 1), counts.axial || 1);
  }
  return next;
}

function MprPane({
  plane,
  slideId,
  index,
  counts,
  cursor,
  wlCenter,
  wlWidth,
  active,
  onActivate,
  onCursor,
  onWheelSlice,
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const frameRef = useRef(null);
  const markers = PLANE_MARKERS[plane];
  const count = counts?.[plane] || 1;
  const hair = crosshairFor(plane, cursor, counts || {});
  const wlLabel = wlCenter != null && wlWidth != null
    ? `W/L: ${Number(wlWidth).toFixed(0)} / ${Number(wlCenter).toFixed(0)}`
    : 'W/L: Auto';

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      index: String(Math.min(Math.max(index, 0), count - 1)),
      plane,
    });
    if (wlCenter != null && wlWidth != null && wlWidth > 0) {
      params.set('center', String(wlCenter));
      params.set('width', String(wlWidth));
    }
    setError('');
    apiFetch(`${API_BASE_URL}/api/slides/${slideId}/radiology/frame?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || 'Could not render this plane');
        }
        const blob = await response.blob();
        const next = URL.createObjectURL(blob);
        setUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return next;
        });
      })
      .catch((err) => {
        if (err.name !== 'AbortError') setError(err.message);
      });
    return () => controller.abort();
  }, [slideId, plane, index, count, wlCenter, wlWidth]);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  function handleClick(event) {
    const node = frameRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const nx = (event.clientX - rect.left) / rect.width;
    const ny = (event.clientY - rect.top) / rect.height;
    onActivate(plane);
    onCursor(cursorFromClick(plane, nx, ny, counts, cursor));
  }

  return (
    <div
      className={`radiology-mpr__pane${active ? ' is-active' : ''}`}
      onWheel={(event) => {
        event.preventDefault();
        onActivate(plane);
        onWheelSlice(plane, event.deltaY > 0 ? 1 : -1);
      }}
      onClick={handleClick}
      role="presentation"
    >
      <div className="radiology-mpr__label">{plane.charAt(0).toUpperCase() + plane.slice(1)}</div>
      {error ? <p className="viewer-hint-bar">{error}</p> : null}
      {url ? (
        <div className="radiology-mpr__frame" ref={frameRef}>
          <img src={url} alt="" draggable={false} />
          <span className="radiology-mpr__hair radiology-mpr__hair--v" style={{ left: `${hair.x * 100}%` }} />
          <span className="radiology-mpr__hair radiology-mpr__hair--h" style={{ top: `${hair.y * 100}%` }} />
        </div>
      ) : !error ? <p className="imaging-note">Loading…</p> : null}
      <div className="radiology-overlay radiology-overlay--tl">
        <span>Slice: {Math.min(index + 1, count)}/{count}</span>
      </div>
      <div className="radiology-overlay radiology-overlay--tr">
        <span>{wlLabel}</span>
      </div>
      <span className="radiology-marker radiology-marker--left">{markers.left}</span>
      <span className="radiology-marker radiology-marker--right">{markers.right}</span>
      <span className="radiology-marker radiology-marker--top">{markers.top}</span>
      <span className="radiology-marker radiology-marker--bottom">{markers.bottom}</span>
    </div>
  );
}

export default function RadiologyMprViewer({
  slideId,
  planeCounts,
  wlCenter,
  wlWidth,
  cursor,
  onCursorChange,
  activePlane,
  onActivePlane,
  hu = false,
  showVolume = true,
}) {
  const counts = planeCounts || { axial: 1, coronal: 1, sagittal: 1 };

  function wheelSlice(plane, delta) {
    const max = counts[plane] || 1;
    onCursorChange({
      ...cursor,
      [plane]: Math.min(max - 1, Math.max(0, (cursor[plane] || 0) + delta)),
    });
  }

  return (
    <div className={`radiology-mpr${showVolume ? ' radiology-mpr--with-3d' : ''}`}>
      {PLANES.map((plane) => (
        <MprPane
          key={plane}
          plane={plane}
          slideId={slideId}
          index={cursor[plane] || 0}
          counts={counts}
          cursor={cursor}
          wlCenter={wlCenter}
          wlWidth={wlWidth}
          active={activePlane === plane}
          onActivate={onActivePlane}
          onCursor={onCursorChange}
          onWheelSlice={wheelSlice}
        />
      ))}
      {showVolume ? (
        <div
          className={`radiology-mpr__pane radiology-mpr__pane--3d${activePlane === '3d' ? ' is-active' : ''}`}
          onMouseDown={() => onActivePlane('3d')}
        >
          <div className="radiology-mpr__label">3D</div>
          <MedicalVolume3DViewer
            slideId={slideId}
            hu={hu}
            compact
            showCrosshair
            cursor={cursor}
            planeCounts={counts}
          />
        </div>
      ) : null}
    </div>
  );
}
