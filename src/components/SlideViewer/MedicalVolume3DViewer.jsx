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

function summarize(values) {
  const step = Math.max(1, Math.floor(values.length / 250000));
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

function applyTransfer(property, color, opacity, preset, hu, range, spacing) {
  color.removeAllPoints();
  opacity.removeAllPoints();
  const distance = Math.max(...(spacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
  if (hu && preset === 'Lung') {
    color.addRGBPoint(-1000, 0.15, 0.15, 0.15);
    color.addRGBPoint(-400, 0.85, 0.7, 0.55);
    opacity.addPoint(-1000, 0);
    opacity.addPoint(-700, 0.04);
    opacity.addPoint(-400, 0.12);
  } else if (hu && preset === 'Bone') {
    color.addRGBPoint(150, 0.55, 0.45, 0.35);
    color.addRGBPoint(400, 0.95, 0.9, 0.8);
    color.addRGBPoint(1500, 1, 1, 1);
    opacity.addPoint(150, 0);
    opacity.addPoint(300, 0.08);
    opacity.addPoint(800, 0.45);
  } else if (hu) {
    color.addRGBPoint(-200, 0, 0, 0);
    color.addRGBPoint(40, 0.75, 0.35, 0.28);
    color.addRGBPoint(300, 1, 0.9, 0.8);
    opacity.addPoint(-500, 0);
    opacity.addPoint(40, 0.03);
    opacity.addPoint(200, 0.12);
  } else {
    const tissue = range?.foreground || { p05: 1, p25: 20, p50: 40, p75: 60, p95: 80, p99: 90 };
    color.addRGBPoint(0, 0, 0, 0);
    color.addRGBPoint(tissue.p25, 0.25, 0.25, 0.25);
    color.addRGBPoint(tissue.p75, 0.7, 0.7, 0.7);
    color.addRGBPoint(tissue.p99, 1, 1, 1);
    opacity.addPoint(0, 0);
    opacity.addPoint(Math.max(tissue.p05 * 0.25, 0), 0);
    if (preset === 'High contrast') {
      opacity.addPoint(tissue.p25, 0.02);
      opacity.addPoint(tissue.p75, 0.16);
      opacity.addPoint(tissue.p99, 0.35);
    } else if (preset === 'Brain detail') {
      opacity.addPoint(tissue.p50, 0.015);
      opacity.addPoint(tissue.p75, 0.1);
      opacity.addPoint(tissue.p95, 0.22);
    } else if (preset === 'Vascular') {
      opacity.addPoint(tissue.p75, 0);
      opacity.addPoint(tissue.p95, 0.2);
      opacity.addPoint(tissue.p99, 0.55);
    } else {
      opacity.addPoint(tissue.p25, 0.02);
      opacity.addPoint(tissue.p75, 0.08);
      opacity.addPoint(tissue.p99, 0.2);
    }
  }
  // Opacity is defined per voxel. The mapper scales it by sampleDistance / unitDistance.
  property.setScalarOpacityUnitDistance(0, distance);
  property.setInterpolationTypeToLinear();
  property.setShade(true);
  property.setAmbient(0.2);
  property.setDiffuse(0.75);
  property.setSpecular(0.15);
  if (property.setUseGradientOpacity) property.setUseGradientOpacity(0, false);
  property.modified();
}

export default function MedicalVolume3DViewer({ slideId, hu }) {
  const host = useRef(null);
  const scene = useRef(null);
  const [status, setStatus] = useState('Loading volume…');
  const [preview, setPreview] = useState(false);
  const [preset, setPreset] = useState(hu ? 'Soft tissue' : 'Grayscale');
  const [quality, setQuality] = useState('high');
  const [dimensions, setDimensions] = useState('');
  const cameraRef = useRef(null);
  const [opacity, setOpacity] = useState(60);
  const [surfaceOn, setSurfaceOn] = useState(false);

  useEffect(() => {
    const node = host.current;
    let cancelled = false;
    const view = vtkGenericRenderWindow.newInstance({ background: [0.07, 0.09, 0.1] });
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
    scene.current = { view, actor, color, opacityFn, renderer, cubes, surface };

    apiFetch(`${API_BASE_URL}/api/slides/${slideId}/radiology/volume?quality=${quality}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.detail || 'This item cannot be shown as a 3D volume');
        }
        const dims = [Number(response.headers.get('X-Dim-I')), Number(response.headers.get('X-Dim-J')), Number(response.headers.get('X-Dim-K'))];
        const spacing = [Number(response.headers.get('X-Spacing-I')), Number(response.headers.get('X-Spacing-J')), Number(response.headers.get('X-Spacing-K'))];
        const reduced = response.headers.get('X-Preview') === '1';
        const buffer = await response.arrayBuffer();
        if (cancelled) return;
        const values = new Float32Array(buffer);
        const expected = dims.reduce((total, size) => total * size, 1);
        if (!dims.every((size) => size > 0) || values.length !== expected) {
          throw new Error('3D volume dimensions do not match the voxel data');
        }
        const safeSpacing = spacing.map((value) => (Number.isFinite(value) && value > 0 ? value : 1));
        const image = vtkImageData.newInstance();
        image.setDimensions(dims);
        image.setSpacing(...safeSpacing);
        image.getPointData().setScalars(vtkDataArray.newInstance({ name: 'Scalars', values, numberOfComponents: 1 }));
        mapper.setInputData(image);
        const sampleFactor = quality === 'high' ? 0.5 : quality === 'preview' ? 1.2 : 0.8;
        mapper.setSampleDistance(Math.min(...safeSpacing) * sampleFactor);
        cubes.setInputData(image);
        const range = summarize(values);
        scene.current.range = range;
        scene.current.spacing = safeSpacing;
        applyTransfer(actor.getProperty(), color, opacityFn, hu ? 'Soft tissue' : 'Grayscale', hu, range, safeSpacing);
        if (import.meta.env.DEV) {
          console.info('volume', { dims, spacing: safeSpacing, finite: values.length, percentiles: range, preview: reduced });
        }
        const saved = cameraRef.current;
        if (saved) {
          const camera = renderer.getActiveCamera();
          camera.setPosition(...saved.position);
          camera.setFocalPoint(...saved.focal);
          camera.setViewUp(...saved.up);
        } else {
          renderer.resetCamera();
        }
        setDimensions(dims.join(' × '));
        const box = node.getBoundingClientRect();
        if (box.width < 2 || box.height < 2) node.style.minHeight = '520px';
        view.resize();
        view.getRenderWindow().render();
        requestAnimationFrame(() => {
          view.resize();
          renderer.resetCamera();
          view.getRenderWindow().render();
        });
        setPreview(reduced);
        setStatus('');
      })
      .catch((error) => { if (!cancelled) setStatus(error.message); });

    const observer = new ResizeObserver(() => { view.resize(); view.getRenderWindow().render(); });
    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
      view.delete();
      scene.current = null;
    };
  }, [slideId, hu, quality]);

  function render() {
    scene.current?.view.getRenderWindow().render();
  }

  function updateOpacity(value) {
    setOpacity(value);
    const current = scene.current;
    if (!current) return;
    const spacing = Math.min(...(current.spacing || [1]));
    current.actor.getProperty().setScalarOpacityUnitDistance(0, spacing * Math.max(0.6, 1.5 - value / 100));
    current.surface.getProperty().setOpacity(value / 100);
    render();
  }

  function updatePreset(name) {
    setPreset(name);
    const current = scene.current;
    if (!current) return;
    applyTransfer(current.actor.getProperty(), current.color, current.opacityFn, name, hu, current.range, current.spacing);
    render();
  }

  function toggleSurface() {
    const next = !surfaceOn;
    setSurfaceOn(next);
    if (scene.current) {
      scene.current.surface.setVisibility(next);
      const tissue = scene.current.range?.foreground?.p75;
      scene.current.cubes.setContourValue(hu && preset === 'Lung' ? -500 : hu ? 300 : (Number.isFinite(tissue) ? tissue : 0));
      render();
    }
  }

  return (
    <div className="radiology-3d-layout">
      <div className="viewer radiology-stage medical-canvas radiology-3d">
        <div ref={host} className="radiology-3d__canvas" />
      </div>
      <aside className="imaging-panel">
        <h3>Rendering</h3>
        {status && <p className="imaging-note">{status}</p>}
        {preview && <p className="imaging-note">Reduced-resolution preview. The source volume was not changed.</p>}
        <p className="imaging-note">Drag to rotate. Scroll to zoom. Shift-drag pans when the VTK camera allows it.</p>
        <label>Preset
          <select value={preset} onChange={(event) => updatePreset(event.target.value)}>
            {(hu ? ['Soft tissue', 'Bone', 'Lung'] : ['Grayscale', 'High contrast', 'Brain detail', 'Vascular']).map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Quality
          <select value={quality} onChange={(event) => {
            const camera = scene.current?.renderer.getActiveCamera();
            if (camera) cameraRef.current = { position: [...camera.getPosition()], focal: [...camera.getFocalPoint()], up: [...camera.getViewUp()] };
            setQuality(event.target.value);
          }}>
            <option value="preview">Preview</option>
            <option value="balanced">Balanced</option>
            <option value="high">High quality</option>
          </select>
        </label>
        <label>Volume opacity {opacity}%<input type="range" min="10" max="100" value={opacity} onChange={(event) => updateOpacity(Number(event.target.value))} /></label>
        <h3>Camera</h3>
        <button type="button" className="btn-control-secondary" onClick={() => { scene.current?.renderer.resetCamera(); render(); }}>Fit volume</button>
        <button type="button" className="btn-control-secondary" onClick={() => { scene.current?.renderer.resetCamera(); render(); }}>Reset camera</button>
        <h3>Volume</h3>
        <p className="imaging-note">{dimensions ? `${quality} · ${dimensions}` : 'Waiting for volume dimensions.'}{preview ? ' · downsampled' : ''}</p>
        <p className="imaging-note">{hu ? 'Presets use verified Hounsfield units.' : 'Presets use this volume’s own intensities. CT Hounsfield presets are not applied.'} A cortical surface needs a segmentation mask, which this volume does not include.</p>
      </aside>
    </div>
  );
}
