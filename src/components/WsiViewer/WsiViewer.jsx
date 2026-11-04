import { useCallback, useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import { Bookmark, Edit3, Eye, EyeOff, Expand, Maximize2, Minimize2, Minus, Plus, RefreshCw, RotateCcw, RotateCw, Trash2, PenTool, Download } from 'lucide-react';
import '../SlideViewer/SlideViewer.css';
import './WsiViewer.css';
import { claheUsesTiles, dipService } from '../../services/dipService';
import { API_BASE_URL as API } from '../../config';
import Modal from '../Modal/Modal';
import { viewerService } from '../../services/viewerService';
import { grandqcService } from '../../services/grandqcService';
import GrandQCOverlay, { qcClass } from './GrandQCOverlay';
import { getAnnotationHoverMeasurements, getAnnotationMeasurements } from './annotationMeasurements';
import { useAuth } from '../../modules/auth/AuthProvider';
import { SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE } from '../../config/roles';
import AiAnalysisPanel, { PANNUKE_CLASSES } from './AiAnalysisPanel';
import ViewerToolbar from './ViewerToolbar';
import ViewerDisplaySettings from './ViewerDisplaySettings';
import DipProcessingPanel from './DipProcessingPanel';
import ViewerBookmarksModal from './ViewerBookmarksModal';
import ViewerShortcutsModal from './ViewerShortcutsModal';
import ViewerTrail from './ViewerTrail';
import Tabs from '../Tabs/Tabs';

const DISPLAY_PROFILES = {
  standard: ['Standard color', 'Original RGB display without a profile transformation.'],
  grayscale: ['Grayscale', 'Removes hue to emphasize luminance and tissue structure.'],
  inverted: ['Inverted', 'Reverses displayed colors for alternate visual inspection.'],
  'high-contrast': ['High contrast', 'Expands tonal separation in the displayed image.'],
  'low-saturation': ['Low saturation', 'Reduces stain intensity while retaining limited color.'],
  'high-saturation': ['Enhanced saturation', 'Increases displayed color separation.'],
  'red-channel': ['Red channel', 'Displays only the source image red channel.'],
  'green-channel': ['Green channel', 'Displays only the source image green channel.'],
  'blue-channel': ['Blue channel', 'Displays only the source image blue channel.'],
  'hue-positive': ['Hue shift +90°', 'Rotates displayed hue for visual separation experiments.'],
  'hue-negative': ['Hue shift −90°', 'Rotates displayed hue in the opposite direction.'],
};

function annotationToRoi(annotation, fallbackLabel) {
  if (!annotation) return null;
  const type = annotation.annotation_type || annotation.type;
  const x = Number(annotation.x);
  const y = Number(annotation.y);
  const width = Number(annotation.width);
  const height = Number(annotation.height);
  if (Number.isFinite(x) && Number.isFinite(y) && width > 0 && height > 0 && (!type || ['rectangle', 'ellipse'].includes(type))) {
    return { x, y, width, height, label: annotation.label || fallbackLabel };
  }
  if (!Array.isArray(annotation.points) || annotation.points.length < 2) return null;
  const points = annotation.points.map((point) => Array.isArray(point) ? { x: point[0], y: point[1] } : point).filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const boxWidth = Math.max(...xs) - minX;
  const boxHeight = Math.max(...ys) - minY;
  return boxWidth > 0 && boxHeight > 0 ? { x: minX, y: minY, width: boxWidth, height: boxHeight, label: annotation.label || fallbackLabel } : null;
}

function normalizeDraftForMeasurement(geometry) {
  if (!geometry) return null;
  const type = geometry.type;
  if (['rectangle', 'ellipse'].includes(type) && geometry.points?.length >= 2) {
    const [first, second] = geometry.points;
    return { annotation_type: type, width: Math.abs(second.x - first.x), height: Math.abs(second.y - first.y) };
  }
  const points = [...(geometry.points || []), ...(type === 'polygon' && geometry.cursor ? [geometry.cursor] : [])].map((point) => [point.x, point.y]);
  return { annotation_type: type, points };
}

function niceScaleMicrons(value) {
  if (!(value > 0)) return null;
  const power = 10 ** Math.floor(Math.log10(value));
  const fraction = value / power;
  const factor = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1;
  return factor * power;
}

function scaleLabel(microns) {
  if (microns >= 1000) return `${Number((microns / 1000).toPrecision(3))} mm`;
  return `${Number(microns.toPrecision(3))} µm`;
}

// KongNet candidates must use absolute level-0 slide positions.
// Do not add the ROI origin here: conversion belongs to the inference backend.
function getMitoticPosition(detection) {
  const point = detection?.center_level0 ?? detection?.centroid_level0 ?? detection?.level0;
  const x = point?.x ?? (Array.isArray(point) ? point[0] : undefined)
    ?? detection?.slide_x ?? detection?.x_level0 ?? detection?.center_x ?? detection?.x;
  const y = point?.y ?? (Array.isArray(point) ? point[1] : undefined)
    ?? detection?.slide_y ?? detection?.y_level0 ?? detection?.center_y ?? detection?.y;
  if (x == null || y == null || !Number.isFinite(Number(x)) || !Number.isFinite(Number(y))) return null;
  return { x: Number(x), y: Number(y) };
}

function isKongNetAnalysis(analysis) {
  return analysis?.feature_code === 'MITOTIC_DETECTION'
    || /kongnet/i.test(String(analysis?.model_name ?? ''));
}

export default function WsiViewer({ slide, onError, syncViews, syncedViewerRef, externalViewerRef, onOpenRegistration, onOpenCompare, activePanel }) {
  const { user } = useAuth();
  const elementRef = useRef(null);
  const workspaceRef = useRef(null);
  const viewerRef = useRef(null);
  const [viewerInstance, setViewerInstance] = useState(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [annotations, setAnnotations] = useState([]);
  const [annotationsLoading, setAnnotationsLoading] = useState(true);
  const [drawMode, setDrawMode] = useState(null); // 'rectangle', 'polygon', 'arrow', or null
  const [visible, setVisible] = useState(true);
  const [draft, setDraft] = useState(null);
  const [redoDraft, setRedoDraft] = useState(null);
  const [editing, setEditing] = useState(null);
  const [selectedAnnotation, setSelectedAnnotation] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bookmarks, setBookmarks] = useState([]);
  const [validation, setValidation] = useState(null);
  const [aiResults, setAiResults] = useState([]);
  const [aiVisible, setAiVisible] = useState(true);
  const [inspectorTab, setInspectorTab] = useState('findings');
  useEffect(() => {
    if (activePanel === 'ai' || activePanel === 'findings') setInspectorTab(activePanel);
  }, [activePanel]);

  // Advanced Viewer Display & Transformation States
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [gamma, setGamma] = useState(1.0);
  const [displayProfile, setDisplayProfile] = useState('standard');
  const [rotationAngle, setRotationAngle] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(true);
  const [trailVisible, setTrailVisible] = useState(false);
  const [coverageBoxes, setCoverageBoxes] = useState([]);
  const [showAdjustments, setShowAdjustments] = useState(false);
  const [showDip, setShowDip] = useState(false);
  const [dipResult, setDipResult] = useState(null);
  const [dipVisible, setDipVisible] = useState(true);
  const [dipOpacity, setDipOpacity] = useState(0.65);
  const [dipView, setDipView] = useState('overlay');
  const [claheTiles, setClaheTiles] = useState([]);
  const [claheOverview, setClaheOverview] = useState(true);
  const [claheSplit, setClaheSplit] = useState(0.5);
  const [claheNote, setClaheNote] = useState('');
  const [showViewpointsModal, setShowViewpointsModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [prefSaving, setPrefSaving] = useState(false);

  const [loadFailure, setLoadFailure] = useState('');
  const preferencesSlideRef = useRef(null);
  const svgOverlayRef = useRef(null);
  const lastTileErrorToastTime = useRef(0);
  const trailDebounceTimer = useRef(null);

  // For rendering SVG aligned with OpenSeadragon
  const [, setViewState] = useState({ zoom: 1, pan: { x: 0, y: 0 } });
  const [draftGeometry, setDraftGeometry] = useState(null);
  const [hoveredAnnotation, setHoveredAnnotation] = useState(null);
  const [calibrationSaving, setCalibrationSaving] = useState(false);
  const [scaleBar, setScaleBar] = useState(null);
  const [resizeState, setResizeState] = useState(null);

  // ── HoVer-Net AI analysis state ───────────────────────────────────────────
  /** The active analysis record returned by the backend (contains nuclei array). */
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [camelyonHeatmapUrl, setCamelyonHeatmapUrl] = useState(null);
  const [camelyonVisible, setCamelyonVisible] = useState(true);
  const [camelyonOpacity, setCamelyonOpacity] = useState(0.65);
  const [qcAnalysis, setQcAnalysis] = useState(null);
  const [qcGeojson, setQcGeojson] = useState(null);
  const [qcHiddenClasses, setQcHiddenClasses] = useState(new Set());
  const [qcVisible, setQcVisible] = useState(true);
  const [qcModeActive, setQcModeActive] = useState(false);
  const [qcSelectedRegion, setQcSelectedRegion] = useState(null);

  const qcClasses = (() => {
    const counts = new Map();
    for (const feature of qcGeojson?.features || []) {
      const name = qcClass(feature);
      counts.set(name, (counts.get(name) || 0) + 1);
    }
    return Array.from(counts, ([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  })();

  useEffect(() => {
    setQcAnalysis(null);
    setQcGeojson(null);
    setQcHiddenClasses(new Set());
    setQcVisible(true);
    setQcModeActive(false);
    setQcSelectedRegion(null);
  }, [slide.id]);

  useEffect(() => {
    setAiAnalysis(null);
    setCamelyonHeatmapUrl(null);
    setCamelyonVisible(true);
    setDipResult((current) => {
      Object.values(current?.views || {}).forEach((url) => URL.revokeObjectURL(url));
      return null;
    });
    setDipView('overlay');
    setDipVisible(true);
    setShowDip(false);
    setClaheTiles((current) => {
      current.forEach((tile) => URL.revokeObjectURL(tile.url));
      return [];
    });
    setClaheOverview(true);
    setClaheNote('');
  }, [slide.id]);

  useEffect(() => {
    if (!viewerInstance || !viewerReady || dipResult?.algorithm !== 'clahe' || dipResult.mode !== 'whole_slide' || dipView === 'original' || !dipVisible) {
      setClaheTiles((current) => {
        current.forEach((tile) => URL.revokeObjectURL(tile.url));
        return [];
      });
      return undefined;
    }
    const controller = new AbortController();
    let timer = 0;
    const refresh = async () => {
      const item = viewerInstance.world.getItemAt(0);
      const element = elementRef.current;
      if (!item || !element) return;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([px, py]) => item.viewportToImageCoordinates(viewerInstance.viewport.pointFromPixel(new OpenSeadragon.Point(px, py), true)));
      const minX = Math.max(0, Math.min(...corners.map((point) => point.x)));
      const minY = Math.max(0, Math.min(...corners.map((point) => point.y)));
      const maxX = Math.min(slide.width, Math.max(...corners.map((point) => point.x)));
      const maxY = Math.min(slide.height, Math.max(...corners.map((point) => point.y)));
      const visibleWidth = Math.max(1, maxX - minX);
      const imagePerScreen = visibleWidth / Math.max(1, width);
      const overviewDownsample = slide.width / Math.max(1, dipResult.processing?.width || slide.width);
      if (!claheUsesTiles(imagePerScreen, overviewDownsample)) {
        setClaheOverview(true);
        setClaheNote('');
        setClaheTiles((current) => {
          current.forEach((tile) => URL.revokeObjectURL(tile.url));
          return [];
        });
        return;
      }
      setClaheOverview(false);
      let tileSize = Math.min(4096, Math.max(256, Math.round(imagePerScreen * 512)));
      let columns = Math.ceil(visibleWidth / tileSize);
      let rows = Math.ceil((maxY - minY) / tileSize);
      while (columns * rows > 12 && tileSize < 8192) {
        tileSize = Math.min(8192, tileSize * 2);
        columns = Math.ceil(visibleWidth / tileSize);
        rows = Math.ceil((maxY - minY) / tileSize);
      }
      const requests = [];
      for (let top = Math.floor(minY / tileSize) * tileSize; top < maxY; top += tileSize) {
        for (let left = Math.floor(minX / tileSize) * tileSize; left < maxX; left += tileSize) {
          requests.push({
            x: Math.max(0, Math.floor(left)),
            y: Math.max(0, Math.floor(top)),
            width: Math.min(tileSize, slide.width - Math.floor(left)),
            height: Math.min(tileSize, slide.height - Math.floor(top)),
          });
        }
      }
      try {
        const loaded = [];
        for (let index = 0; index < requests.length; index += 3) {
          const batch = requests.slice(index, index + 3);
          const urls = await Promise.all(batch.map((tile) => dipService.claheTile(slide.id, {
            ...tile,
            clipLimit: dipResult.parameters.clip_limit,
            tileGridSize: dipResult.parameters.tile_grid_size,
          }, controller.signal)));
          batch.forEach((tile, tileIndex) => loaded.push({ ...tile, url: urls[tileIndex] }));
        }
        if (controller.signal.aborted) {
          loaded.forEach((tile) => URL.revokeObjectURL(tile.url));
          return;
        }
        setClaheNote('');
        setClaheTiles((current) => {
          current.forEach((tile) => URL.revokeObjectURL(tile.url));
          return loaded;
        });
      } catch (error) {
        if (error.name === 'AbortError') return;
        setClaheTiles((current) => {
          current.forEach((tile) => URL.revokeObjectURL(tile.url));
          return [];
        });
        setClaheNote('Enhanced detail is not available at this magnification. The original slide remains visible.');
      }
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(refresh, 150);
    };
    viewerInstance.addHandler('update-viewport', schedule);
    schedule();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      viewerInstance.removeHandler('update-viewport', schedule);
    };
  }, [viewerInstance, viewerReady, dipResult, dipView, dipVisible, slide.id, slide.width, slide.height]);

  useEffect(() => {
    if (
      !aiAnalysis?.id ||
      aiAnalysis.feature_code !== 'CAMELYON_TUMOR_DETECTION'
    ) {
      setCamelyonHeatmapUrl(null);
      return;
    }

    const controller = new AbortController();
    let objectUrl = null;

    async function loadHeatmap() {
      try {
        const response = await fetch(
          `${API}/api/ai/analyses/${aiAnalysis.id}/overlay.png`,
          {
            credentials: 'include',
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();

        if (!blob.type.includes('image/png')) {
          throw new Error('Expected PNG heatmap');
        }

        if (controller.signal.aborted) return;

        objectUrl = URL.createObjectURL(blob);
        setCamelyonHeatmapUrl(objectUrl);
      } catch (error) {
        if (error.name !== 'AbortError') {
          onError?.(`Could not load CAMELYON heatmap: ${error.message}`);
        }
      }
    }

    setCamelyonHeatmapUrl(null);
    loadHeatmap();

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [aiAnalysis?.id, aiAnalysis?.feature_code, onError]);

  useEffect(() => {
    const controller = new AbortController();
    setQcGeojson(null);
    setQcSelectedRegion(null);
    if (qcAnalysis?.id) {
      grandqcService.geojson(qcAnalysis.id, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) setQcGeojson(data);
        })
        .catch((error) => {
          if (error.name !== 'AbortError') onError?.(`Could not load GrandQC polygons: ${error.message}`);
        });
    }
    return () => controller.abort();
  }, [qcAnalysis?.id, slide.id, onError]);
  /** Per-class visibility toggles driven by the panel. */
  const [aiHiddenClasses, setAiHiddenClasses] = useState(new Set());
  /** The nucleus the user last clicked, shown in the panel detail card. */
  const [aiSelectedNucleus, setAiSelectedNucleus] = useState(null);
  const [selectedMitoticCandidate, setSelectedMitoticCandidate] = useState(null);
  /** Screen-space tooltip position for nucleus hover. */
  const [nucleusTooltip, setNucleusTooltip] = useState(null);
  /** AI operates on the bounding rectangle of the selected annotation shape. */
  const roiRect = (() => {
    return annotationToRoi(draft, 'Draft ROI')
      || annotationToRoi(draftGeometry, 'Draft ROI')
      || annotationToRoi(editing, 'Editing ROI')
      || annotationToRoi(selectedAnnotation, `Annotation #${selectedAnnotation?.id}`);
  })();

  useEffect(() => {
    const changed = () => {
      setFullscreen(document.fullscreenElement === workspaceRef.current);
      requestAnimationFrame(() => {
        const viewer = viewerRef.current;
        const element = elementRef.current;
        if (viewer?.viewport && element) {
          viewer.viewport.resize(new OpenSeadragon.Point(element.clientWidth, element.clientHeight), true);
          viewer.forceRedraw();
        }
      });
    };
    document.addEventListener('fullscreenchange', changed);
    return () => document.removeEventListener('fullscreenchange', changed);
  }, []);

  const loadAnnotations = useCallback(async (signal) => {
    setAnnotationsLoading(true);
    try {
      const data = await viewerService.annotations(slide.id, signal);
      setAnnotations(data);
    } catch (error) {
      if (error.name !== 'AbortError') onError(`Could not load annotations: ${error.message}`);
    } finally {
      if (!signal?.aborted) setAnnotationsLoading(false);
    }
  }, [slide.id, onError]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) loadAnnotations(controller.signal);
    });
    return () => controller.abort();
  }, [loadAnnotations]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      viewerService.validation(slide.id, controller.signal).catch(() => null),
      viewerService.bookmarks(slide.id, controller.signal).catch(() => []),
      viewerService.aiResults(slide.id, controller.signal).catch(() => []),
      viewerService.preferences(slide.id, controller.signal).catch(() => ({ display_profile: 'standard', brightness: 100, contrast: 100 })),
      viewerService.getTrail(slide.id, controller.signal).catch(() => ({ coverage_boxes: [] })),
    ]).then(([metadata, saved, results, preferences, trailData]) => {
      if (!controller.signal.aborted) {
        setValidation(metadata);
        setBookmarks(saved);
        setAiResults(results);
        setDisplayProfile(preferences.display_profile || 'standard');
        setBrightness(preferences.brightness ?? 100);
        setContrast(preferences.contrast ?? 100);
        setGamma(preferences.gamma ?? 1.0);
        if (preferences.flip_h !== undefined) setFlipH(Boolean(preferences.flip_h));
        if (preferences.flip_v !== undefined) setFlipV(Boolean(preferences.flip_v));
        if (preferences.minimap_visible !== undefined) setMinimapVisible(Boolean(preferences.minimap_visible));
        if (preferences.trail_visible !== undefined) setTrailVisible(Boolean(preferences.trail_visible));
        if (trailData?.coverage_boxes) setCoverageBoxes(trailData.coverage_boxes);
        preferencesSlideRef.current = slide.id;
      }
    });
    return () => controller.abort();
  }, [slide.id]);

  const saveCurrentPreferences = useCallback(async () => {
    setPrefSaving(true);
    try {
      await viewerService.savePreferences(slide.id, {
        display_profile: displayProfile,
        brightness,
        contrast,
        gamma,
        flip_h: flipH,
        flip_v: flipV,
        minimap_visible: minimapVisible,
        trail_visible: trailVisible,
      });
    } catch (error) {
      onError(`Could not save display preferences: ${error.message}`);
    } finally {
      setPrefSaving(false);
    }
  }, [displayProfile, brightness, contrast, gamma, flipH, flipV, minimapVisible, trailVisible, onError, slide.id]);

  useEffect(() => {
    let dziUrl = slide.dzi_url;
    if (dziUrl && dziUrl.startsWith('/') && API) {
      dziUrl = `${API}${dziUrl}`;
    }

    const viewer = OpenSeadragon({
      element: elementRef.current,
      tileSources: dziUrl,
      showNavigationControl: false,
      showNavigator: true,
      navigatorPosition: 'BOTTOM_RIGHT',
      animationTime: 0.7,
      blendTime: 0.1,
      constrainDuringPan: true,
      visibilityRatio: 0.5,
      minZoomImageRatio: 0.8,
      maxZoomPixelRatio: 2,
      crossOriginPolicy: 'Anonymous',
      ajaxWithCredentials: true,
      timeout: 60000,
      imageLoaderLimit: 6,
    });
    viewerRef.current = viewer;
    const clearViewerInlineBackgrounds = () => {
      const container = viewer.container;
      if (!container) return;
      [container, ...container.querySelectorAll('[style]')].forEach((element) => {
        element.style.removeProperty('background');
        element.style.removeProperty('background-color');
        element.style.removeProperty('background-image');
      });
    };
    clearViewerInlineBackgrounds();

    viewer.addHandler('open', () => { clearViewerInlineBackgrounds(); setViewerInstance(viewer); setViewerReady(true); setLoadFailure(''); });
    viewer.addHandler('open-failed', (event) => setLoadFailure(event.message || 'The slide descriptor could not be loaded.'));
    viewer.addHandler('tile-load-failed', (event) => {
      const now = Date.now();
      if (now - lastTileErrorToastTime.current > 6000) {
        lastTileErrorToastTime.current = now;
        setLoadFailure(`A high-resolution tile failed to load${event.message ? `: ${event.message}` : ''}`);
      }
    });

    // Track viewport for SVG synchronization and viewing trail coverage
    const updateViewState = () => {
      if (!viewer.viewport) return;
      setViewState({
        zoom: viewer.viewport.getZoom(true),
        pan: viewer.viewport.getCenter(true)
      });

      // Coarse grid viewport tracking for Viewing Trail
      const item = viewer.world?.getItemAt(0);
      if (item) {
        const bounds = viewer.viewport.getBounds(true);
        const p1 = item.viewportToImageCoordinates(new OpenSeadragon.Point(bounds.x, bounds.y));
        const p2 = item.viewportToImageCoordinates(new OpenSeadragon.Point(bounds.x + bounds.width, bounds.y + bounds.height));
        const gridW = Math.max(100, Math.round(slide.width / 50));
        const gridH = Math.max(100, Math.round(slide.height / 50));
        const gx = Math.floor(Math.max(0, p1.x) / gridW) * gridW;
        const gy = Math.floor(Math.max(0, p1.y) / gridH) * gridH;
        const gw = Math.ceil(Math.min(slide.width, p2.x - gx) / gridW) * gridW;
        const gh = Math.ceil(Math.min(slide.height, p2.y - gy) / gridH) * gridH;

        if (gw > 0 && gh > 0) {
          setCoverageBoxes((prev) => {
            const exists = prev.some((b) => Math.abs(b.x - gx) < gridW / 2 && Math.abs(b.y - gy) < gridH / 2);
            if (exists) return prev;
            const updated = [...prev, { x: gx, y: gy, w: gw, h: gh }].slice(-500);

            // Debounced trail persistence
            if (trailDebounceTimer.current) clearTimeout(trailDebounceTimer.current);
            trailDebounceTimer.current = setTimeout(() => {
              viewerService.saveTrail(slide.id, { coverage_boxes: updated }).catch(() => { });
            }, 3000);

            return updated;
          });
        }
      }
    };
    viewer.addHandler('update-viewport', updateViewState);
    viewer.addHandler('animation', updateViewState);

    return () => {
      setViewerReady(false);
      setViewerInstance(null);
      viewerRef.current = null;
      viewer.destroy();
    };
  }, [slide.id, slide.dzi_url, onError]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const micronX = Number(validation?.physical_calibration?.pixel_size_microns_x);
    if (!viewerReady || !viewer?.viewport || !(micronX > 0)) {
      setScaleBar(null);
      return undefined;
    }
    const updateScaleBar = () => {
      const item = viewer.world?.getItemAt(0);
      if (!item) return;
      const start = item.viewportToImageCoordinates(viewer.viewport.pointFromPixel(new OpenSeadragon.Point(0, 0), true));
      const end = item.viewportToImageCoordinates(viewer.viewport.pointFromPixel(new OpenSeadragon.Point(100, 0), true));
      const micronsPerScreenPixel = Math.abs(end.x - start.x) * micronX / 100;
      const physicalWidth = niceScaleMicrons(micronsPerScreenPixel * 110);
      if (physicalWidth) setScaleBar({ width: Math.max(35, Math.min(150, physicalWidth / micronsPerScreenPixel)), label: scaleLabel(physicalWidth) });
    };
    updateScaleBar();
    viewer.addHandler('update-viewport', updateScaleBar);
    viewer.addHandler('animation-finish', updateScaleBar);
    return () => {
      viewer.removeHandler('update-viewport', updateScaleBar);
      viewer.removeHandler('animation-finish', updateScaleBar);
    };
  }, [validation, viewerReady]);

  useEffect(() => {
    if (externalViewerRef) {
      externalViewerRef.current = viewerRef.current;
    }
  }, [viewerReady, externalViewerRef]);

  useEffect(() => {
    const targetRefs = Array.isArray(syncedViewerRef) ? syncedViewerRef : [syncedViewerRef];
    if (!syncViews || !viewerReady || !viewerRef.current || !targetRefs.some((targetRef) => targetRef?.current)) return;
    const v1 = viewerRef.current;

    const handler = () => {
      if (v1.isSyncing) return;
      const item1 = v1.world?.getItemAt(0);
      if (!item1) return;
      const center1 = v1.viewport.getCenter();
      const size1 = item1.getContentSize();
      const fracX = center1.x;
      const fracY = size1.x ? center1.y / (size1.y / size1.x) : 0;
      targetRefs.forEach((targetRef) => {
        const v2 = targetRef?.current;
        const item2 = v2?.world?.getItemAt(0);
        if (!v2 || !item2) return;
        v2.isSyncing = true;
        const size2 = item2.getContentSize();
        const targetY = size2.x ? fracY * (size2.y / size2.x) : 0;
        v2.viewport.zoomTo(v1.viewport.getZoom(), null, true);
        v2.viewport.panTo(new OpenSeadragon.Point(fracX, targetY), true);
        v2.viewport.setRotation(v1.viewport.getRotation(), true);
        setTimeout(() => { v2.isSyncing = false; }, 50);
      });
    };

    v1.addHandler('pan', handler);
    v1.addHandler('zoom', handler);
    v1.addHandler('rotate', handler);

    return () => {
      v1.removeHandler('pan', handler);
      v1.removeHandler('zoom', handler);
      v1.removeHandler('rotate', handler);
    };
  }, [syncViews, viewerReady, syncedViewerRef]);

  // SVG coordinate conversions
  const imageToViewport = useCallback((x, y) => {
    const viewer = viewerInstance;
    if (!viewer || !viewer.world.getItemAt(0)) return { x: 0, y: 0 };
    const vp = viewer.world.getItemAt(0).imageToViewportCoordinates(x, y);
    const pixel = viewer.viewport.pixelFromPoint(vp, true);
    return { x: pixel.x, y: pixel.y };
  }, [viewerInstance]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const host = svgOverlayRef.current;
    if (!viewerReady || !viewer || !host) return undefined;

    // Disable panning when drawing
    viewer.setMouseNavEnabled(!drawMode);

    let drawingState = null; // internal state: { type, points, startPoint }

    const getImagePoint = (event) => {
      const bounds = host.getBoundingClientRect();
      const pixel = new OpenSeadragon.Point(event.clientX - bounds.left, event.clientY - bounds.top);
      const viewportPoint = viewer.viewport.pointFromPixel(pixel);
      const point = viewer.world.getItemAt(0).viewportToImageCoordinates(viewportPoint);
      return {
        x: Math.max(0, Math.min(slide.width, point.x)),
        y: Math.max(0, Math.min(slide.height, point.y)),
      };
    };

    const down = (event) => {
      if (event.button !== 0 || !drawMode) return;
      event.preventDefault();
      event.stopPropagation();
      host.setPointerCapture?.(event.pointerId);
      setSelectedAnnotation(null);

      const pt = getImagePoint(event);
      if (drawMode === 'point') {
        setDraft({ annotation_type: 'point', points: [[pt.x, pt.y]], label: '', note: '', color: '#e85d75', category: 'Pathologist', annotation_status: 'Active' });
        setDrawMode(null);
      } else if (drawMode === 'polygon') {
        if (!drawingState) {
          drawingState = { type: 'polygon', points: [pt] };
        } else {
          drawingState.points.push(pt);
        }
        setDraftGeometry({ ...drawingState, cursor: pt });
      } else if (drawMode === 'freehand') {
        drawingState = { type: 'freehand', points: [pt] };
        setDraftGeometry({ ...drawingState });
      } else if (['rectangle', 'ellipse', 'arrow', 'line'].includes(drawMode)) {
        drawingState = { type: drawMode, points: [pt, pt] };
        setDraftGeometry({ ...drawingState });
      }
    };

    const move = (event) => {
      if (!drawingState || !drawMode) return;
      const pt = getImagePoint(event);

      if (drawMode === 'polygon') {
        setDraftGeometry({ ...drawingState, cursor: pt });
      } else if (drawMode === 'freehand') {
        drawingState.points.push(pt);
        setDraftGeometry({ ...drawingState, points: [...drawingState.points] });
      } else if (['rectangle', 'ellipse', 'arrow', 'line'].includes(drawMode)) {
        drawingState.points[1] = pt;
        setDraftGeometry({ ...drawingState });
      }
    };

    const up = (event) => {
      if (!drawingState || drawMode === 'polygon') return;
      event.preventDefault();
      event.stopPropagation();
      host.releasePointerCapture?.(event.pointerId);

      const pt = getImagePoint(event);
      if (drawMode !== 'freehand') drawingState.points[1] = pt;

      // Complete rectangle or arrow
      const [p1, p2] = drawingState.points;

      let finalGeom = null;
      if (drawMode === 'rectangle' || drawMode === 'ellipse') {
        const x = Math.min(p1.x, p2.x);
        const y = Math.min(p1.y, p2.y);
        const w = Math.abs(p2.x - p1.x);
        const h = Math.abs(p2.y - p1.y);
        if (w >= 1 && h >= 1) {
          finalGeom = { annotation_type: drawMode, x, y, width: w, height: h };
        }
      } else if (drawMode === 'arrow' || drawMode === 'line') {
        const dx = Math.abs(p2.x - p1.x);
        const dy = Math.abs(p2.y - p1.y);
        if (dx >= 1 || dy >= 1) {
          finalGeom = { annotation_type: drawMode, points: [[p1.x, p1.y], [p2.x, p2.y]] };
        }
      } else if (drawMode === 'freehand' && drawingState.points.length >= 2) {
        finalGeom = { annotation_type: 'freehand', points: drawingState.points.map((point) => [point.x, point.y]) };
      }

      if (finalGeom) {
        setDraft({ ...finalGeom, label: '', note: '', color: '#e85d75', category: 'Pathologist', annotation_status: 'Active' });
        setDrawMode(null);
      }

      drawingState = null;
      setDraftGeometry(null);
    };

    const dblclick = (event) => {
      if (drawMode === 'polygon' && drawingState && drawingState.points.length >= 3) {
        event.preventDefault();
        event.stopPropagation();
        let pts = [...drawingState.points];
        // A double-click will register an extra 'down' event immediately before the dblclick.
        // If the last point is very close to the second-to-last, it's a double-click artifact.
        if (pts.length >= 3) {
          const last = pts[pts.length - 1];
          const secondLast = pts[pts.length - 2];
          // Compare in screen pixels to avoid zoom level issues
          const viewer = viewerRef.current;
          const vp1 = viewer.world.getItemAt(0).imageToViewportCoordinates(last.x, last.y);
          const p1 = viewer.viewport.pixelFromPoint(vp1);
          const vp2 = viewer.world.getItemAt(0).imageToViewportCoordinates(secondLast.x, secondLast.y);
          const p2 = viewer.viewport.pixelFromPoint(vp2);
          if (Math.hypot(p1.x - p2.x, p1.y - p2.y) < 5) {
            pts.pop();
          }
        }
        const finalPts = pts.map(p => [p.x, p.y]);
        setDraft({ annotation_type: 'polygon', points: finalPts, label: '', note: '', color: '#e85d75', category: 'Pathologist', annotation_status: 'Active' });
        setDrawMode(null);
        drawingState = null;
        setDraftGeometry(null);
      }
    };

    const keydown = (e) => {
      if (e.key === 'Escape' && drawingState) {
        drawingState = null;
        setDraftGeometry(null);
      }
    };

    host.addEventListener('pointerdown', down, true);
    host.addEventListener('pointermove', move, true);
    host.addEventListener('pointerup', up, true);
    host.addEventListener('dblclick', dblclick, true);
    document.addEventListener('keydown', keydown);

    return () => {
      host.removeEventListener('pointerdown', down, true);
      host.removeEventListener('pointermove', move, true);
      host.removeEventListener('pointerup', up, true);
      host.removeEventListener('dblclick', dblclick, true);
      document.removeEventListener('keydown', keydown);
      if (viewerRef.current === viewer) viewer.setMouseNavEnabled(true);
    };
  }, [drawMode, slide.height, slide.width, viewerReady]);

  // Rotation & Flipping
  const setRotation = useCallback((angle) => {
    const normalized = ((angle % 360) + 360) % 360;
    setRotationAngle(normalized);
    viewerRef.current?.viewport?.setRotation(normalized);
  }, []);

  const rotateBy = useCallback((degrees) => {
    const current = viewerRef.current?.viewport?.getRotation() || 0;
    setRotation(current + degrees);
  }, [setRotation]);

  const toggleFlipH = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer?.viewport) return;
    const next = !flipH;
    setFlipH(next);
    if (viewer.viewport.setFlip) {
      viewer.viewport.setFlip(next);
    }
  }, [flipH]);

  const toggleFlipV = useCallback(() => {
    setFlipV((v) => !v);
  }, []);

  const resetFlip = useCallback(() => {
    setFlipH(false);
    setFlipV(false);
    if (viewerRef.current?.viewport?.setFlip) {
      viewerRef.current.viewport.setFlip(false);
    }
  }, []);

  const fit = useCallback(() => {
    viewerRef.current?.viewport?.goHome(true);
  }, []);

  const reset = useCallback(() => {
    fit();
    setRotation(0);
    resetFlip();
    setBrightness(100);
    setContrast(100);
    setGamma(1.0);
    setDisplayProfile('standard');
  }, [fit, setRotation, resetFlip]);

  const toggleMinimap = useCallback(() => {
    const viewer = viewerRef.current;
    const next = !minimapVisible;
    setMinimapVisible(next);
    if (viewer?.navigator) {
      if (next) viewer.navigator.element.style.display = '';
      else viewer.navigator.element.style.display = 'none';
    }
  }, [minimapVisible]);

  const toggleTrail = useCallback(() => {
    setTrailVisible((t) => !t);
  }, []);

  const clearCurrentTrail = useCallback(async () => {
    try {
      await viewerService.clearTrail(slide.id);
      setCoverageBoxes([]);
    } catch (error) {
      onError(`Could not clear review trail: ${error.message}`);
    }
  }, [slide.id, onError]);

  const zoomBy = (factor) => viewerRef.current?.viewport?.zoomBy(factor);
  const retrySlide = () => { setLoadFailure(''); viewerRef.current?.open(slide.dzi_url?.startsWith('/') && API ? `${API}${slide.dzi_url}` : slide.dzi_url); };

  const saveBookmark = async () => {
    const viewport = viewerRef.current?.viewport;
    if (!viewport) return;
    const bounds = viewport.getBounds(true);
    const name = `Viewpoint ${bookmarks.length + 1}`;
    try {
      const saved = await viewerService.createBookmark(slide.id, {
        name,
        viewport_x: bounds.x,
        viewport_y: bounds.y,
        viewport_width: bounds.width,
        viewport_height: bounds.height,
        rotation: viewport.getRotation() || 0,
        flip_h: flipH,
        flip_v: flipV,
        brightness,
        contrast,
        gamma,
        annotations_visible: visible,
        minimap_visible: minimapVisible,
      });
      setBookmarks((current) => [saved, ...current]);
    } catch (error) { onError(`Could not save viewpoint: ${error.message}`); }
  };

  const openBookmark = (bookmark) => {
    const viewport = viewerRef.current?.viewport;
    if (!viewport) return;
    if (bookmark.rotation !== undefined) setRotation(bookmark.rotation);
    if (bookmark.flip_h !== undefined) {
      setFlipH(Boolean(bookmark.flip_h));
      if (viewport.setFlip) viewport.setFlip(Boolean(bookmark.flip_h));
    }
    if (bookmark.flip_v !== undefined) setFlipV(Boolean(bookmark.flip_v));
    if (bookmark.brightness !== undefined) setBrightness(bookmark.brightness);
    if (bookmark.contrast !== undefined) setContrast(bookmark.contrast);
    if (bookmark.gamma !== undefined) setGamma(bookmark.gamma);
    if (bookmark.annotations_visible !== undefined) setVisible(Boolean(bookmark.annotations_visible));
    if (bookmark.minimap_visible !== undefined) {
      setMinimapVisible(Boolean(bookmark.minimap_visible));
      if (viewerRef.current?.navigator) {
        viewerRef.current.navigator.element.style.display = bookmark.minimap_visible ? '' : 'none';
      }
    }
    viewport.fitBounds(new OpenSeadragon.Rect(bookmark.viewport_x, bookmark.viewport_y, bookmark.viewport_width, bookmark.viewport_height), true);
  };

  const renameBookmark = async (bookmarkId, name) => {
    try {
      const updated = await viewerService.renameBookmark(slide.id, bookmarkId, name);
      setBookmarks((current) => current.map((bm) => (bm.id === bookmarkId ? updated : bm)));
    } catch (error) {
      onError(`Could not rename viewpoint: ${error.message}`);
    }
  };

  const removeBookmark = async (bookmark) => {
    try {
      await viewerService.deleteBookmark(slide.id, bookmark.id);
      setBookmarks((current) => current.filter((item) => item.id !== bookmark.id));
    } catch (error) { onError(`Could not delete viewpoint: ${error.message}`); }
  };

  useEffect(() => {
    const beforeUnload = (event) => {
      if (!draft && !editing) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [draft, editing]);

  useEffect(() => {
    const keydown = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && draft) { event.preventDefault(); setRedoDraft(draft); setDraft(null); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y' && redoDraft) { event.preventDefault(); setDraft(redoDraft); setRedoDraft(null); return; }

      const panStep = 0.15; // Viewport fraction
      const panBy = (dx, dy) => {
        const viewport = viewerRef.current?.viewport;
        if (!viewport) return;
        const currentCenter = viewport.getCenter(true);
        const bounds = viewport.getBounds(true);
        viewport.panTo(new OpenSeadragon.Point(
          currentCenter.x + dx * bounds.width * panStep,
          currentCenter.y + dy * bounds.height * panStep
        ), true);
      };

      const actions = {
        '+': () => zoomBy(1.25),
        '=': () => zoomBy(1.25),
        '-': () => zoomBy(0.8),
        '_': () => zoomBy(0.8),
        '0': reset,
        'f': fit,
        'r': () => rotateBy(event.shiftKey ? -90 : 90),
        'h': toggleFlipH,
        'v': toggleFlipV,
        'm': toggleMinimap,
        't': toggleTrail,
        'a': () => setVisible((v) => !v),
        'b': saveBookmark,
        'arrowup': () => panBy(0, -1),
        'arrowdown': () => panBy(0, 1),
        'arrowleft': () => panBy(-1, 0),
        'arrowright': () => panBy(1, 0),
        '1': () => setDrawMode(null),              // 1: Pan / Inspect
        '2': () => setDrawMode('point'),           // 2: Point Marker
        '3': () => setDrawMode('rectangle'),       // 3: Rectangle Region
        '4': () => setDrawMode('polygon'),         // 4: Polygon Region
        '5': () => setDrawMode('line'),            // 5: Line Measurement
      };

      const key = event.key.toLowerCase();
      const action = actions[key];
      if (action) {
        event.preventDefault();
        action();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => document.removeEventListener('keydown', keydown);
  }, [draft, redoDraft, fit, reset, rotateBy, toggleFlipH, toggleFlipV, toggleMinimap, toggleTrail, saveBookmark]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen();
      else await workspaceRef.current?.requestFullscreen();
    } catch (error) {
      onError(`Could not change fullscreen mode: ${error.message}`);
    }
  };
  const goTo = (annotation) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    let rect;
    if (annotation.annotation_type === 'rectangle' && annotation.width) {
      rect = new OpenSeadragon.Rect(annotation.x, annotation.y, annotation.width, annotation.height);
    } else if (annotation.points && Array.isArray(annotation.points) && annotation.points.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      annotation.points.forEach(([x, y]) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      });
      rect = new OpenSeadragon.Rect(minX, minY, maxX - minX, maxY - minY);
    }

    if (rect) {
      const item = viewer.world.getItemAt(0);
      const vpRect = item.imageToViewportRectangle(rect);
      viewer.viewport.fitBounds(vpRect, true);
    }
  };

  const selectAnnotation = (annotation) => {
    setSelectedAnnotation(annotation);
    goTo(annotation);
  };

  const panToRoi = useCallback((roi) => {
    const viewer = viewerRef.current;
    if (!viewer || !roi) return;
    const rx = roi.x ?? roi.roi_x;
    const ry = roi.y ?? roi.roi_y;
    const rw = roi.width ?? roi.roi_width ?? 256;
    const rh = roi.height ?? roi.roi_height ?? 256;
    if (rx == null || ry == null) return;
    const rect = new OpenSeadragon.Rect(rx, ry, rw, rh);
    const item = viewer.world?.getItemAt(0);
    if (!item) return;
    viewer.viewport.fitBounds(item.imageToViewportRectangle(rect), false);
  }, []);

  const focusMitoticCandidate = useCallback((candidate) => {
    const pos = getMitoticPosition(candidate);
    const viewer = viewerRef.current;
    const item = viewer?.world?.getItemAt(0);
    if (!pos || !item || !viewer?.viewport) return;
    setSelectedMitoticCandidate(candidate);
    const p = item.imageToViewportCoordinates(pos.x, pos.y);
    viewer.viewport.panTo(p, false);
    const targetZoom = item.imageToViewportZoom(2);
    if (Number.isFinite(targetZoom) && targetZoom > 0) {
      viewer.viewport.zoomTo(Math.max(viewer.viewport.getZoom(), targetZoom), p, false);
    }
  }, []);

  async function saveNew(event) {
    event.preventDefault();
    setSaving(true);
    const details = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const data = await viewerService.createAnnotation(slide.id, { ...draft, ...details });
      setAnnotations((current) => [...current, data]);
      setDraft(null);
      setSelectedAnnotation(data);
    } catch (error) { onError(`Could not save annotation: ${error.message}`); }
    finally { setSaving(false); }
  }

  async function saveEdit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const details = Object.fromEntries(new FormData(event.currentTarget));
      const data = await viewerService.updateAnnotation(slide.id, editing.id, {
        ...details,
        x: editing.x, y: editing.y, width: editing.width, height: editing.height, points: editing.points,
      });
      setAnnotations((current) => current.map((item) => item.id === data.id ? data : item));
      setEditing(null);
      setSelectedAnnotation(data);
    } catch (error) { onError(`Could not update annotation: ${error.message}`); }
    finally { setSaving(false); }
  }

  async function remove(annotation) {
    try {
      await viewerService.deleteAnnotation(slide.id, annotation.id);
      setAnnotations((current) => current.filter((item) => item.id !== annotation.id));
      if (editing?.id === annotation.id) setEditing(null);
      if (selectedAnnotation?.id === annotation.id) setSelectedAnnotation(null);
      setDeleteTarget(null);
    } catch (error) { onError(`Could not delete annotation: ${error.message}`); }
  }


  const renderShape = (geom, color, isDraft) => {
    if (geom.annotation_type === 'point' || geom.type === 'point') {
      const point = isDraft ? geom.points[0] : { x: geom.points[0][0], y: geom.points[0][1] };
      const pixel = imageToViewport(point.x, point.y);
      return <circle cx={pixel.x} cy={pixel.y} r="6" fill={color} stroke="var(--text-inverse)" strokeWidth="2" />;
    } else if (['rectangle', 'ellipse'].includes(geom.annotation_type || geom.type)) {
      let x, y, w, h;
      if (isDraft) {
        x = Math.min(geom.points[0].x, geom.points[1].x);
        y = Math.min(geom.points[0].y, geom.points[1].y);
        w = Math.abs(geom.points[1].x - geom.points[0].x);
        h = Math.abs(geom.points[1].y - geom.points[0].y);
      } else {
        x = geom.x; y = geom.y; w = geom.width; h = geom.height;
      }
      const p1 = imageToViewport(x, y);
      const p2 = imageToViewport(x + w, y + h);
      if ((geom.annotation_type || geom.type) === 'ellipse') return <ellipse cx={(p1.x + p2.x) / 2} cy={(p1.y + p2.y) / 2} rx={Math.abs(p2.x - p1.x) / 2} ry={Math.abs(p2.y - p1.y) / 2} fill={`${color}33`} stroke={color} strokeWidth="2" />;
      return <rect x={p1.x} y={p1.y} width={p2.x - p1.x} height={p2.y - p1.y} fill={`${color}33`} stroke={color} strokeWidth="2" />;
    } else if (geom.annotation_type === 'polygon' || geom.type === 'polygon') {
      let pts;
      if (isDraft) {
        pts = [...geom.points, geom.cursor].filter(Boolean).map(p => imageToViewport(p.x, p.y));
      } else {
        pts = geom.points.map(p => imageToViewport(p[0], p[1]));
      }
      const ptStr = pts.map(p => `${p.x},${p.y}`).join(' ');
      return <polygon points={ptStr} fill={`${color}33`} stroke={color} strokeWidth="2" strokeDasharray={isDraft ? "5,5" : "none"} />;
    } else if (['line', 'freehand'].includes(geom.annotation_type || geom.type)) {
      const pts = geom.points.map((point) => isDraft ? imageToViewport(point.x, point.y) : imageToViewport(point[0], point[1]));
      return <polyline points={pts.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />;
    } else if (geom.annotation_type === 'arrow' || geom.type === 'arrow') {
      let p1, p2;
      if (isDraft) {
        p1 = imageToViewport(geom.points[0].x, geom.points[0].y);
        p2 = imageToViewport(geom.points[1].x, geom.points[1].y);
      } else {
        p1 = imageToViewport(geom.points[0][0], geom.points[0][1]);
        p2 = imageToViewport(geom.points[1][0], geom.points[1][1]);
      }
      return <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth="3" markerEnd={`url(#arrowhead-${isDraft ? 'draft' : geom.id})`} />;
    }
  };

  const imagePointFromPointer = (event) => {
    const viewer = viewerRef.current;
    const host = svgOverlayRef.current;
    const item = viewer?.world?.getItemAt(0);
    if (!viewer?.viewport || !host || !item) return null;
    const bounds = host.getBoundingClientRect();
    const viewportPoint = viewer.viewport.pointFromPixel(new OpenSeadragon.Point(event.clientX - bounds.left, event.clientY - bounds.top));
    const point = item.viewportToImageCoordinates(viewportPoint);
    return { x: Math.max(0, Math.min(slide.width, point.x)), y: Math.max(0, Math.min(slide.height, point.y)) };
  };

  const beginResize = (event, corner) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResizeState({ corner });
    viewerRef.current?.setMouseNavEnabled(false);
  };

  const resizeAnnotation = (event) => {
    if (!resizeState || !editing) return;
    const point = imagePointFromPointer(event);
    if (!point) return;
    const right = editing.x + editing.width;
    const bottom = editing.y + editing.height;
    const nextX = resizeState.corner.includes('w') ? Math.min(point.x, right - 1) : editing.x;
    const nextY = resizeState.corner.includes('n') ? Math.min(point.y, bottom - 1) : editing.y;
    const nextRight = resizeState.corner.includes('e') ? Math.max(point.x, editing.x + 1) : right;
    const nextBottom = resizeState.corner.includes('s') ? Math.max(point.y, editing.y + 1) : bottom;
    setEditing((current) => ({ ...current, x: nextX, y: nextY, width: nextRight - nextX, height: nextBottom - nextY }));
  };

  const finishResize = (event) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setResizeState(null);
    viewerRef.current?.setMouseNavEnabled(!drawMode);
  };

  const renderResizeHandles = () => {
    if (!editing || !['rectangle', 'ellipse'].includes(editing.annotation_type)) return null;
    const corners = [
      ['nw', editing.x, editing.y], ['ne', editing.x + editing.width, editing.y],
      ['sw', editing.x, editing.y + editing.height], ['se', editing.x + editing.width, editing.y + editing.height],
    ];
    return corners.map(([corner, x, y]) => {
      const point = imageToViewport(x, y);
      return <circle key={corner} className={`annotation-resize-handle annotation-resize-handle--${corner}`} cx={point.x} cy={point.y} r="6" onPointerDown={(event) => beginResize(event, corner)} onPointerMove={resizeAnnotation} onPointerUp={finishResize} onPointerCancel={finishResize} />;
    });
  };

  const calibration = validation?.physical_calibration;
  const pixelSize = calibration?.available ? calibration.pixel_size_microns_x : null;
  const magnification = validation?.normalized_metadata?.magnification;
  const measurementLabel = (annotation) => pixelSize && annotation.annotation_type === 'rectangle'
    ? `${(annotation.width * pixelSize).toFixed(1)} × ${(annotation.height * pixelSize).toFixed(1)} µm`
    : null;
  const showAnnotationMeasurement = (annotation) => setHoveredAnnotation(annotation);
  const aiMeasurementTarget = (result) => ({
    ...result.geometry,
    annotation_type: result.geometry.annotation_type || result.geometry.type?.toLowerCase(),
    label: `${result.model_name} ${result.model_version}`,
    measurementSource: 'AI-generated region',
  });
  const canCalibrate = ['Laboratory Manager', SYSTEM_ADMIN_ROLE, SUPER_ADMIN_ROLE].includes(user?.role);
  const filteredAnnotations = annotations;
  const liveMeasurements = getAnnotationMeasurements(normalizeDraftForMeasurement(draftGeometry), calibration);
  const saveCalibration = async (event) => {
    event.preventDefault();
    if (calibrationSaving) return;
    const form = event.currentTarget;
    setCalibrationSaving(true);
    try {
      const updated = await viewerService.saveCalibration(slide.id, {
        pixel_size_microns_x: Number(form.elements.pixel_size_microns_x.value),
        pixel_size_microns_y: Number(form.elements.pixel_size_microns_y.value),
        reason: form.elements.reason.value,
      });
      setValidation(updated);
    } catch (error) {
      onError(`Could not save slide calibration: ${error.message}`);
    } finally {
      setCalibrationSaving(false);
    }
  };

  return (
    <div className={`wsi-annotation-workspace${fullscreen ? ' is-fullscreen' : ''}`} ref={workspaceRef}>
      <svg className="viewer-filter-definitions" aria-hidden="true">
        <defs>
          <filter id="wsi-red-channel" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" /></filter>
          <filter id="wsi-green-channel" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" /></filter>
          <filter id="wsi-blue-channel" colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" /></filter>
          <filter id="wsi-gamma-filter">
            <feComponentTransfer>
              <feFuncR type="gamma" amplitude="1" exponent={gamma ? 1 / gamma : 1} />
              <feFuncG type="gamma" amplitude="1" exponent={gamma ? 1 / gamma : 1} />
              <feFuncB type="gamma" amplitude="1" exponent={gamma ? 1 / gamma : 1} />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      <div className="viewer-canvas-container">
        <ViewerToolbar
          onZoomIn={() => zoomBy(1.25)}
          onZoomOut={() => zoomBy(0.8)}
          onFit={fit}
          onReset={reset}
          onRotateCw={() => rotateBy(90)}
          onRotateCcw={() => rotateBy(-90)}
          onRotate180={() => rotateBy(180)}
          rotation={rotationAngle}
          onFlipH={toggleFlipH}
          onFlipV={toggleFlipV}
          onResetFlip={resetFlip}
          flipH={flipH}
          flipV={flipV}
          showAdjustments={showAdjustments}
          onToggleAdjustments={() => setShowAdjustments((s) => !s)}
          showDip={showDip}
          onToggleDip={() => setShowDip((open) => !open)}
          brightness={brightness}
          contrast={contrast}
          gamma={gamma}
          minimapVisible={minimapVisible}
          onToggleMinimap={toggleMinimap}
          trailVisible={trailVisible}
          onToggleTrail={toggleTrail}
          annotationsVisible={visible}
          onToggleAnnotations={() => setVisible((v) => !v)}
          onSaveViewpoint={saveBookmark}
          showViewpoints={showViewpointsModal}
          onToggleViewpoints={() => setShowViewpointsModal((m) => !m)}
          onOpenRegistration={onOpenRegistration}
          onOpenCompare={onOpenCompare}
          canRegister={Boolean(onOpenRegistration)}
          fullscreen={fullscreen}
          onToggleFullscreen={toggleFullscreen}
          onOpenShortcuts={() => setShowShortcutsModal(true)}
          drawMode={drawMode}
          setDrawMode={setDrawMode}
        />

        <div
          className={`wsi-stage display-${displayProfile} ${flipV ? 'flip-v-active' : ''}`}
          data-brightness={brightness}
          data-contrast={contrast}
        >
          <div className={`wsi-viewer ${drawMode ? 'drawing-mode' : ''}`} ref={elementRef} aria-label={`Whole-slide viewer for ${slide.label}`} />
          {dipResult?.algorithm === 'clahe' && dipView === 'comparison' && dipVisible && (
            <div
              className="clahe-divider"
              style={{ left: `${claheSplit * 100}%` }}
              role="slider"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(claheSplit * 100)}
              aria-label="Original and enhanced comparison divider"
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                event.stopPropagation();
              }}
              onPointerMove={(event) => {
                if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
                const bounds = event.currentTarget.parentElement.getBoundingClientRect();
                const next = (event.clientX - bounds.left) / bounds.width;
                setClaheSplit(Math.min(0.95, Math.max(0.05, next)));
              }}
            />
          )}
          {claheNote && <p className="clahe-note">{claheNote}</p>}

          <ViewerTrail
            visible={trailVisible}
            boxes={coverageBoxes}
            imageToViewport={imageToViewport}
            onClear={clearCurrentTrail}
          />

          {showAdjustments && (
            <ViewerDisplaySettings
              brightness={brightness}
              setBrightness={setBrightness}
              contrast={contrast}
              setContrast={setContrast}
              gamma={gamma}
              setGamma={setGamma}
              displayProfile={displayProfile}
              setDisplayProfile={setDisplayProfile}
              profiles={DISPLAY_PROFILES}
              onReset={() => {
                setBrightness(100);
                setContrast(100);
                setGamma(1.0);
                setDisplayProfile('standard');
              }}
              onSavePreferences={saveCurrentPreferences}
              saving={prefSaving}
              onClose={() => setShowAdjustments(false)}
            />
          )}
          {showDip && (
            <DipProcessingPanel
              slideId={slide.id}
              roiRect={roiRect}
              visible={dipVisible}
              opacity={dipOpacity}
              view={dipView}
              onViewChange={setDipView}
              onVisibleChange={setDipVisible}
              onOpacityChange={setDipOpacity}
              onResult={(next) => setDipResult((current) => {
                Object.values(current?.views || {}).forEach((url) => {
                  if (!Object.values(next.views || {}).includes(url)) URL.revokeObjectURL(url);
                });
                return next;
              })}
              onClear={() => setDipResult((current) => {
                Object.values(current?.views || {}).forEach((url) => URL.revokeObjectURL(url));
                return null;
              })}
              onClose={() => setShowDip(false)}
            />
          )}

          <svg ref={svgOverlayRef} className={`annotation-svg-overlay ${drawMode ? 'drawing-active' : ''}`}>
            <defs>
              <marker id="arrowhead-draft" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#e85d75" />
              </marker>
              {visible && filteredAnnotations.map(a => (
                <marker key={`marker-${a.id}`} id={`arrowhead-${a.id}`} markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill={a.color} />
                </marker>
              ))}
            </defs>
            {aiAnalysis?.feature_code === 'CAMELYON_TUMOR_DETECTION' &&
              camelyonHeatmapUrl &&
              camelyonVisible &&
              viewerReady &&
              aiAnalysis.roi &&
              (() => {
                const roi = aiAnalysis.roi;

                const x = roi.x ?? roi.roi_x;
                const y = roi.y ?? roi.roi_y;
                const width = roi.width ?? roi.roi_width;
                const height = roi.height ?? roi.roi_height;

                if (![x, y, width, height].every(Number.isFinite)) {
                  return null;
                }

                const topLeft = imageToViewport(x, y);
                const topRight = imageToViewport(x + width, y);
                const bottomLeft = imageToViewport(x, y + height);
                if (![topLeft, topRight, bottomLeft].every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))) {
                  return null;
                }
                const edgeX = topRight.x - topLeft.x;
                const edgeY = topRight.y - topLeft.y;
                const downX = bottomLeft.x - topLeft.x;
                const downY = bottomLeft.y - topLeft.y;
                const screenWidth = Math.hypot(edgeX, edgeY);
                const screenHeight = Math.hypot(downX, downY);
                const angle = Math.atan2(edgeY, edgeX) * 180 / Math.PI;
                const flippedVertically = (edgeX * downY) - (edgeY * downX) < 0;

                return (
                  <image
                    href={camelyonHeatmapUrl}
                    x="0"
                    y="0"
                    width={screenWidth}
                    height={screenHeight}
                    opacity={camelyonOpacity}
                    preserveAspectRatio="none"
                    pointerEvents="none"
                    transform={`translate(${topLeft.x} ${topLeft.y}) rotate(${angle})${flippedVertically ? ' scale(1 -1)' : ''}`}
                  />
                );
              })()}
            {dipView !== 'original' && dipVisible && viewerReady && dipResult?.roi && (() => {
              const useTiles = dipResult.algorithm === 'clahe' && dipResult.mode === 'whole_slide' && !claheOverview;
              const singleHref = dipView === 'comparison'
                ? (dipResult.views?.enhanced || dipResult.overlayUrl)
                : (dipResult.views?.[dipView] || dipResult.overlayUrl);
              if (!useTiles && !singleHref) return null;
              const pieces = useTiles ? claheTiles : [{ x: Number(dipResult.roi.x), y: Number(dipResult.roi.y), width: Number(dipResult.roi.width), height: Number(dipResult.roi.height), url: singleHref }];
              const images = pieces.map((piece) => {
                const x = Number(piece.x);
                const y = Number(piece.y);
                const width = Number(piece.width);
                const height = Number(piece.height);
                if (![x, y, width, height].every(Number.isFinite) || !piece.url) return null;
                const topLeft = imageToViewport(x, y);
                const topRight = imageToViewport(x + width, y);
                const bottomLeft = imageToViewport(x, y + height);
                if (![topLeft, topRight, bottomLeft].every((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))) return null;
                const edgeX = topRight.x - topLeft.x;
                const edgeY = topRight.y - topLeft.y;
                const downX = bottomLeft.x - topLeft.x;
                const downY = bottomLeft.y - topLeft.y;
                const angle = Math.atan2(edgeY, edgeX) * 180 / Math.PI;
                const flippedVertically = (edgeX * downY) - (edgeY * downX) < 0;
                return (
                  <image
                    key={`${x}-${y}-${width}-${height}`}
                    href={piece.url}
                    x="0"
                    y="0"
                    width={Math.hypot(edgeX, edgeY)}
                    height={Math.hypot(downX, downY)}
                    opacity={dipOpacity}
                    preserveAspectRatio="none"
                    pointerEvents="none"
                    transform={`translate(${topLeft.x} ${topLeft.y}) rotate(${angle})${flippedVertically ? ' scale(1 -1)' : ''}`}
                  />
                );
              });
              if (dipResult.algorithm === 'clahe' && dipView === 'comparison') {
                return (
                  <g clipPath="url(#clahe-split)">
                    {images}
                  </g>
                );
              }
              return images;
            })()}
            {dipResult?.algorithm === 'clahe' && dipView === 'comparison' && dipVisible && (
              <defs>
                <clipPath id="clahe-split" clipPathUnits="userSpaceOnUse">
                  <rect x={(svgOverlayRef.current?.clientWidth || 0) * claheSplit} y="0" width="100000" height="100000" />
                </clipPath>
              </defs>
            )}
            <GrandQCOverlay
              geojson={qcGeojson}
              imageToViewport={imageToViewport}
              hiddenClasses={qcHiddenClasses}
              visible={qcVisible && qcModeActive && viewerReady}
              onSelect={setQcSelectedRegion}
            />
            {visible && filteredAnnotations.map((annotation) => (
              <g
                key={annotation.id}
                className={`annotation-shape ${selectedAnnotation?.id === annotation.id ? 'annotation-shape--selected' : ''}`}
                onClick={() => selectAnnotation(annotation)}
                onPointerEnter={() => showAnnotationMeasurement({ ...annotation, measurementSource: 'Human annotation' })}
                onPointerLeave={() => setHoveredAnnotation(null)}
              >
                <title>{annotation.label}</title>
                {renderShape(editing?.id === annotation.id ? editing : annotation, annotation.color, false)}
              </g>
            ))}
            {renderResizeHandles()}
            {aiVisible && aiResults.map((result) => result.geometry && <g key={`ai-${result.id}`} className="ai-result-shape" onPointerEnter={() => showAnnotationMeasurement(aiMeasurementTarget(result))} onPointerLeave={() => setHoveredAnnotation(null)}><title>{`${result.model_name} ${result.model_version}${result.confidence == null ? '' : ` · ${(result.confidence * 100).toFixed(1)}%`}`}</title>{renderShape({ ...result.geometry, id: `ai-${result.id}` }, '#d39a3c', false)}</g>)}
            {/* ── HoVer-Net nucleus contours ───────────────────────────────── */}
            {/* ── HoVer-Net AI Analyzed ROI Boundary ─────────────────────── */}
            {aiAnalysis?.roi && viewerReady && (() => {
              const rx = aiAnalysis.roi.x ?? aiAnalysis.roi.roi_x;
              const ry = aiAnalysis.roi.y ?? aiAnalysis.roi.roi_y;
              const rw = aiAnalysis.roi.width ?? aiAnalysis.roi.roi_width ?? 256;
              const rh = aiAnalysis.roi.height ?? aiAnalysis.roi.roi_height ?? 256;
              if (rx == null || ry == null) return null;
              const p1 = imageToViewport(rx, ry);
              const p2 = imageToViewport(rx + rw, ry + rh);
              const boxW = p2.x - p1.x;
              const boxH = p2.y - p1.y;
              return (
                <g className="ai-roi-boundary">
                  <rect
                    x={p1.x}
                    y={p1.y}
                    width={boxW}
                    height={boxH}
                    fill="rgba(99, 102, 241, 0.08)"
                    stroke="#6366f1"
                    strokeWidth="2.5"
                    strokeDasharray="6 4"
                  />
                  <g transform={`translate(${p1.x}, ${Math.max(16, p1.y - 6)})`}>
                    <rect
                      x="0"
                      y="-14"
                      width="150"
                      height="18"
                      rx="3"
                      fill="#4f46e5"
                    />
                    <text
                      x="6"
                      y="-1"
                      fill="#ffffff"
                      fontSize="11"
                      fontFamily="var(--font-sans, system-ui)"
                      fontWeight="600"
                    >
                      AI Analyzed ROI (#{aiAnalysis.id})
                    </text>
                  </g>
                </g>
              );
            })()}
            {/* ── KongNet mitotic figure candidates ─────────────────────────── */}
            {isKongNetAnalysis(aiAnalysis) && viewerReady &&
              (aiAnalysis.detections ?? aiAnalysis.predictions?.detections ?? []).map((det, index) => {
                const pos = getMitoticPosition(det);
                if (!pos) return null;
                const screen = imageToViewport(pos.x, pos.y);
                const selected = selectedMitoticCandidate === det ||
                  (selectedMitoticCandidate?.id != null && selectedMitoticCandidate.id === det.id);
                const score = det.score ?? det.probability ?? det.confidence;
                return (
                  <g key={`mitotic-${det.id ?? index}`} className="ai-mitotic-marker"
                    onClick={(event) => { event.stopPropagation(); focusMitoticCandidate(det); }}>
                    <title>{`Candidate ${det.id ?? index + 1}${score == null ? '' : ` · model score ${Number(score).toFixed(3)}`}`}</title>
                    <circle cx={screen.x} cy={screen.y} r={selected ? 12 : 9}
                      className={selected ? 'ai-mitotic-ring ai-mitotic-ring--selected' : 'ai-mitotic-ring'} />
                    <path d={`M ${screen.x - 15} ${screen.y} h 8 M ${screen.x + 7} ${screen.y} h 8 M ${screen.x} ${screen.y - 15} v 8 M ${screen.x} ${screen.y + 7} v 8`}
                      className="ai-mitotic-crosshair" />
                  </g>
                );
              })}
            {!isKongNetAnalysis(aiAnalysis) && aiAnalysis?.nuclei && viewerReady && aiAnalysis.nuclei.map((nuc) => {
              const cls = PANNUKE_CLASSES.find((c) => c.key === nuc.type) || { color: '#6366f1' };
              if (aiHiddenClasses.has(nuc.type)) return null;
              if (!nuc.contour || nuc.contour.length < 3) return null;
              // contour points are [x, y] in level-0 image coords
              const pixelPts = nuc.contour.map(([cx, cy]) => imageToViewport(cx, cy));
              const ptStr = pixelPts.map((p) => `${p.x},${p.y}`).join(' ');
              const isSelected = aiSelectedNucleus?.id === nuc.id;
              return (
                <g
                  key={`nuc-${nuc.id}`}
                  className="ai-nucleus-contour"
                  onPointerEnter={(e) => {
                    const bounds = svgOverlayRef.current?.getBoundingClientRect();
                    if (bounds) setNucleusTooltip({ x: e.clientX - bounds.left, y: e.clientY - bounds.top, nuc });
                  }}
                  onPointerLeave={() => setNucleusTooltip(null)}
                  onClick={() => { setAiSelectedNucleus(nuc); setNucleusTooltip(null); }}
                >
                  <polygon
                    points={ptStr}
                    fill={`${cls.color}22`}
                    stroke={cls.color}
                    strokeWidth={isSelected ? 2.5 : 1.5}
                    strokeOpacity={isSelected ? 1 : 0.82}
                  />
                </g>
              );
            })}
            {draftGeometry && renderShape(draftGeometry, '#e85d75', true)}
          </svg>
          {qcSelectedRegion && qcVisible && qcModeActive && (
            <div className="grandqc-selected-region" role="status">
              <span>GrandQC: {qcSelectedRegion.type} · Region {qcSelectedRegion.index + 1}</span>
              <button type="button" onClick={() => setQcSelectedRegion(null)} aria-label="Close GrandQC region details">×</button>
            </div>
          )}
          {hoveredAnnotation && <div className="annotation-hover-measurement" role="tooltip">
            <header><strong>{hoveredAnnotation.label || 'Selected region'}</strong><span>{hoveredAnnotation.measurementSource}</span></header>
            {getAnnotationHoverMeasurements(hoveredAnnotation, calibration).map((measurement) => <div key={measurement.label}>
              <span>{measurement.label}</span>
              <output>{measurement.metric}</output>
              {measurement.imperial && <output>{measurement.imperial}</output>}
            </div>)}
          </div>}
          {/* ── Nucleus hover tooltip ─────────────────────────────────── */}
          {nucleusTooltip && (() => {
            const { x, y, nuc } = nucleusTooltip;
            const cls = PANNUKE_CLASSES.find((c) => c.key === nuc.type) || { color: '#6366f1', label: nuc.type };
            return (
              <div className="ai-nucleus-tooltip" style={{ top: y + 12, left: x + 10 }} role="tooltip">
                <strong style={{ color: cls.color }}>{cls.label || nuc.type}</strong>
                Conf: {nuc.type_prob != null ? `${(nuc.type_prob * 100).toFixed(1)}%` : '—'}
                {' · '}Area: {nuc.area != null ? `${nuc.area.toFixed(0)} px²` : '—'}
              </div>
            );
          })()}
          {draftGeometry && liveMeasurements.length > 0 && <div className="annotation-live-measurement" role="status">
            <strong>Live measurement</strong>
            {liveMeasurements.map((measurement) => <span key={measurement.label}>{measurement.label}: {measurement.value}</span>)}
          </div>}
          {scaleBar && <div className="viewer-scale-bar" aria-label={`Image scale ${scaleBar.label}`}>
            <span>{scaleBar.label}</span><svg width={scaleBar.width} height="8" aria-hidden="true"><path d={`M 1 1 V 7 M 1 6 H ${scaleBar.width - 1} M ${scaleBar.width - 1} 1 V 7`} /></svg>
          </div>}
        </div>

        {!viewerReady && !loadFailure && <div className="viewer-loading"><span className="loading-spinner" /> Loading low-resolution preview and slide tiles…</div>}
        {loadFailure && <div className="viewer-load-error" role="alert"><strong>Slide loading degraded</strong><span>{loadFailure} Your annotations remain saved.</span><button type="button" className="btn-control-secondary" onClick={retrySlide}><RefreshCw size={15} /> Retry</button></div>}
        <div className="viewer-status-strip"><span>{magnification ? `${magnification}× source` : 'Magnification unavailable'}</span><span>{pixelSize ? `${pixelSize.toFixed(4)} µm/px calibrated` : 'Physical scale unavailable — pixel measurements only'}</span><span>{validation?.level_count || slide.level_count || 1} pyramid levels</span></div>
      </div>

      <aside className={`annotation-panel annotation-panel--${inspectorTab}`}>
        <Tabs
          className="findings-tabs"
          ariaLabel="Viewer findings"
          value={inspectorTab}
          onChange={setInspectorTab}
          items={[{ value: 'findings', label: 'Findings' }, { value: 'ai', label: 'AI insights' }]}
        />

        {inspectorTab === 'findings' && <section className="selected-findings"><div><strong>Selected findings ({annotations.length})</strong><button type="button" className="btn-control-secondary" onClick={() => setDrawMode('rectangle')}>＋ Add</button></div>{selectedAnnotation ? <><p><span className="finding-dot" />{selectedAnnotation.label || 'Selected region'}</p><dl className="finding-details"><div><dt>Type</dt><dd>{selectedAnnotation.category || selectedAnnotation.annotation_type || 'Annotation'}</dd></div><div><dt>Description</dt><dd>{selectedAnnotation.note || 'No description recorded.'}</dd></div><div><dt>Coordinates</dt><dd>{selectedAnnotation.x != null ? `${Math.round(selectedAnnotation.x)}, ${Math.round(selectedAnnotation.y)}` : 'Path region'}</dd></div>{selectedAnnotation.width && <div><dt>Size</dt><dd>{Math.round(selectedAnnotation.width)} × {Math.round(selectedAnnotation.height)} px</dd></div>}</dl></> : <small>Select an annotation or draw a region to add a finding.</small>}</section>}
        {!calibration?.available && <section className="viewer-calibration" aria-label="Physical calibration">
          <div><h3>Physical size calibration</h3><p>Required to display actual tumor size.</p></div>
          {canCalibrate ? <form onSubmit={saveCalibration}>
            <label>Horizontal µm/px<input name="pixel_size_microns_x" type="number" min="0.0001" max="1000" step="any" required placeholder="Example: 0.25" /></label>
            <label>Vertical µm/px<input name="pixel_size_microns_y" type="number" min="0.0001" max="1000" step="any" required placeholder="Example: 0.25" /></label>
            <label>Calibration source / reason<input name="reason" required minLength="3" maxLength="2000" placeholder="Scanner specification or stage micrometer" /></label>
            <button className="btn-primary" disabled={calibrationSaving}>{calibrationSaving ? 'Saving…' : 'Apply calibration'}</button>
          </form> : <p className="viewer-calibration-notice">Ask a Laboratory Manager or System Administrator to enter the scanner’s verified µm/px value.</p>}
        </section>}
        <div className="annotation-panel-heading">
          <div>
            <h3>Annotations</h3>
            <span>{annotations.length} items</span>
          </div>
          <div className="annotation-panel__exports">
            <a
              href={`${API}/api/platform/slides/${slide.id}/annotations/export?format=geojson`}
              className="btn-control-secondary"
              download={`slide_${slide.id}_annotations.geojson`}
              title="Export as GeoJSON"
            >
              <Download size={12} /> GeoJSON
            </a>
            <a
              href={`${API}/api/platform/slides/${slide.id}/annotations/export?format=csv`}
              className="btn-control-secondary"
              download={`slide_${slide.id}_annotations.csv`}
              title="Export as CSV"
            >
              <Download size={12} /> CSV
            </a>
          </div>
        </div>
        <section className="viewer-bookmarks" aria-label="Saved regions">
          <div className="annotation-panel-heading"><div><h3>Saved regions</h3><span>{bookmarks.length} items</span></div></div>
          {!bookmarks.length ? <p className="annotation-empty">No saved regions.</p> : bookmarks.map((bookmark) => <div className="viewer-bookmark" key={bookmark.id}><button type="button" onClick={() => openBookmark(bookmark)}>{bookmark.name}</button><button type="button" aria-label={`Delete ${bookmark.name}`} onClick={() => removeBookmark(bookmark)}><Trash2 size={13} /></button></div>)}
        </section>
        {aiResults.length > 0 && <section className="viewer-ai-results" aria-label="AI evidence"><div className="annotation-panel-heading"><div><h3>AI evidence</h3><span>{aiResults.length} results</span></div><button type="button" className="btn-control-secondary" onClick={() => setAiVisible((value) => !value)}>{aiVisible ? 'Hide' : 'Show'}</button></div>{aiResults.map((result) => <div className="viewer-ai-result" key={result.id}><strong>{result.model_name} {result.model_version}</strong><span>{result.result_type} · {result.confidence == null ? 'No confidence' : `${(result.confidence * 100).toFixed(1)}% confidence`}</span>{result.limitations && <small>{result.limitations}</small>}</div>)}</section>}
        {/* ── HoVer-Net AI Analysis Panel ─────────────────────────────── */}
        {selectedAnnotation && <section className="quantitative-analysis"><h3>Quantitative analysis</h3><div className="quantitative-analysis__grid"><div><span>Region width</span><strong>{Math.round(selectedAnnotation.width || 0)} px</strong></div><div><span>Region height</span><strong>{Math.round(selectedAnnotation.height || 0)} px</strong></div><div><span>Status</span><strong>{selectedAnnotation.annotation_status || 'Active'}</strong></div></div></section>}
        {inspectorTab === 'ai' && <AiAnalysisPanel
          slide={slide}
          roiRect={roiRect}
          hiddenClasses={aiHiddenClasses}
          onToggleClass={(key) => {
            setAiHiddenClasses((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key); else next.add(key);
              return next;
            });
          }}
          selectedNucleus={aiSelectedNucleus}
          onSelectNucleus={setAiSelectedNucleus}
          onQcAnalysisChange={setQcAnalysis}
          onQcFeatureActiveChange={setQcModeActive}
          qcClasses={qcClasses}
          qcVisible={qcVisible}
          onToggleQcVisible={() => setQcVisible((value) => !value)}
          qcHiddenClasses={qcHiddenClasses}
          onToggleQcClass={(name) => setQcHiddenClasses((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
          })}
          onAnalysisReady={(analysis) => {
            setAiAnalysis(analysis);
            setAiSelectedNucleus(null);
            setSelectedMitoticCandidate(null);
          }}
          sourceMpp={pixelSize}
          onSelectMitoticCandidate={focusMitoticCandidate}
          selectedMitoticCandidate={selectedMitoticCandidate}
          onPanToRoi={panToRoi}
          onError={onError}
        />}
        {inspectorTab === 'ai' && aiAnalysis?.feature_code === 'CAMELYON_TUMOR_DETECTION' && (
          <section className="ai-class-section camelyon-controls">
            <h4>CAMELYON Heatmap</h4>

            <label className="camelyon-control-row">
              <input
                type="checkbox"
                checked={camelyonVisible}
                onChange={(event) => setCamelyonVisible(event.target.checked)}
              />
              <span>Show heatmap overlay</span>
            </label>

            <label className="camelyon-opacity-control">
              <span>Heatmap opacity: {Math.round(camelyonOpacity * 100)}%</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={camelyonOpacity}
                onChange={(event) => setCamelyonOpacity(Number(event.target.value))}
              />
            </label>
          </section>
        )}
        {draft && <AnnotationForm title="New annotation" values={draft} calibration={calibration} onSubmit={saveNew} onCancel={() => setDraft(null)} saving={saving} />}
        {editing && <AnnotationForm title="Edit annotation" values={editing} calibration={calibration} onSubmit={saveEdit} onCancel={() => setEditing(null)} saving={saving} />}
        {annotationsLoading ? <p className="annotation-empty">Loading annotations…</p> : !annotations.length ?
          <p className="annotation-empty">No annotations yet. Choose a tool to mark a region.</p> :
          <div className="annotation-list">{filteredAnnotations.map((annotation) => <div className={`annotation-item ${selectedAnnotation?.id === annotation.id ? 'annotation-item--selected' : ''}`} key={annotation.id}>
            <button type="button" className="annotation-open" onClick={() => selectAnnotation(annotation)}>
              <span className="annotation-swatch"><svg aria-hidden="true" viewBox="0 0 8 24"><rect width="8" height="24" rx="3" fill={annotation.color} /></svg></span>
              <span><strong>{annotation.label}</strong><small>{annotation.note || 'No note'}</small>{measurementLabel(annotation) && <small>{measurementLabel(annotation)}</small>}</span>
            </button>
            <div className="annotation-actions">
              <button type="button" title="Edit annotation" onClick={() => setEditing(annotation)}><Edit3 size={14} /></button>
              <button type="button" title="Delete annotation" onClick={() => setDeleteTarget(annotation)}><Trash2 size={14} /></button>
            </div>
          </div>)}</div>}
      </aside>
      <Modal
        open={Boolean(deleteTarget)}
        title="Delete annotation"
        onClose={() => setDeleteTarget(null)}
        footer={<>
          <button type="button" className="modal-button modal-button--secondary" onClick={() => setDeleteTarget(null)}>Cancel</button>
          <button type="button" className="modal-button btn-delete" onClick={() => remove(deleteTarget)}>Delete annotation</button>
        </>}
      >
        <p className="confirmation-copy">Permanently delete <strong>{deleteTarget?.label}</strong>?</p>
      </Modal>

      <ViewerBookmarksModal
        open={showViewpointsModal}
        onClose={() => setShowViewpointsModal(false)}
        bookmarks={bookmarks}
        onRestore={openBookmark}
        onRename={renameBookmark}
        onDelete={removeBookmark}
      />

      <ViewerShortcutsModal
        open={showShortcutsModal}
        onClose={() => setShowShortcutsModal(false)}
      />
    </div>
  );
}

function AnnotationForm({ title, values, calibration, onSubmit, onCancel, saving }) {
  const measurements = getAnnotationMeasurements(values, calibration);
  return <form className="annotation-form" onSubmit={onSubmit}>
    <h4>{title}</h4>
    <label>Label<input name="label" required maxLength={120} defaultValue={values.label} autoFocus /></label>
    <label>Note<textarea name="note" maxLength={2000} defaultValue={values.note} rows={2} /></label>
    <label>Category<select name="category" defaultValue={values.category || 'Pathologist'}><option>Pathologist</option><option>QC</option><option>Research</option><option>Imported</option><option>AI correction</option></select></label>
    <label>Status<select name="annotation_status" defaultValue={values.annotation_status || 'Active'}><option>Active</option><option>Resolved</option><option>Excluded</option><option>Corrected</option></select></label>
    <section className="annotation-measurements" aria-label="Automatic physical measurements">
      <header><strong>Automatic measurement</strong><span>Read-only</span></header>
      {measurements.map((measurement) => <div key={measurement.label}><span>{measurement.label}</span><output>{measurement.value}</output></div>)}
    </section>
    {values.id && <label>Change reason<input name="change_reason" required maxLength={2000} defaultValue="Annotation corrected" /></label>}
    <label className="annotation-color">Color<input name="color" type="color" defaultValue={values.color} /></label>
    <div><button className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      <button type="button" className="btn-control-secondary" onClick={onCancel}>Cancel</button></div>
  </form>;
}
