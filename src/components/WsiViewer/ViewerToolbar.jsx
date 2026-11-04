import { useEffect, useRef, useState } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, RotateCcw, RotateCw,
  FlipHorizontal, FlipVertical, Sliders, Map, Footprints,
  Eye, EyeOff, Bookmark, BookmarkCheck, SplitSquareVertical,
  Circle, Keyboard, PenTool, Square, Expand, Minimize2, ChevronDown
} from 'lucide-react';
import './ViewerToolbar.css';

export default function ViewerToolbar({
  // Navigation & Zoom
  onZoomIn,
  onZoomOut,
  onFit,
  onReset,
  // Rotation
  onRotateCw,
  onRotateCcw,
  onRotate180,
  rotation = 0,
  // Flip
  onFlipH,
  onFlipV,
  onResetFlip,
  flipH = false,
  flipV = false,
  // Adjustments & Filters
  showAdjustments,
  onToggleAdjustments,
  brightness = 100,
  contrast = 100,
  gamma = 1.0,
  // Overlays & Modes
  minimapVisible,
  onToggleMinimap,
  trailVisible,
  onToggleTrail,
  annotationsVisible,
  onToggleAnnotations,
  // Bookmarks / Viewpoints
  onSaveViewpoint,
  showViewpoints,
  onToggleViewpoints,
  // Registration / Compare
  onOpenRegistration,
  onOpenCompare,
  canRegister = false,
  // Fullscreen & Shortcuts
  fullscreen,
  onToggleFullscreen,
  onOpenShortcuts,
  // Draw Mode & Controls
  drawMode,
  setDrawMode,
}) {
  const [annotationMenuOpen, setAnnotationMenuOpen] = useState(false);
  const [offset, setOffset] = useState(null);
  const annotationMenuRef = useRef(null);
  const toolbarRef = useRef(null);
  const isAdjusted = brightness !== 100 || contrast !== 100 || gamma !== 1.0;
  const isTransformed = rotation !== 0 || flipH || flipV;

  useEffect(() => {
    const closeMenu = (event) => {
      if (annotationMenuRef.current && !annotationMenuRef.current.contains(event.target)) setAnnotationMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeMenu);
    return () => document.removeEventListener('pointerdown', closeMenu);
  }, []);

  const selectAnnotationTool = (mode) => {
    setDrawMode(drawMode === mode ? null : mode);
    setAnnotationMenuOpen(false);
  };

  const dragToolbar = (event) => {
    if (event.button !== 0) return;
    const toolbar = toolbarRef.current;
    const bounds = toolbar?.parentElement?.getBoundingClientRect();
    const start = toolbar?.getBoundingClientRect();
    if (!bounds || !start) return;
    const originX = event.clientX;
    const originY = event.clientY;
    const startLeft = start.left - bounds.left;
    const startTop = start.top - bounds.top;
    const move = (pointer) => {
      const maxLeft = Math.max(0, bounds.width - start.width);
      const maxTop = Math.max(0, bounds.height - start.height);
      setOffset({
        left: Math.min(maxLeft, Math.max(0, startLeft + pointer.clientX - originX)),
        top: Math.min(maxTop, Math.max(0, startTop + pointer.clientY - originY)),
      });
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  return (
    <nav
      ref={toolbarRef}
      className={`advanced-viewer-toolbar${annotationMenuOpen ? ' advanced-viewer-toolbar--annotation-open' : ''}${offset ? ' advanced-viewer-toolbar--moved' : ''}`}
      style={offset ? { left: offset.left, top: offset.top } : undefined}
      aria-label="Whole-slide image controls"
    >
      <button type="button" className="toolbar-drag" aria-label="Move toolbar" title="Drag to move. Double-click to return to the top." onPointerDown={dragToolbar} onDoubleClick={() => setOffset(null)} />
      {/* Group 1: Zoom & Navigation */}
      <div className="toolbar-group" role="group" aria-label="Zoom and View">
        <button
          type="button"
          className="btn-toolbar"
          onClick={onFit}
          title="Fit slide to window (F)"
          aria-label="Fit slide to window"
        >
          <Maximize2 size={16} />
          <span className="toolbar-btn-text">Fit</span>
        </button>
        <button
          type="button"
          className="btn-toolbar"
          onClick={onReset}
          title="Reset viewpoint (0)"
          aria-label="Reset viewpoint"
        >
          <RotateCcw size={16} />
          <span className="toolbar-btn-text">Reset</span>
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      {/* Group 2: Rotation & Flip */}
      <div className="toolbar-group" role="group" aria-label="Orientation and Flip">
        <button
          type="button"
          className="btn-toolbar"
          onClick={onRotateCw}
          title="Rotate 90° clockwise (R)"
          aria-label="Rotate clockwise"
        >
          <RotateCw size={16} />
          <span className="toolbar-badge">{rotation ? `${rotation}°` : ''}</span>
        </button>
        <button
          type="button"
          className="btn-toolbar"
          onClick={onRotateCcw}
          title="Rotate 90° counter-clockwise (Shift + R)"
          aria-label="Rotate counter-clockwise"
        >
          <RotateCcw size={16} />
        </button>
        <button
          type="button"
          className={`btn-toolbar ${flipH ? 'btn-toolbar--active' : ''}`}
          onClick={onFlipH}
          title="Flip horizontally"
          aria-pressed={flipH}
          aria-label="Flip horizontally"
        >
          <FlipHorizontal size={16} />
        </button>
        <button
          type="button"
          className={`btn-toolbar ${flipV ? 'btn-toolbar--active' : ''}`}
          onClick={onFlipV}
          title="Flip vertically"
          aria-pressed={flipV}
          aria-label="Flip vertically"
        >
          <FlipVertical size={16} />
        </button>
      </div>

      <div className="toolbar-separator" aria-hidden="true" />

      {/* Group 3: Image Adjustments Panel Trigger */}
      <div className="toolbar-group" role="group" aria-label="Image Adjustments">
        <button
          type="button"
          className={`btn-toolbar ${showAdjustments ? 'btn-toolbar--active' : ''} ${isAdjusted ? 'btn-toolbar--highlight' : ''}`}
          onClick={onToggleAdjustments}
          title="Image adjustments: Brightness, Contrast, Gamma"
          aria-pressed={showAdjustments}
          aria-label="Adjust image brightness, contrast, and gamma"
        >
          <Sliders size={16} />
          <span className="toolbar-btn-text">Adjust</span>
          {isAdjusted && <span className="toolbar-dot" aria-label="Adjusted" />}
        </button>
      </div>

      {/* Group 4: Overlay & Layer Toggles */}
      <div className="toolbar-group" role="group" aria-label="Overlays and Layers">
    
        <div className="annotation-toolbar-menu" ref={annotationMenuRef}>
          <button type="button" className={`btn-toolbar ${annotationMenuOpen || drawMode ? 'btn-toolbar--active' : ''}`} onClick={() => setAnnotationMenuOpen((open) => !open)} title="Annotation tools" aria-expanded={annotationMenuOpen} aria-haspopup="menu">
            {annotationsVisible ? <Eye size={16} /> : <EyeOff size={16} />}
            <span className="toolbar-btn-text">Annotations</span><ChevronDown size={13} />
          </button>
          {annotationMenuOpen && <div className="annotation-toolbar-menu__popup" role="menu" aria-label="Annotation tools">
            <button type="button" role="menuitemcheckbox" aria-checked={annotationsVisible} onClick={onToggleAnnotations}>{annotationsVisible ? <Eye size={15} /> : <EyeOff size={15} />}<span>Show annotations</span></button>
            <div className="annotation-toolbar-menu__separator" />
            <button type="button" role="menuitemradio" aria-checked={drawMode === 'rectangle'} onClick={() => selectAnnotationTool('rectangle')}><Square size={15} /><span>Rectangle</span></button>
            <button type="button" role="menuitemradio" aria-checked={drawMode === 'ellipse'} onClick={() => selectAnnotationTool('ellipse')}><Circle size={15} /><span>Circle</span></button>
            <button type="button" role="menuitemradio" aria-checked={drawMode === 'freehand'} onClick={() => selectAnnotationTool('freehand')}><PenTool size={15} /><span>Pen tool</span></button>
          </div>}
        </div>
      </div>
      {/* Group 6: Multi-Slide Registration & Compare */}
      <div className="toolbar-group" role="group" aria-label="Slide Comparison and Registration">
        {onOpenCompare && (
          <button
            type="button"
            className="btn-toolbar"
            onClick={onOpenCompare}
            title="Open or close side by side"
            aria-label="Open or close side by side"
          >
            <SplitSquareVertical size={16} />
            <span className="toolbar-btn-text">Side by side</span>
          </button>
        )}
        {canRegister && (
          <button
            type="button"
            className="btn-toolbar btn-toolbar--accent"
            onClick={onOpenRegistration}
            title="Open Multi-Slide Registration Workspace"
            aria-label="Register slides"
          >
            <SplitSquareVertical size={16} />
            <span className="toolbar-btn-text">Register slides</span>
          </button>
        )}
      </div>

      {/* Group 7: Utility (Shortcuts, Fullscreen) */}
      <div className="toolbar-group toolbar-group--right" role="group" aria-label="Utilities">
        <button
          type="button"
          className="btn-toolbar"
          onClick={onToggleFullscreen}
          title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F11)'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {fullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
        </button>
      </div>
    </nav>
  );
}
