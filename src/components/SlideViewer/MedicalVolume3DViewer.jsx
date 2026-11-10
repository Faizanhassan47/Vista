import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';
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
import vtkAnnotatedCubeActor from '@kitware/vtk.js/Rendering/Core/AnnotatedCubeActor';
import vtkOrientationMarkerWidget from '@kitware/vtk.js/Interaction/Widgets/OrientationMarkerWidget';
import AnnotatedCubePresets from '@kitware/vtk.js/Rendering/Core/AnnotatedCubeActor/Presets';
import vtkLineSource from '@kitware/vtk.js/Filters/Sources/LineSource';
import vtkSphereSource from '@kitware/vtk.js/Filters/Sources/SphereSource';

const VOLUME_CACHE = new Map();
const VOLUME_CACHE_LIMIT = 6;

const HU_PRESETS = {
  'Air / lung attenuation': [-1000, -500],
  'Fat attenuation': [-190, -30],
  'Soft-tissue attenuation': [20, 100],
  'Dense material': [300, 1500],
};

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
  for (let index = 0; index < values.length; index += step) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    all.push(value);
    if (value > 0) foreground.push(value);
  }
  const pick = (list) => {
    const sorted = list.length ? list : [0];
    sorted.sort((left, right) => left - right);
    const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(fraction * (sorted.length - 1))))];
    return { p05: at(0.05), p25: at(0.25), p50: at(0.5), p75: at(0.75), p95: at(0.95), p99: at(0.99) };
  };
  return { all: pick(all), foreground: pick(foreground) };
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

function applyThresholdTransfer(property, color, opacity, low, high, colorName, opacityPct, spacing) {
  const rgb = THRESHOLD_COLORS[colorName] || THRESHOLD_COLORS.red;
  const peak = Math.max(0.02, Math.min(0.75, opacityPct / 100));
  const pad = Math.max(1, (high - low) * 0.02);
  color.removeAllPoints();
  opacity.removeAllPoints();
  color.addRGBPoint(low - pad, rgb[0] * 0.2, rgb[1] * 0.2, rgb[2] * 0.2);
  color.addRGBPoint(low, ...rgb);
  color.addRGBPoint((low + high) / 2, ...rgb);
  color.addRGBPoint(high, ...rgb);
  color.addRGBPoint(high + pad, rgb[0] * 0.2, rgb[1] * 0.2, rgb[2] * 0.2);
  opacity.addPoint(low - pad, 0);
  opacity.addPoint(low, peak * 0.55);
  opacity.addPoint((low + high) / 2, peak);
  opacity.addPoint(high, peak * 0.55);
  opacity.addPoint(high + pad, 0);
  configureVolumeLook(property, spacing, { shaded: true });
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
}) {
  const host = useRef(null);
  const scene = useRef(null);
  const [status, setStatus] = useState('Loading volume…');
  const [preview, setPreview] = useState(false);
  const [preset, setPreset] = useState(hu ? 'Soft tissue' : 'Brain detail');
  const [quality, setQuality] = useState(compact ? 'preview' : 'balanced');
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
  const unitLabel = hu ? 'HU' : 'intensity';

  useEffect(() => {
    const node = host.current;
    if (!node) return undefined;
    const initialQuality = compact ? 'preview' : 'balanced';
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
    const cubes = vtkImageMarchingCubes.newInstance({ contourValue: hu ? 300 : 80, computeNormals: true });
    const surfaceMapper = vtkMapper.newInstance();
    surfaceMapper.setInputConnection(cubes.getOutputPort());
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
    scene.current = {
      view, actor, mapper, color, opacityFn, renderer, cubes, surface, orientation,
      crossX, crossY, crossZ, probe, probeSource,
      quality: initialQuality, surfaceReady: false, spacing: [1, 1, 1], dims: [1, 1, 1], shaded: true,
    };

    const setSampleMode = (interacting) => {
      const current = scene.current;
      if (!current?.spacing) return;
      const factor = sampleFactorFor(current.quality || initialQuality, interacting);
      current.mapper.setSampleDistance(Math.min(...current.spacing) * factor);
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
    setThresholdOn(false);
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
        const activePreset = hu ? 'Soft tissue' : 'Brain detail';
        setPreset(activePreset);
        applyTransfer(
          current.actor.getProperty(),
          current.color,
          current.opacityFn,
          activePreset,
          hu,
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

  function paintThreshold(low, high, colorName, opacityPct) {
    const current = scene.current;
    if (!current) return;
    applyThresholdTransfer(
      current.actor.getProperty(),
      current.color,
      current.opacityFn,
      low,
      high,
      colorName,
      opacityPct,
      current.spacing,
    );
    const rgb = THRESHOLD_COLORS[colorName] || THRESHOLD_COLORS.red;
    ensureSurface((low + high) / 2);
    current.surface.getProperty().setColor(...rgb);
    current.surface.getProperty().setOpacity(Math.max(0.15, opacityPct / 100));
    current.surface.setVisibility(true);
    current.actor.setVisibility(true);
  }

  function updateOpacity(value) {
    setOpacity(value);
    const current = scene.current;
    if (!current) return;
    if (thresholdOn && huVisible) {
      const low = Number(huMin);
      const high = Number(huMax);
      if (Number.isFinite(low) && Number.isFinite(high)) {
        paintThreshold(low, high, huColor, huOpacity);
        render();
        return;
      }
    }
    const spacing = Math.min(...(current.spacing || [1]));
    current.actor.getProperty().setScalarOpacityUnitDistance(0, spacing * Math.max(0.6, 1.5 - value / 100));
    current.surface.getProperty().setOpacity(value / 100);
    render();
  }

  function updatePreset(name) {
    setPreset(name);
    setThresholdOn(false);
    setHuError('');
    if (!scene.current) return;
    restorePresetTransfer(name);
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
    setThresholdOn(true);
    setHuVisible(true);
    paintThreshold(low, high, huColor, huOpacity);
    render();
  }

  function clearThreshold() {
    setThresholdOn(false);
    setHuError('');
    restorePresetTransfer();
    render();
  }

  function toggleOverlay(checked) {
    setHuVisible(checked);
    const current = scene.current;
    if (!current || !thresholdOn) return;
    if (checked) {
      const low = Number(huMin);
      const high = Number(huMax);
      if (Number.isFinite(low) && Number.isFinite(high)) paintThreshold(low, high, huColor, huOpacity);
    } else {
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
    if (thresholdOn && huVisible) {
      ensureSurface((Number(huMin) + Number(huMax)) / 2);
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
