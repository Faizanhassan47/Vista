import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api';
import { API_BASE_URL } from '../../config';
import { findHuTissuePreset, HU_TISSUE_PRESETS } from './huTissuePresets';
import {
  ASCLEPIOS_MIP_ID,
  applyAsclepiosFilter,
  findAsclepiosFilter,
  listAsclepiosFilterOptions,
} from './asclepiosFilters';
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

const THRESHOLD_COLORS = {
  red: [0.92, 0.18, 0.18],
  green: [0.2, 0.82, 0.28],
  blue: [0.2, 0.45, 0.95],
  yellow: [0.95, 0.85, 0.15],
};

function cacheKey(slideId, quality) {
  // calibrated-v2: float32 modality/HU scalars, never display-windowed 0–255
  return `${slideId}:${quality}:calibrated-v2`;
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
    max: Number.isFinite(max) ? max : 1,
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
  const along = (index, count, extent) => {
    if (count <= 1) return extent / 2;
    return (Math.max(0, Math.min(count - 1, index || 0)) / (count - 1)) * extent;
  };
  const i = along(cursor?.sagittal, safeCounts.sagittal, size[0]);
  const j = along(cursor?.coronal, safeCounts.coronal, size[1]);
  const k = along(cursor?.axial, safeCounts.axial, size[2]);
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
  // Asclepios-like unit distance keeps soft TF ramps readable without washing out the volume.
  property.setScalarOpacityUnitDistance(0, distance * 0.75);
  property.setInterpolationTypeToLinear();
  property.setShade(shaded);
  // Match Asclepios filter JSON shading (ambient/diffuse/specular) for a solid organ look.
  property.setAmbient(shaded ? 0.4 : 0.45);
  property.setDiffuse(shaded ? 0.7 : 0.45);
  property.setSpecular(shaded ? 0.55 : 0);
  property.setSpecularPower(shaded ? 48 : 1);
  if (property.setUseGradientOpacity) {
    property.setUseGradientOpacity(0, shaded);
    if (shaded && property.setGradientOpacityMinimumValue) {
      property.setGradientOpacityMinimumValue(0, 4);
      property.setGradientOpacityMaximumValue(0, 40);
      property.setGradientOpacityMinimumOpacity(0, 0);
      property.setGradientOpacityMaximumOpacity(0, 1);
    }
  }
  property.modified();
}

function classifyThresholdBand(lo, hi, tissueId) {
  if (tissueId && HU_TISSUE_PRESETS.some((item) => item.id === tissueId)) return tissueId;
  const mid = (lo + hi) / 2;
  if (mid <= -900) return 'air';
  if (mid < -200) return 'lung';
  if (mid < -20) return 'fat';
  if (mid < 20) return 'water';
  if (mid < 90) return 'soft';
  if (mid < 280) return 'contrast';
  if (mid < 450) return 'cancellous';
  if (mid < 2500) return 'cortical';
  return 'metal';
}

function mixRgb(base, tint, amount = 0.35) {
  const t = Math.max(0, Math.min(1, amount));
  return [
    base[0] * (1 - t) + tint[0] * t,
    base[1] * (1 - t) + tint[1] * t,
    base[2] * (1 - t) + tint[2] * t,
  ];
}

function applyTransfer(property, color, opacity, preset, hu, range, spacing, shaded = true) {
  color.removeAllPoints();
  opacity.removeAllPoints();
  if (hu && preset === 'Lung') {
    // Asclepios-style lung window: transparent air floor, soft parenchyma shell.
    color.addRGBPoint(-1000, 0.02, 0.02, 0.05);
    color.addRGBPoint(-850, 0.35, 0.22, 0.18);
    color.addRGBPoint(-650, 0.82, 0.55, 0.4);
    color.addRGBPoint(-450, 0.98, 0.88, 0.72);
    color.addRGBPoint(-200, 1, 0.96, 0.9);
    opacity.addPoint(-1000, 0);
    opacity.addPoint(-900, 0);
    opacity.addPoint(-750, 0.04);
    opacity.addPoint(-600, 0.12);
    opacity.addPoint(-450, 0.2);
    opacity.addPoint(-300, 0.06);
    opacity.addPoint(-150, 0);
  } else if (hu && preset === 'Bone') {
    // Asclepios BONES-like: hide soft tissue, ramp cortical density with white highlight.
    color.addRGBPoint(-1024, 0, 0, 0);
    color.addRGBPoint(150, 0.55, 0.25, 0.15);
    color.addRGBPoint(287, 0.9, 0.55, 0.3);
    color.addRGBPoint(500, 0.98, 0.9, 0.75);
    color.addRGBPoint(900, 1, 0.98, 0.95);
    color.addRGBPoint(1525, 1, 1, 1);
    opacity.addPoint(-1024, 0);
    opacity.addPoint(200, 0);
    opacity.addPoint(287, 0.08);
    opacity.addPoint(400, 0.22);
    opacity.addPoint(650, 0.42);
    opacity.addPoint(1000, 0.62);
    opacity.addPoint(1525, 0.72);
  } else if (hu) {
    // Soft-tissue / soft-skin style multi-band shell.
    color.addRGBPoint(-200, 0.02, 0.01, 0.01);
    color.addRGBPoint(-40, 0.45, 0.2, 0.15);
    color.addRGBPoint(40, 0.88, 0.48, 0.35);
    color.addRGBPoint(120, 0.98, 0.82, 0.65);
    color.addRGBPoint(300, 1, 0.96, 0.9);
    opacity.addPoint(-200, 0);
    opacity.addPoint(-60, 0);
    opacity.addPoint(10, 0.04);
    opacity.addPoint(60, 0.14);
    opacity.addPoint(140, 0.26);
    opacity.addPoint(280, 0.32);
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

function applyThresholdTransfer(property, color, opacity, low, high, colorName, opacityPct, spacing, dataRange, tissueId = '') {
  const tint = THRESHOLD_COLORS[colorName] || THRESHOLD_COLORS.red;
  // Overlay opacity slider maps to in-band peak; outside the HU interval stays transparent.
  const peak = Math.max(0.1, Math.min(0.85, opacityPct / 100));
  const floor = Number.isFinite(dataRange?.min) ? Math.min(dataRange.min, low) - 1 : low - 2048;
  const ceil = Number.isFinite(dataRange?.max) ? Math.max(dataRange.max, high) + 1 : high + 2048;
  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const span = Math.max(1, hi - lo);
  const edge = Math.max(2, Math.min(span * 0.18, span * 0.45));
  const band = classifyThresholdBand(lo, hi, tissueId);
  const a = lo + edge * 0.35;
  const b = lo + span * 0.45;
  const c = hi - edge * 0.35;

  // Asclepios-style anatomical base colors, lightly tinted by the overlay color control.
  let c0 = [0.15, 0.08, 0.06];
  let c1 = [0.75, 0.35, 0.22];
  let c2 = [0.98, 0.82, 0.62];
  let c3 = [1, 0.97, 0.92];
  let oA = peak * 0.18;
  let oB = peak * 0.55;
  let oC = peak * 0.78;
  let oHi = peak * 0.62;

  if (band === 'lung' || band === 'air') {
    c0 = [0.08, 0.06, 0.1];
    c1 = [0.55, 0.35, 0.28];
    c2 = [0.95, 0.78, 0.6];
    c3 = [1, 0.94, 0.88];
    oA = peak * 0.12;
    oB = peak * 0.42;
    oC = peak * 0.28;
    oHi = peak * 0.08;
  } else if (band === 'fat') {
    c0 = [0.12, 0.08, 0.04];
    c1 = [0.78, 0.55, 0.22];
    c2 = [0.98, 0.88, 0.55];
    c3 = [1, 0.96, 0.82];
    oA = peak * 0.16;
    oB = peak * 0.48;
    oC = peak * 0.4;
    oHi = peak * 0.22;
  } else if (band === 'soft' || band === 'water') {
    c0 = [0.1, 0.04, 0.04];
    c1 = [0.72, 0.32, 0.25];
    c2 = [0.95, 0.7, 0.52];
    c3 = [1, 0.94, 0.86];
    oA = peak * 0.14;
    oB = peak * 0.5;
    oC = peak * 0.58;
    oHi = peak * 0.36;
  } else if (band === 'contrast') {
    c0 = [0.2, 0.05, 0.05];
    c1 = [0.85, 0.18, 0.15];
    c2 = [0.98, 0.55, 0.35];
    c3 = [1, 0.9, 0.78];
    oA = peak * 0.1;
    oB = peak * 0.45;
    oC = peak * 0.72;
    oHi = peak * 0.55;
  } else if (band === 'cancellous' || band === 'cortical' || band === 'metal') {
    // Asclepios Bones-like: soft entry, dense white highlight at the high end.
    c0 = [0.45, 0.22, 0.12];
    c1 = [0.9, 0.55, 0.28];
    c2 = [0.98, 0.9, 0.75];
    c3 = [1, 1, 1];
    oA = peak * 0.12;
    oB = peak * 0.4;
    oC = peak * 0.7;
    oHi = peak * 0.82;
  }

  c0 = mixRgb(c0, tint, 0.28);
  c1 = mixRgb(c1, tint, 0.32);
  c2 = mixRgb(c2, tint, 0.22);
  c3 = mixRgb(c3, tint, 0.12);

  color.removeAllPoints();
  opacity.removeAllPoints();
  // Soft HU ramp: fully transparent outside [lo, hi], Asclepios-style curve inside.
  opacity.addPoint(floor, 0);
  opacity.addPoint(lo - 0.5, 0);
  opacity.addPoint(lo, 0);
  opacity.addPoint(a, oA);
  opacity.addPoint(b, oB);
  opacity.addPoint(Math.max(b, c), oC);
  opacity.addPoint(hi, oHi);
  opacity.addPoint(hi + 0.5, 0);
  opacity.addPoint(ceil, 0);

  color.addRGBPoint(floor, ...c0);
  color.addRGBPoint(lo, ...c0);
  color.addRGBPoint(a, ...c1);
  color.addRGBPoint(b, ...c2);
  color.addRGBPoint(Math.max(b, c), ...c3);
  color.addRGBPoint(hi, ...c3);
  color.addRGBPoint(ceil, ...c3);

  configureVolumeLook(property, spacing, { shaded: true });
  const distance = Math.min(...(spacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
  property.setScalarOpacityUnitDistance(0, distance * 0.62);
  property.modified();
}

function volumeDataRange(range) {
  if (Number.isFinite(range?.min) && Number.isFinite(range?.max)) {
    return {
      min: range.min,
      max: range.max,
      span: Math.max(1e-3, range.max - range.min),
      foreground: range.foreground || range.all,
    };
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
  const reduced = response.headers.get('X-Preview') === '1';  const dtype = (response.headers.get('X-Dtype') || 'float32').toLowerCase();
  if (dtype && dtype !== 'float32') {
    throw new Error(`Unsupported volume dtype ${dtype}; expected float32 calibrated scalars`);
  }
  const buffer = await response.arrayBuffer();
  // Copy into a dedicated Float32Array so VTK cannot reinterpret bytes as uint8/display data.
  const values = Float32Array.from(new Float32Array(buffer));
  const expected = dims.reduce((total, size) => total * size, 1);
  if (!dims.every((size) => size > 0) || values.length !== expected) {
    throw new Error('3D volume dimensions do not match the voxel data');
  }
  const headerMin = Number(response.headers.get('X-Value-Min'));
  const headerMax = Number(response.headers.get('X-Value-Max'));
  const range = summarize(values);
  if (Number.isFinite(headerMin) && Number.isFinite(headerMax)) {
    range.min = headerMin;
    range.max = headerMax;
  }
  const payload = {
    dims,
    spacing: spacing.map((value) => (Number.isFinite(value) && value > 0 ? value : 1)),
    values,
    reduced,
    range,
    intensityUnit: response.headers.get('X-Intensity-Unit') || null,
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
  const [volumeFilter, setVolumeFilter] = useState(hu ? 'bones' : 'Brain detail');
  const [quality, setQuality] = useState(compact ? 'preview' : 'balanced');
  const [dimensions, setDimensions] = useState('');
  const cameraRef = useRef(null);
  const [opacity, setOpacity] = useState(70);
  const asclepiosOptions = listAsclepiosFilterOptions();
  const [surfaceOn, setSurfaceOn] = useState(false);
  const [huMin, setHuMin] = useState('-1000');
  const [huMax, setHuMax] = useState('-500');
  const [huColor, setHuColor] = useState('red');
  const [huOpacity, setHuOpacity] = useState(55);
  const [huVisible, setHuVisible] = useState(true);
  const [thresholdOn, setThresholdOn] = useState(false);
  const [huError, setHuError] = useState('');
  const [huTissueId, setHuTissueId] = useState(hu ? 'air' : '');
  const unitLabel = hu ? 'HU' : 'intensity';
  const selectedTissue = findHuTissuePreset(huTissueId);

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

    const crossX = makeLineActor([1, 0.2, 0.18]);
    const crossY = makeLineActor([0.2, 0.85, 0.35]);
    const crossZ = makeLineActor([0.25, 0.55, 1]);
    crossX.actor.getProperty().setLineWidth(3);
    crossY.actor.getProperty().setLineWidth(3);
    crossZ.actor.getProperty().setLineWidth(3);
    const probeSource = vtkSphereSource.newInstance({ radius: 1.5, thetaResolution: 20, phiResolution: 20 });
    const probeMapper = vtkMapper.newInstance();
    probeMapper.setInputConnection(probeSource.getOutputPort());
    const probe = vtkActor.newInstance();
    probe.setMapper(probeMapper);
    probe.getProperty().setColor(1, 0.9, 0.15);
    probe.getProperty().setOpacity(1);
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
      blendMode: 'composite',
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
      // Keep interaction snappy; restore the active Asclepios/legacy look when the camera settles.
      const property = current.actor.getProperty();
      if (interacting) {
        property.setShade(false);
        if (property.setUseGradientOpacity) property.setUseGradientOpacity(0, false);
      } else if (typeof current.restoreLook === 'function') {
        current.restoreLook();
      } else {
        configureVolumeLook(property, current.spacing, { shaded: current.shaded !== false });
      }
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
          dataType: 'Float32Array',
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
        const extent = Math.min(...payload.spacing) * 2.2;
        current.probeSource.setRadius(Math.max(extent, 1.2));
        const activeFilter = hu ? 'bones' : 'Brain detail';
        setPreset(hu ? 'Soft tissue' : activeFilter);
        setVolumeFilter(activeFilter);
        applyVolumeLook(activeFilter, payload.range, payload.spacing);
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
        if (!hu) {
          const mid = intensityPresetRange('mid', payload.range);
          if (mid) {
            setHuTissueId('');
            setHuMin(String(Math.round(mid[0])));
            setHuMax(String(Math.round(mid[1])));
          }
        } else {
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

  function setMapperBlend(mode) {
    const current = scene.current;
    if (!current?.mapper) return;
    current.blendMode = mode;
    if (mode === 'mip') {
      if (current.mapper.setBlendModeToMaximumIntensity) current.mapper.setBlendModeToMaximumIntensity();
      else if (current.mapper.setBlendMode) current.mapper.setBlendMode(1);
    } else if (current.mapper.setBlendModeToComposite) {
      current.mapper.setBlendModeToComposite();
    } else if (current.mapper.setBlendMode) {
      current.mapper.setBlendMode(0);
    }
  }

  function applyMipTransfer(range, spacing) {
    const current = scene.current;
    if (!current) return;
    const dataRange = volumeDataRange(range || current.range) || { min: -1000, max: 1000 };
    const { color, opacityFn } = current;
    const property = current.actor.getProperty();
    color.removeAllPoints();
    opacityFn.removeAllPoints();
    color.addRGBPoint(dataRange.min, 1, 1, 1);
    color.addRGBPoint(dataRange.max, 1, 1, 1);
    opacityFn.addPoint(dataRange.min, 0);
    opacityFn.addPoint(dataRange.min + (dataRange.max - dataRange.min) * 0.15, 0.05);
    opacityFn.addPoint(dataRange.max, 0.95);
    property.setInterpolationTypeToLinear();
    property.setShade(false);
    property.setAmbient(0.1);
    property.setDiffuse(0.7);
    property.setSpecular(0);
    if (property.setUseGradientOpacity) property.setUseGradientOpacity(0, false);
    const distance = Math.min(...(spacing || current.spacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
    property.setScalarOpacityUnitDistance(0, distance * Math.max(0.45, 1.2 - opacity / 100));
    property.modified();
  }

  function applyVolumeLook(filterId = volumeFilter, range = null, spacing = null) {
    const current = scene.current;
    if (!current) return;
    const nextRange = range || current.range;
    const nextSpacing = spacing || current.spacing;
    const run = () => {
      if (hu && filterId === ASCLEPIOS_MIP_ID) {
        setMapperBlend('mip');
        applyMipTransfer(nextRange, nextSpacing);
      } else if (hu && findAsclepiosFilter(filterId)) {
        setMapperBlend('composite');
        applyAsclepiosFilter(
          current.actor.getProperty(),
          current.color,
          current.opacityFn,
          findAsclepiosFilter(filterId),
          nextSpacing,
        );
        const step = Math.min(...(nextSpacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
        current.actor.getProperty().setScalarOpacityUnitDistance(0, step * Math.max(0.55, 1.45 - opacity / 100));
      } else {
        setMapperBlend('composite');
        applyTransfer(
          current.actor.getProperty(),
          current.color,
          current.opacityFn,
          filterId || preset,
          hu,
          nextRange,
          nextSpacing,
          true,
        );
        const step = Math.min(...(nextSpacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
        current.actor.getProperty().setScalarOpacityUnitDistance(0, step * Math.max(0.6, 1.5 - opacity / 100));
      }
    };
    run();
    current.restoreLook = run;
    current.actor.setVisibility(true);
    current.surface.setVisibility(surfaceOn && current.surfaceReady);
  }

  function restorePresetTransfer(name = volumeFilter) {
    applyVolumeLook(name);
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
    const dataRange = volumeDataRange(current.range);
    const run = () => applyThresholdTransfer(
      current.actor.getProperty(),
      current.color,
      current.opacityFn,
      low,
      high,
      colorName,
      opacityPct,
      current.spacing,
      dataRange,
      huTissueId,
    );
    run();
    current.restoreLook = run;
    current.actor.setVisibility(true);
    // Volume thresholding stays separate from surface extraction.
    if (surfaceOn) {
      const rgb = THRESHOLD_COLORS[colorName] || THRESHOLD_COLORS.red;
      ensureSurface((low + high) / 2);
      current.surface.getProperty().setColor(...rgb);
      current.surface.getProperty().setOpacity(Math.max(0.2, Math.min(0.85, opacityPct / 100)));
      current.surface.setVisibility(true);
    } else {
      current.surface.setVisibility(false);
    }
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
    setVolumeFilter(name);
    setThresholdOn(false);
    setHuError('');
    if (!scene.current) return;
    applyVolumeLook(name);
    render();
  }

  function updateVolumeFilter(id) {
    setVolumeFilter(id);
    if (!hu) setPreset(id);
    setThresholdOn(false);
    setHuError('');
    if (!scene.current) return;
    applyVolumeLook(id);
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
    // Same rule as 2D: allow any numeric interval; only warn when it misses the true scalar extent.
    const dataRange = volumeDataRange(scene.current.range);
    if (dataRange && (high < dataRange.min || low > dataRange.max)) {
      setHuError(
        `No voxels in ${low}–${high} ${unitLabel} (volume scalars ~${Math.round(dataRange.min)}–${Math.round(dataRange.max)}).`,
      );
    } else {
      setHuError('');
    }
    setThresholdOn(true);
    setHuVisible(true);
    setMapperBlend('composite');
    paintThreshold(low, high, huColor, huOpacity);
    render();
  }

  function clearThreshold() {
    setThresholdOn(false);
    setHuError('');
    restorePresetTransfer();
    if (scene.current) {
      scene.current.surface.setVisibility(surfaceOn && scene.current.surfaceReady);
    }
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
    const current = scene.current;
    if (!current) return;
    if (!next) {
      current.surface.setVisibility(false);
      render();
      return;
    }
    const low = Number(huMin);
    const high = Number(huMax);
    if (thresholdOn && huVisible && Number.isFinite(low) && Number.isFinite(high)) {
      // HU-based surface: same interval as volume threshold; contour at mid-HU for inspection.
      const rgb = THRESHOLD_COLORS[huColor] || THRESHOLD_COLORS.red;
      ensureSurface((low + high) / 2);
      current.surface.getProperty().setColor(...rgb);
      current.surface.getProperty().setOpacity(Math.max(0.2, Math.min(0.85, huOpacity / 100)));
    } else {
      const tissue = current.range?.foreground?.p75;
      ensureSurface(hu && preset === 'Lung' ? -500 : hu ? 300 : (Number.isFinite(tissue) ? tissue : 0));
    }
    current.surface.setVisibility(true);
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
        {showCrosshair && cursor ? (
          <div className="radiology-overlay radiology-overlay--tl">
            <span>
              Cursor A{cursor.axial + 1}/C{cursor.coronal + 1}/S{cursor.sagittal + 1}
            </span>
          </div>
        ) : null}
      </div>
      <aside className="imaging-panel" aria-label="3D imaging controls">
        <div className="imaging-panel__section">
          <h3>Display</h3>
          <p className="imaging-dims">{dimensions || 'Loading…'}</p>
          <p className="imaging-note">3D volume{preview ? ' · downsampled' : ''} · {quality}</p>
          {status && <p className="imaging-note imaging-note--error">{status}</p>}
          <p className="imaging-note">Use Preview while exploring. Balanced/High are slower.</p>
          {hu ? (
            <label>3D filter (Asclepios-style)
              <select
                value={volumeFilter}
                onChange={(event) => updateVolumeFilter(event.target.value)}
                disabled={thresholdOn && huVisible}
              >
                {asclepiosOptions.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>Rendering preset
              <select value={preset} onChange={(event) => updatePreset(event.target.value)} disabled={thresholdOn && huVisible}>
                {['Grayscale', 'High contrast', 'Brain detail', 'Vascular'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          )}
          {hu && (
            <p className="imaging-note">
              Clinical volume looks from Asclepios (Bones, Soft Skin, Airways, MIP…). Threshold Apply still works as an exact HU mask.
            </p>
          )}
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
              <button type="submit" className="btn-control-secondary">Apply</button>
              <button type="button" className="btn-control-secondary" onClick={clearThreshold}>Clear</button>
            </div>
            {huError && <p className="imaging-note imaging-note--error">{huError}</p>}
            {thresholdOn && (
              <p className="imaging-note">
                HU volume threshold {huMin}–{huMax} {unitLabel}: soft opacity ramp with shading (Asclepios-style).
                Outside this interval stays transparent. Wide bands can still include air and look cloudy.
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
            HU surface (isosurface)
          </label>
          <p className="imaging-note">
            {thresholdOn
              ? 'Surface uses the same HU interval as Apply, but draws a mid-HU contour for clearer anatomy. Volume and surface are independent modes.'
              : (hu ? 'CT volumes use calibrated HU (same scale as 2D). Enable surface after Apply for a contour view.' : 'Presets use this volume’s own intensities.')}
          </p>
        </div>
      </aside>
    </div>
  );
}
