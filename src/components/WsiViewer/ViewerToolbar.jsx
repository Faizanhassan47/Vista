import { useEffect, useRef, useState } from 'react';
import {
  ZoomIn, ZoomOut, Maximize2, RotateCcw, RotateCw,
  FlipHorizontal, FlipVertical, Sliders, Map, Footprints,
  Eye, EyeOff, Bookmark, BookmarkCheck, SplitSquareVertical, Layers,
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
  showDip,
  onToggleDip,
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
  const annotationMenuRef = useRef(null);
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

  return (
    <nav className={`advanced-viewer-toolbar${annotationMenuOpen ? ' advanced-viewer-toolbar--annotation-open' : ''}`} aria-label="Whole-slide image controls">
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
        <button
          type="button"
          className={`btn-toolbar ${showDip ? 'btn-toolbar--active' : ''}`}
          onClick={onToggleDip}
          title="Digital image processing"
          aria-pressed={showDip}
          aria-label="Digital image processing"
        >
          <Layers size={16} />
          <span className="toolbar-btn-text">DIP</span>
        </button>
      </div>

      {/* Group 4: Overlay & Layer Toggles */}
      <div className="toolbar-group" role="group" aria-label="Overlays and Layers">
        <button
          type="button"
          className={`btn-toolbar ${trailVisible ? 'btn-toolbar--active' : ''}`}
          onClick={onToggleTrail}
          title="Toggle viewing trail coverage (T)"
          aria-pressed={trailVisible}
          aria-label="Toggle viewing trail coverage"
        >
          <Footprints size={16} />
          <span className="toolbar-btn-text">Trail</span>
        </button>
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
            title="Compare this slide with another slide side by side"
            aria-label="Compare slides side by side"
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
