import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';
import { findHuTissuePreset, HU_TISSUE_PRESETS } from './huTissuePresets';
import '@kitware/vtk.js/Rendering/Profiles/Volume';
import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow';
import vtkImageData from '@kitware/vtk.js/Common/DataModel/ImageData';
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray';
import vtkVolume from '@kitware/vtk.js/Rendering/Core/Volume';
import vtkVolumeMapper from '@kitware/vtk.js/Rendering/Core/VolumeMapper';
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction';
import vtkPiecewiseFunction from '@kitware/vtk.js/Common/DataModel/PiecewiseFunction';
import vtkImageMarchingCubes from '@kitware/vtk.js/Filters/General/ImageMarchingCubes';
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper';
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor';
import vtkPlane from '@kitware/vtk.js/Common/DataModel/Plane';
import vtkAnnotatedCubeActor from '@kitware/vtk.js/Rendering/Core/AnnotatedCubeActor';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import AnnotatedCubePresets from '@kitware/vtk.js/Rendering/Core/AnnotatedCubeActor/Presets';
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';

const VOLUME_CACHE = new Map();
const VOLUME_CACHE_LIMIT = 6;

const THRESHOLD_COLORS = {
  red: [0.92, 0.18, 0.18],
  green: [0.2, 0.82, 0.28],
  blue: [0.2, 0.45, 0.95],
  yellow: [0.95, 0.85, 0.15],
};

function cacheKey(slideId, quality) {
  return `${slideId}:${quality}`;
}

function rememberVolume(key, value) {
  VOLUME_CACHE.delete(key);
  VOLUME_CACHE.set(key, value);
  while (VOLUME_CACHE.size > VOLUME_CACHE_LIMIT) {
    const oldest = VOLUME_CACHE.keys().next().value;
    VOLUME_CACHE.delete(oldest);
  }
}

function summarize(values) {
  const step = Math.max(1, Math.floor(values.length / 50000));
  const all = [];
  const foreground = [];
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
    if (index % step === 0) {
      all.push(value);
      if (value > 0) foreground.push(value);
    }
  }
  const pick = (list) => {
    const sorted = list.length ? list : [0];
    sorted.sort((left, right) => left - right);
    const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))];
    return { p05: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95), p99: at(0.99) };
  };
  return {
    all: pick(all),
    foreground: pick(foreground),
    min: Number.isFinite(min) ? min : 0,
    max: Number.isFinite(max) ? max : 0,
  };
}

function sampleFactorFor(quality, interacting = false) {
  // Still frames use denser sampling for a smoother VolView-like look.
  const base = quality === 'high' ? 0.55 : quality === 'preview' ? 1.6 : 0.95;
  return interacting ? base * 2.8 : base;
}

function maxSamplesFor(quality) {
  if (quality === 'high') return 1200;
  if (quality === 'balanced') return 800;
  return 420;
}

function cursorToWorld(cursor, counts, dims, spacing) {
  const safeCounts = {
    axial: Math.max(1, counts?.axial || dims?.[2] || 1),
    coronal: Math.max(1, counts?.coronal || dims?.[1] || 1),
    sagittal: Math.max(1, counts?.sagittal || dims?.[0] || 1),
  };
  const size = [
    Math.max(1, (dims?.[0] || safeCounts.sagittal) - 1),
    Math.max(1, (dims?.[1] || safeCounts.coronal) - 1),
    Math.max(1, (dims?.[2] || safeCounts.axial) - 1),
  ];
  const i = ((cursor?.sagittal || 0) / Math.max(1, safeCounts.sagittal - 1)) * size[0];
  const j = ((cursor?.coronal || 0) / Math.max(1, safeCounts.coronal - 1)) * size[1];
  const k = ((cursor?.axial || 0) / Math.max(1, safeCounts.axial - 1)) * size[2];
  const sp = spacing || [1, 1, 1];
  return [i * sp[0], j * sp[1], k * sp[2]];
}

function volumeBounds(dims, spacing) {
  const sp = spacing || [1, 1, 1];
  const d = dims || [1, 1, 1];
  return {
    x: [0, Math.max(sp[0], (d[0] - 1) * sp[0])],
    y: [0, Math.max(sp[1], (d[1] - 1) * sp[1])],
    z: [0, Math.max(sp[2], (d[2] - 1) * sp[2])],
  };
}

function makeLineActor(rgb) {
  const source = vtkLineSource.newInstance();
  const mapper = vtkMapper.newInstance();
  mapper.setInputConnection(source.getOutputPort());
  const actor = vtkActor.newInstance();
  actor.setMapper(mapper);
  actor.getProperty().setColor(...rgb);
  actor.getProperty().setLineWidth(2);
  actor.setVisibility(false);
  return { source, actor };
}

function configureVolumeLook(property, spacing, { shaded = true } = {}) {
  const distance = Math.max(...(spacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
  property.setScalarOpacityUnitDistance(0, distance * 0.85);
  property.setInterpolationTypeToLinear();
  property.setShade(shaded);
  property.setAmbient(shaded ? 0.28 : 0.45);
  property.setDiffuse(shaded ? 0.72 : 0.45);
  property.setSpecular(shaded ? 0.18 : 0);
  property.setSpecularPower(shaded ? 14 : 1);
  if (property.setUseGradientOpacity) {
    property.setUseGradientOpacity(0, shaded);
    if (shaded && property.setGradientOpacityMinimumValue) {
      property.setGradientOpacityMinimumValue(0, 2);
      property.setGradientOpacityMaximumValue(0, 28);
      property.setGradientOpacityMinimumOpacity(0, 0);
      property.setGradientOpacityMaximumOpacity(0, 1);
    }
  }
  property.modified();
}

function applyTransfer(property, color, opacity, preset, hu, range, spacing, shaded = true) {
  color.removeAllPoints();
  opacity.removeAllPoints();
  if (hu && preset === 'Lung') {
    color.addRGBPoint(-1000, 0.05, 0.05, 0.08);
    color.addRGBPoint(-700, 0.55, 0.42, 0.32);
    color.addRGBPoint(-400, 0.95, 0.82, 0.7);
    color.addRGBPoint(-200, 1, 0.95, 0.9);
    opacity.addPoint(-1000, 0);
    opacity.addPoint(-800, 0);
    opacity.addPoint(-650, 0.05);
    opacity.addPoint(-450, 0.16);
    opacity.addPoint(-200, 0.02);
  } else if (hu && preset === 'Bone') {
    color.addRGBPoint(100, 0.35, 0.28, 0.22);
    color.addRGBPoint(300, 0.85, 0.75, 0.62);
    color.addRGBPoint(800, 0.98, 0.96, 0.92);
    color.addRGBPoint(1500, 1, 1, 1);
    opacity.addPoint(100, 0);
    opacity.addPoint(220, 0.02);
    opacity.addPoint(400, 0.18);
    opacity.addPoint(900, 0.55);
  } else if (hu) {
    color.addRGBPoint(-160, 0.05, 0.02, 0.02);
    color.addRGBPoint(20, 0.72, 0.38, 0.3);
    color.addRGBPoint(80, 0.92, 0.72, 0.58);
    color.addRGBPoint(300, 1, 0.95, 0.88);
    opacity.addPoint(-200, 0);
    opacity.addPoint(-40, 0);
    opacity.addPoint(20, 0.035);
    opacity.addPoint(90, 0.12);
    opacity.addPoint(250, 0.28);
  } else {
    const tissue = range?.foreground || { p05: 1, p25: 20, p50: 40, p75: 60, p95: 80, p99: 90 };
    const floor = Math.max(tissue.p05 * 0.35, 0);
    // Soft tissue look similar to VolView MRI volumes.
    color.addRGBPoint(0, 0, 0, 0);
    color.addRGBPoint(floor, 0.08, 0.05, 0.05);
    color.addRGBPoint(tissue.p25, 0.55, 0.32, 0.28);
    color.addRGBPoint(tissue.p50, 0.82, 0.55, 0.48);
    color.addRGBPoint(tissue.p75, 0.95, 0.82, 0.75);
    color.addRGBPoint(tissue.p95, 1, 0.96, 0.92);
    color.addRGBPoint(tissue.p99, 1, 1, 1);
    opacity.addPoint(0, 0);
    opacity.addPoint(floor, 0);
    if (preset === 'High contrast') {
      opacity.addPoint(tissue.p25, 0.03);
      opacity.addPoint(tissue.p50, 0.1);
      opacity.addPoint(tissue.p75, 0.28);
      opacity.addPoint(tissue.p99, 0.55);
    } else if (preset === 'Brain detail') {
      opacity.addPoint(tissue.p25, 0.01);
      opacity.addPoint(tissue.p50, 0.045);
      opacity.addPoint(tissue.p75, 0.16);
      opacity.addPoint(tissue.p95, 0.34);
      opacity.addPoint(tissue.p99, 0.48);
    } else if (preset === 'Vascular') {
      opacity.addPoint(tissue.p50, 0);
      opacity.addPoint(tissue.p75, 0.04);
      opacity.addPoint(tissue.p95, 0.28);
      opacity.addPoint(tissue.p99, 0.62);
    } else {
      // Default grayscale / soft tissue shell.
      opacity.addPoint(tissue.p25, 0.015);
      opacity.addPoint(tissue.p50, 0.055);
      opacity.addPoint(tissue.p75, 0.14);
      opacity.addPoint(tissue.p95, 0.3);
      opacity.addPoint(tissue.p99, 0.42);
    }
  }
  configureVolumeLook(property, spacing, { shaded });
}

function thresholdMask(values, low, high) {
  const mask = new Uint8Array(values.length);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value >= low && value <= high) {
      mask[index] = 1;
      count += 1;
    }
  }
  return { mask, count };
}

function applyThresholdTransfer(property, color, opacity, colorName, opacityPct, spacing) {
  const rgb = THRESHOLD_COLORS[colorName] || THRESHOLD_COLORS.red;
  const peak = opacityPct <= 0 ? 0 : (opacityPct / 100) * 0.55;
  color.removeAllPoints();
  opacity.removeAllPoints();
  color.addRGBPoint(0, ...rgb);
  color.addRGBPoint(1, ...rgb);
  // Only an actual selected voxel (value 1) is colored. Values in between
  // come from interpolation and must stay invisible.
  opacity.addPoint(-1e6, 0);
  opacity.addPoint(0, 0);
  opacity.addPoint(0.99, 0);
  opacity.addPoint(1, peak);
  opacity.addPoint(1.01, 0);
  opacity.addPoint(1e6, 0);
  property.setInterpolationTypeToNearest();
  property.setShade(false);
  property.setAmbient(1);
  property.setDiffuse(0);
  property.setSpecular(0);
  if (property.setUseGradientOpacity) property.setUseGradientOpacity(0, false);
  const step = Math.min(...(spacing || [1, 1, 1]));
  property.setScalarOpacityUnitDistance(0, Math.max(step * 6, 2));
  property.modified();
}

function volumeDataRange(range) {
  if (Number.isFinite(range?.min) && Number.isFinite(range?.max)) {
    return { min: range.min, max: range.max, span: Math.max(1e-3, range.max - range.min), foreground: range.foreground || range.all };
  }
  const all = range?.all;
  if (!all) return null;
  const min = Math.min(all.p05, all.p25, all.p50);
  const max = Math.max(all.p50, all.p95, all.p99);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max, span: Math.max(1e-3, max - min), foreground: range.foreground || all };
}

function intensityPresetRange(kind, range) {
  const data = volumeDataRange(range);
  if (!data) return null;
  const { min, max, span, foreground } = data;
  if (kind === 'lower') return [min, min + span / 3];
  if (kind === 'upper') return [max - span / 3, max];
  if (kind === 'bright') {
    const low = foreground?.p75 ?? (min + span * 0.66);
    const high = foreground?.p99 ?? max;
    return [low, high];
  }
  return [min + span / 3, max - span / 3];
}

async function fetchVolume(slideId, quality, signal) {
  const key = cacheKey(slideId, quality);
  if (VOLUME_CACHE.has(key)) return VOLUME_CACHE.get(key);

  const response = await apiFetch(`${API_BASE_URL}/api/slides/${slideId}/radiology/volume?quality=${quality}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail || 'This item cannot be shown as a 3D volume');
  }
  const dims = [
    Number(response.headers.get('X-Dim-I')),
    Number(response.headers.get('X-Dim-J')),
    Number(response.headers.get('X-Dim-K')),
  ];
  const spacing = [
    Number(response.headers.get('X-Spacing-I')),
    Number(response.headers.get('X-Spacing-J')),
    Number(response.headers.get('X-Spacing-K')),
  ];
  const reduced = response.headers.get('X-Preview') === '1';
  const buffer = await response.arrayBuffer();
  const values = new Float32Array(buffer);
  const expected = dims.reduce((total, size) => total * size, 1);
  if (!dims.every((size) => size > 0) || values.length !== expected) {
    throw new Error('3D volume dimensions do not match the voxel data');
  }
  const payload = {
    dims,
    spacing: spacing.map((value) => (Number.isFinite(value) && value > 0 ? value : 1)),
    values,
    reduced,
    range: summarize(values),
  };
  rememberVolume(key, payload);
  return payload;
}

export default function MedicalVolume3DViewer({
  slideId,
  hu,
  compact = false,
  cursor = null,
  planeCounts = null,
  showCrosshair = false,
  externalThreshold = null,
  onCommitThreshold = null,
}) {
  const host = useRef(null);
  const scene = useRef(null);
  const [status, setStatus] = useState('Loading volume…');
  const [preview, setPreview] = useState(false);
  const [preset, setPreset] = useState(hu ? 'Soft tissue' : 'Brain detail');
  const [quality, setQuality] = useState('balanced');
  const [dimensions, setDimensions] = useState('');
  const cameraRef = useRef(null);
  const [opacity, setOpacity] = useState(70);
  const [surfaceOn, setSurfaceOn] = useState(false);
  const [huMin, setHuMin] = useState('-1000');
  const [huMax, setHuMax] = useState('-500');
  const [huColor, setHuColor] = useState('red');
  const [huOpacity, setHuOpacity] = useState(55);
  const [huVisible, setHuVisible] = useState(true);
  const [thresholdOn, setThresholdOn] = useState(false);
  const [huError, setHuError] = useState('');
  const [huTissueId, setHuTissueId] = useState(hu ? 'air' : '');
  const [isolate, setIsolate] = useState(false);
  const [clipAxis, setClipAxis] = useState('none');
  const [clipPos, setClipPos] = useState(50);
  const externalRef = useRef(externalThreshold);
  externalRef.current = externalThreshold;
  const unitLabel = hu ? 'HU' : 'intensity';
  const selectedTissue = findHuTissuePreset(huTissueId);

  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    const initialQuality = 'balanced';
    const view = vtkGenericRenderWindow.newInstance({ background: [0.02, 0.02, 0.03] });
    view.setContainer(node);
    view.resize();
    const renderer = view.getRenderer();
    const color = vtkColorTransferFunction.newInstance();
    const opacityFn = vtkPiecewiseFunction.newInstance();
    const actor = vtkVolume.newInstance();
    const mapper = vtkVolumeMapper.newInstance();
    actor.setMapper(mapper);
    actor.getProperty().setRGBTransferFunction(0, color);
    actor.getProperty().setScalarOpacity(0, opacityFn);
    renderer.addVolume(actor);
    const overlayColor = vtkColorTransferFunction.newInstance();
    const overlayOpacity = vtkPiecewiseFunction.newInstance();
    const overlay = vtkVolume.newInstance();
    const overlayMapper = vtkVolumeMapper.newInstance();
    overlay.setMapper(overlayMapper);
    overlay.getProperty().setRGBTransferFunction(0, overlayColor);
    overlay.getProperty().setScalarOpacity(0, overlayOpacity);
    overlay.setVisibility(false);
    renderer.addVolume(overlay);
    const cubes = vtkImageMarchingCubes.newInstance({ contourValue: hu ? 300 : 80, computeNormals: true });
    const surfaceMapper = vtkMapper.newInstance();
    surfaceMapper.setInputConnection(cubes.getOutputPort());
    surfaceMapper.setScalarVisibility(false);
    const surface = vtkActor.newInstance();
    surface.setMapper(surfaceMapper);
    surface.setVisibility(false);
    renderer.addActor(surface);

    const crossX = makeLineActor([0.95, 0.25, 0.22]);
    const crossY = makeLineActor([0.95, 0.25, 0.22]);
    const crossZ = makeLineActor([0.95, 0.25, 0.22]);
    const probeSource = vtkSphereSource.newInstance({ radius: 1, thetaResolution: 16, phiResolution: 16 });
    const probeMapper = vtkMapper.newInstance();
    probeMapper.setInputConnection(probeSource.getOutputPort());
    const probe = vtkActor.newInstance();
    probe.setMapper(probeMapper);
    probe.getProperty().setColor(1, 0.85, 0.2);
    probe.setVisibility(false);
    renderer.addActor(crossX.actor);
    renderer.addActor(crossY.actor);
    renderer.addActor(crossZ.actor);
    renderer.addActor(probe);

    const axes = vtkAnnotatedCubeActor.newInstance();
    AnnotatedCubePresets.applyPreset('lps', axes);
    AnnotatedCubePresets.applyDefinitions({
      defaultStyle: {
        fontStyle: 'bold',
        fontFamily: 'Arial',
        fontColor: 'white',
        fontSizeScale: (res) => res / 2.2,
        faceColor: '#2a343b',
        edgeThickness: 0.08,
        edgeColor: '#0b1014',
        resolution: 220,
      },
      xMinusFaceProperty: { text: 'R', faceColor: '#c0392b' },
      xPlusFaceProperty: { text: 'L', faceColor: '#c0392b' },
      yMinusFaceProperty: { text: 'A', faceColor: '#27ae60' },
      yPlusFaceProperty: { text: 'P', faceColor: '#27ae60' },
      zMinusFaceProperty: { text: 'I', faceColor: '#2980b9' },
      zPlusFaceProperty: { text: 'S', faceColor: '#2980b9' },
    }, axes);
    const orientation = vtkOrientationMarkerWidget.newInstance({
      actor: axes,
      interactor: view.getInteractor(),
    });
    orientation.setEnabled(true);
    orientation.setViewportCorner(vtkOrientationMarkerWidget.Corners.BOTTOM_RIGHT);
    orientation.setViewportSize(compact ? 0.18 : 0.14);
    orientation.setMinPixelSize(compact ? 56 : 72);
    orientation.setMaxPixelSize(compact ? 100 : 140);

    const interactor = view.getInteractor();
    interactor.setDesiredUpdateRate(22);
    interactor.setStillUpdateRate(0.0001);
    if (mapper.setAutoAdjustSampleDistance) mapper.setAutoAdjustSampleDistance(true);
    if (mapper.setMaximumSamplesPerRay) mapper.setMaximumSamplesPerRay(maxSamplesFor(initialQuality));
    if (mapper.setBlendModeToComposite) mapper.setBlendModeToComposite();
    const clipPlane = vtkPlane.newInstance();
    scene.current = {
      view, actor, mapper, color, opacityFn, renderer, cubes, surface, orientation,
      overlay, overlayMapper, overlayColor, overlayOpacity, clipPlane, clipOn: false,
      crossX, crossY, crossZ, probe, probeSource,
      quality: initialQuality, surfaceReady: false, spacing: [1, 1, 1], dims: [1, 1, 1], shaded: true,
    };

    const setSampleMode = (interacting) => {
      const current = scene.current;
      if (!current?.spacing) return;
      const factor = sampleFactorFor(current.quality || initialQuality, interacting);
      current.mapper.setSampleDistance(Math.min(...current.spacing) * factor);
      if (current.overlayMapper) current.overlayMapper.setSampleDistance(Math.min(...current.spacing) * factor);
      if (current.mapper.setMaximumSamplesPerRay) {
        current.mapper.setMaximumSamplesPerRay(
          interacting ? Math.round(maxSamplesFor(current.quality) * 0.45) : maxSamplesFor(current.quality),
        );
      }
      // Keep interaction snappy; restore soft shading when the camera settles.
      configureVolumeLook(current.actor.getProperty(), current.spacing, { shaded: !interacting && current.shaded !== false });
    };
    interactor.onStartAnimation(() => setSampleMode(true));
    interactor.onEndAnimation(() => {
      setSampleMode(false);
      view.getRenderWindow().render();
    });

    const observer = new ResizeObserver(() => {
      view.resize();
      orientation.updateMarkerOrientation();
      view.getRenderWindow().render();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      orientation.setEnabled(false);
      view.delete();
      scene.current = null;
    };
  }, [slideId, hu, compact]);

  useEffect(() => {
    const current = scene.current;
    if (!current) return undefined;
    const controller = new AbortController();
    let cancelled = false;
    setStatus('Loading volume…');
    setHuError('');
    current.surface.setVisibility(false);
    current.surfaceReady = false;

    fetchVolume(slideId, quality, controller.signal)
      .then((payload) => {
        if (cancelled || !scene.current) return;
        const image = vtkImageData.newInstance();
        image.setDimensions(payload.dims);
        image.setSpacing(...payload.spacing);
        image.getPointData().setScalars(vtkDataArray.newInstance({
          name: 'Scalars',
          values: payload.values,
          numberOfComponents: 1,
        }));
        current.mapper.setInputData(image);
        current.overlay.setVisibility(false);
        current.mapper.setSampleDistance(Math.min(...payload.spacing) * sampleFactorFor(quality, false));
        if (current.mapper.setMaximumSamplesPerRay) {
          current.mapper.setMaximumSamplesPerRay(maxSamplesFor(quality));
        }
        current.range = payload.range;
        current.spacing = payload.spacing;
        current.dims = payload.dims;
        current.image = image;
        current.quality = quality;
        current.surfaceReady = false;
        const extent = Math.min(...payload.spacing) * 1.4;
        current.probeSource.setRadius(Math.max(extent, 0.6));
        const ctLike = hu || (payload.range?.min ?? 0) < -200;
        const activePreset = ctLike ? 'Soft tissue' : 'Grayscale';
        setPreset(activePreset);
        applyTransfer(
          current.actor.getProperty(),
          current.color,
          current.opacityFn,
          activePreset,
          ctLike,
          payload.range,
          payload.spacing,
          true,
        );
        const saved = cameraRef.current;
        if (saved) {
          const camera = current.renderer.getActiveCamera();
          camera.setPosition(...saved.position);
          camera.setFocalPoint(...saved.focal);
          camera.setViewUp(...saved.up);
        } else {
          current.renderer.resetCamera();
          const camera = current.renderer.getActiveCamera();
          camera.elevation(12);
          camera.azimuth(-18);
          camera.dolly(1.05);
          current.renderer.resetCameraClippingRange();
        }
        setDimensions(payload.dims.join(' × '));
        setPreview(payload.reduced);
        setStatus('');
        const shared = externalRef.current;
        if (shared) {
          setHuMin(String(shared.low));
          setHuMax(String(shared.high));
          setHuColor(shared.color);
          setHuOpacity(shared.opacity ?? 55);
          setThresholdOn(true);
          setHuVisible(true);
        } else if (!hu) {
          const mid = intensityPresetRange('mid', payload.range);
          if (mid) {
            setHuTissueId('');
            setHuMin(String(Math.round(mid[0])));
            setHuMax(String(Math.round(mid[1])));
          }
        } else if (!thresholdOn) {
          const air = findHuTissuePreset('air');
          setHuTissueId('air');
          setHuMin(String(air.min));
          setHuMax(String(air.max));
        }
        current.view.resize();
        current.view.getRenderWindow().render();
        requestAnimationFrame(() => {
          if (!scene.current) return;
          scene.current.view.resize();
          if (!saved) scene.current.renderer.resetCamera();
          scene.current.view.getRenderWindow().render();
        });
      })
      .catch((error) => {
        if (!cancelled && error.name !== 'AbortError') setStatus(error.message);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [slideId, hu, quality]);

  useEffect(() => {
    const current = scene.current;
    if (!current?.crossX || !current?.dims) return;
    const visible = Boolean(showCrosshair && cursor);
    current.crossX.actor.setVisibility(visible);
    current.crossY.actor.setVisibility(visible);
    current.crossZ.actor.setVisibility(visible);
    current.probe.setVisibility(visible);
    if (!visible) {
      current.view.getRenderWindow().render();
      return;
    }
    const point = cursorToWorld(cursor, planeCounts, current.dims, current.spacing);
    const bounds = volumeBounds(current.dims, current.spacing);
    current.crossX.source.setPoint1(bounds.x[0], point[1], point[2]);
    current.crossX.source.setPoint2(bounds.x[1], point[1], point[2]);
    current.crossY.source.setPoint1(point[0], bounds.y[0], point[2]);
    current.crossY.source.setPoint2(point[0], bounds.y[1], point[2]);
    current.crossZ.source.setPoint1(point[0], point[1], bounds.z[0]);
    current.crossZ.source.setPoint2(point[0], point[1], bounds.z[1]);
    current.probe.setPosition(...point);
    current.view.getRenderWindow().render();
  }, [cursor, planeCounts, showCrosshair, dimensions]);

  function render() {
    scene.current?.view.getRenderWindow().render();
  }

  function restorePresetTransfer(name = preset) {
    const current = scene.current;
    if (!current) return;
    applyTransfer(current.actor.getProperty(), current.color, current.opacityFn, name, hu, current.range, current.spacing, true);
    const spacing = Math.min(...(current.spacing || [1]));
    current.actor.getProperty().setScalarOpacityUnitDistance(0, spacing * Math.max(0.6, 1.5 - opacity / 100));
    current.actor.setVisibility(true);
    current.surface.setVisibility(surfaceOn && current.surfaceReady);
  }

  function ensureSurface(contourValue) {
    const current = scene.current;
    if (!current?.image) return;
    if (!current.surfaceReady) {
      current.cubes.setInputData(current.image);
      current.surfaceReady = true;
    }
    if (Number.isFinite(contourValue)) current.cubes.setContourValue(contourValue);
  }

  function thresholdSurface(low, high) {
    const current = scene.current;
    const scalars = current?.image?.getPointData()?.getScalars()?.getData();
    if (!current || !scalars) return;
    const mask = new Uint8Array(scalars.length);
    for (let index = 0; index < scalars.length; index += 1) {
      const value = scalars[index];
      mask[index] = value >= low && value <= high ? 1 : 0;
    }
    const maskImage = vtkImageData.newInstance();
    maskImage.setDimensions(...current.dims);
    maskImage.setSpacing(...current.spacing);
    maskImage.getPointData().setScalars(vtkDataArray.newInstance({ name: 'ThresholdMask', values: mask, numberOfComponents: 1 }));
    current.cubes.setInputData(maskImage);
    current.cubes.setContourValue(0.5);
    current.surfaceReady = true;
  }

  function paintThreshold(low, high, colorName, opacityPct, rebuildSurface = false) {
    const current = scene.current;
    const scalars = current?.image?.getPointData()?.getScalars()?.getData();
    if (!current || !scalars) return;
    const isolated = Boolean(externalRef.current?.isolate || isolate);
    current.actor.setVisibility(!isolated);
    if (!isolated) {
      const step = Math.min(...(current.spacing || [1]));
      current.actor.getProperty().setScalarOpacityUnitDistance(0, step * 8);
    }
    const rgb = THRESHOLD_COLORS[colorName] || THRESHOLD_COLORS.red;
    const property = current.surface.getProperty();
    property.setColor(...rgb);
    property.setOpacity(opacityPct <= 0 ? 0 : opacityPct / 100);
    property.setAmbient(0.2);
    property.setDiffuse(0.75);
    property.setSpecular(0.3);
    property.setSpecularPower(16);
    const { mask, count } = thresholdMask(scalars, low, high);
    if (!count) {
      current.overlay.setVisibility(false);
      current.surface.setVisibility(false);
      current.surfaceReady = false;
      return;
    }
    const maskImage = vtkImageData.newInstance();
    maskImage.setDimensions(...current.dims);
    maskImage.setSpacing(...current.spacing);
    maskImage.setOrigin(...(current.image.getOrigin?.() || [0, 0, 0]));
    maskImage.getPointData().setScalars(vtkDataArray.newInstance({
      name: 'ThresholdMask',
      values: Float32Array.from(mask),
      numberOfComponents: 1,
    }));
    current.overlayMapper.setInputData(maskImage);
    if (current.overlayMapper.setBlendModeToComposite) current.overlayMapper.setBlendModeToComposite();
    if (current.overlayMapper.setAutoAdjustSampleDistance) current.overlayMapper.setAutoAdjustSampleDistance(false);
    current.overlayMapper.setSampleDistance(Math.min(...(current.spacing || [1])) * 0.5);
    current.surfaceReady = true;
    applyThresholdTransfer(
      current.overlay.getProperty(),
      current.overlayColor,
      current.overlayOpacity,
      colorName,
      opacityPct,
      current.spacing,
    );
    current.overlay.setVisibility(opacityPct > 0 && current.surfaceReady);
    current.surface.setVisibility(false);
  }

  function updateOpacity(value) {
    setOpacity(value);
    const current = scene.current;
    if (!current) return;
    const spacing = Math.min(...(current.spacing || [1]));
    const contextDim = thresholdOn && huVisible && !(externalRef.current?.isolate || isolate) ? 4 : 1;
    current.actor.getProperty().setScalarOpacityUnitDistance(0, spacing * Math.max(0.6, 1.5 - value / 100) * contextDim);
    if (thresholdOn && huVisible) {
      const low = Number(huMin);
      const high = Number(huMax);
      if (Number.isFinite(low) && Number.isFinite(high)) {
        paintThreshold(low, high, huColor, huOpacity);
      }
    }
    if (!(thresholdOn && huVisible)) current.surface.getProperty().setOpacity(value / 100);
    render();
  }

  function updatePreset(name) {
    setPreset(name);
    setHuError('');
    if (!scene.current) return;
    const ctLike = hu || (scene.current.range?.min ?? 0) < -200;
    applyTransfer(scene.current.actor.getProperty(), scene.current.color, scene.current.opacityFn, name, ctLike, scene.current.range, scene.current.spacing, true);
    const shared = externalRef.current;
    if (shared) paintThreshold(shared.low, shared.high, shared.color, shared.opacity ?? huOpacity, false);
    else if (thresholdOn && huVisible) paintThreshold(Number(huMin), Number(huMax), huColor, huOpacity, false);
    render();
  }

  function applyThreshold(event) {
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
    if (!scene.current?.image) {
      setHuError('Volume is still loading.');
      return;
    }
    const dataRange = volumeDataRange(scene.current.range);
    if (dataRange && (high < dataRange.min || low > dataRange.max)) {
      setHuError(
        `No overlap with this volume’s intensities (~${Math.round(dataRange.min)}–${Math.round(dataRange.max)}). Adjust the range.`,
      );
      return;
    }
    setThresholdOn(true);
    setHuVisible(true);
    paintThreshold(low, high, huColor, huOpacity, true);
    onCommitThreshold?.({ low, high, color: huColor, opacity: huOpacity, isolate: Boolean(externalRef.current?.isolate || isolate) });
    render();
  }

  function clearThreshold() {
    setThresholdOn(false);
    setIsolate(false);
    setHuError('');
    if (scene.current?.overlay) {
      scene.current.overlay.setVisibility(false);
      scene.current.actor.setVisibility(true);
    }
    restorePresetTransfer();
    onCommitThreshold?.(null);
    render();
  }

  useEffect(() => {
    const current = scene.current;
    if (!current?.image || !current.overlay) return;
    if (!externalThreshold) {
      if (current.overlay.getVisibility() || current.surface.getVisibility()) {
        current.overlay.setVisibility(false);
        current.surface.setVisibility(false);
        current.actor.setVisibility(true);
        applyTransfer(current.actor.getProperty(), current.color, current.opacityFn, preset, hu || (current.range?.min ?? 0) < -200, current.range, current.spacing, true);
        current.view.getRenderWindow().render();
      }
      return;
    }
    setHuMin(String(externalThreshold.low));
    setHuMax(String(externalThreshold.high));
    setHuColor(externalThreshold.color);
    setHuOpacity(externalThreshold.opacity ?? 55);
    setThresholdOn(true);
    setHuVisible(true);
    paintThreshold(externalThreshold.low, externalThreshold.high, externalThreshold.color, externalThreshold.opacity ?? 55, true);
    current.view.getRenderWindow().render();
  }, [externalThreshold, dimensions, isolate]);

  useEffect(() => {
    const current = scene.current;
    if (!current?.clipPlane || !current.dims) return;
    const [sx, sy, sz] = current.spacing || [1, 1, 1];
    const [dx, dy, dz] = current.dims;
    const size = [sx * Math.max(dx - 1, 1), sy * Math.max(dy - 1, 1), sz * Math.max(dz - 1, 1)];
    if (clipAxis === 'none') {
      current.mapper.removeAllClippingPlanes();
      current.overlayMapper.removeAllClippingPlanes();
      current.surface.getMapper().removeAllClippingPlanes();
      current.clipOn = false;
    } else {
      const normal = clipAxis === 'sagittal' ? [1, 0, 0] : clipAxis === 'coronal' ? [0, 1, 0] : [0, 0, 1];
      const fraction = clipPos / 100;
      current.clipPlane.setNormal(normal[0], normal[1], normal[2]);
      current.clipPlane.setOrigin(
        clipAxis === 'sagittal' ? size[0] * fraction : size[0] / 2,
        clipAxis === 'coronal' ? size[1] * fraction : size[1] / 2,
        clipAxis === 'axial' ? size[2] * fraction : size[2] / 2,
      );
      if (!current.clipOn) {
        current.mapper.addClippingPlane(current.clipPlane);
        current.overlayMapper.addClippingPlane(current.clipPlane);
        current.surface.getMapper().addClippingPlane(current.clipPlane);
        current.clipOn = true;
      }
    }
    current.view.getRenderWindow().render();
  }, [clipAxis, clipPos, dimensions]);

  function toggleOverlay(checked) {
    setHuVisible(checked);
    const current = scene.current;
    if (!current || !thresholdOn) return;
    if (checked) {
      const low = Number(huMin);
      const high = Number(huMax);
      if (Number.isFinite(low) && Number.isFinite(high)) paintThreshold(low, high, huColor, huOpacity);
    } else {
      current.overlay?.setVisibility(false);
      current.actor.setVisibility(true);
      restorePresetTransfer();
      current.surface.setVisibility(surfaceOn && current.surfaceReady);
    }
    render();
  }

  function updateThresholdColor(value) {
    setHuColor(value);
    if (!thresholdOn || !huVisible) return;
    const low = Number(huMin);
    const high = Number(huMax);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    paintThreshold(low, high, value, huOpacity);
    render();
  }

  function updateThresholdOpacity(value) {
    setHuOpacity(value);
    if (!thresholdOn || !huVisible) return;
    const low = Number(huMin);
    const high = Number(huMax);
    if (!Number.isFinite(low) || !Number.isFinite(high)) return;
    paintThreshold(low, high, huColor, value);
    render();
  }

  function toggleSurface() {
    const next = !surfaceOn;
    setSurfaceOn(next);
    if (!scene.current) return;
    if (thresholdOn && huVisible && next) {
      const low = Number(huMin);
      const high = Number(huMax);
      if (Number.isFinite(low) && Number.isFinite(high)) thresholdSurface(low, high);
      scene.current.surface.setVisibility(true);
    } else if (next) {
      const tissue = scene.current.range?.foreground?.p75;
      ensureSurface(hu && preset === 'Lung' ? -500 : hu ? 300 : (Number.isFinite(tissue) ? tissue : 0));
      scene.current.surface.setVisibility(true);
    } else {
      scene.current.surface.setVisibility(false);
    }
    render();
  }

  function changeQuality(next) {
    const camera = scene.current?.renderer.getActiveCamera();
    if (camera) {
      cameraRef.current = {
        position: [...camera.getPosition()],
        focal: [...camera.getFocalPoint()],
        up: [...camera.getViewUp()],
      };
    }
    setQuality(next);
  }

  if (compact) {
    return (
      <div className="radiology-3d-layout radiology-3d-layout--compact">
        <div className="viewer radiology-stage medical-canvas radiology-3d">
          <div ref={host} className="radiology-3d__canvas" />
          <div className="radiology-overlay radiology-overlay--tl">
            <span>{preview ? 'Preview' : quality}{dimensions ? ` · ${dimensions}` : ''}</span>
            {showCrosshair && cursor ? (
              <span>
                A{cursor.axial + 1}/C{cursor.coronal + 1}/S{cursor.sagittal + 1}
              </span>
            ) : null}
          </div>
          {status ? <p className="viewer-hint-bar">{status}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="radiology-3d-layout">
      <div className="viewer radiology-stage medical-canvas radiology-3d">
        <div ref={host} className="radiology-3d__canvas" />
      </div>
      <aside className="imaging-panel" aria-label="3D imaging controls">
        <div className="imaging-panel__section">
          <h3>Display</h3>
          <p className="imaging-dims">{dimensions || 'Loading…'}</p>
          <p className="imaging-note">3D volume{preview ? ' · downsampled' : ''} · {quality}</p>
          {status && <p className="imaging-note imaging-note--error">{status}</p>}
          <p className="imaging-note">Use Preview while exploring. Balanced/High are slower.</p>
          <label>Rendering preset
            <select value={preset} onChange={(event) => updatePreset(event.target.value)} disabled={thresholdOn && huVisible}>
              {(hu ? ['Soft tissue', 'Bone', 'Lung'] : ['Grayscale', 'High contrast', 'Brain detail', 'Vascular']).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label>Quality
            <select value={quality} onChange={(event) => changeQuality(event.target.value)}>
              <option value="preview">Preview (fast)</option>
              <option value="balanced">Balanced</option>
              <option value="high">High quality</option>
            </select>
          </label>
          <label>Volume opacity {opacity}%
            <input type="range" min="10" max="100" value={opacity} onChange={(event) => updateOpacity(Number(event.target.value))} disabled={thresholdOn && huVisible} />
          </label>
        </div>

        <div className="imaging-panel__section">
          <h3>Threshold</h3>
          <form className="imaging-stack" onSubmit={applyThreshold}>
            <label className="imaging-check">
              <input type="checkbox" checked={huVisible} onChange={(event) => toggleOverlay(event.target.checked)} />
              Show overlay
            </label>
            {hu ? (
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
                {selectedTissue && <p className="imaging-note">{selectedTissue.use}</p>}
              </>
            ) : (
              <label>Preset
                <select
                  defaultValue="Custom"
                  onChange={(event) => {
                    const map = {
                      'Lower third': 'lower',
                      'Mid intensities': 'mid',
                      'Bright / upper': 'bright',
                    };
                    const next = intensityPresetRange(map[event.target.value], scene.current?.range);
                    if (next) {
                      setHuMin(String(Math.round(next[0])));
                      setHuMax(String(Math.round(next[1])));
                    }
                  }}
                >
                  <option value="Custom">Custom</option>
                  {['Lower third', 'Mid intensities', 'Bright / upper'].map((name) => (
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
              <select value={huColor} onChange={(event) => updateThresholdColor(event.target.value)}>
                <option value="red">Red</option>
                <option value="green">Green</option>
                <option value="blue">Blue</option>
                <option value="yellow">Yellow</option>
              </select>
            </label>
            <label>Overlay opacity {huOpacity}%
              <input type="range" min="0" max="100" value={huOpacity} onChange={(event) => updateThresholdOpacity(Number(event.target.value))} />
            </label>
            <div className="imaging-actions">
              <label className="imaging-check"><input type="checkbox" checked={Boolean(externalThreshold?.isolate) || isolate} onChange={(event) => {
                const checked = event.target.checked;
                setIsolate(checked);
                const low = Number(huMin);
                const high = Number(huMax);
                if (onCommitThreshold && Number.isFinite(low) && Number.isFinite(high) && thresholdOn) {
                  onCommitThreshold({ low, high, color: huColor, opacity: huOpacity, isolate: checked });
                }
              }} /> Isolate range</label>
              <label>Clip
                <select value={clipAxis} onChange={(event) => setClipAxis(event.target.value)}>
                  <option value="none">Off</option>
                  <option value="axial">Axial</option>
                  <option value="coronal">Coronal</option>
                  <option value="sagittal">Sagittal</option>
                </select>
              </label>
              {clipAxis !== 'none' && (
                <label>Clip position {clipPos}%
                  <input type="range" min="0" max="100" value={clipPos} onChange={(event) => setClipPos(Number(event.target.value))} />
                </label>
              )}
              <button type="submit" className="btn-control-secondary">Apply</button>
              <button type="button" className="btn-control-secondary" onClick={clearThreshold}>Clear</button>
            </div>
            {huError && <p className="imaging-note imaging-note--error">{huError}</p>}
            {thresholdOn && (
              <p className="imaging-note">
                Threshold {huMin}–{huMax} {unitLabel} in volume view. Range highlight, not a diagnosis.
              </p>
            )}
          </form>
        </div>

        <div className="imaging-panel__section">
          <h3>Camera</h3>
          <div className="imaging-actions">
            <button type="button" className="btn-control-secondary" onClick={() => { scene.current?.renderer.resetCamera(); render(); }}>Fit</button>
            <button type="button" className="btn-control-secondary" onClick={() => { scene.current?.renderer.resetCamera(); render(); }}>Reset</button>
          </div>
          <label className="imaging-check">
            <input type="checkbox" checked={surfaceOn} onChange={toggleSurface} />
            Show isosurface
          </label>
          <p className="imaging-note">{hu ? 'Presets use verified Hounsfield units when available.' : 'Presets use this volume’s own intensities.'}</p>
        </div>
      </aside>
    </div>
  );
}
