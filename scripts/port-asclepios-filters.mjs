import fs from 'fs';
import path from 'path';

const srcDir = path.resolve('git code/Asclepios-DICOM-Viewer/src/gui/res/filters3d');
const outFile = path.resolve('frontend/src/components/SlideViewer/asclepiosFilters.js');
const files = [
  'BONES.json',
  'SOFTSKIN.json',
  'AIRWAYS.json',
  'TORAX.json',
  'SPINE.json',
  'BONESSKIN.json',
  'DARKBONE.json',
  'GOLDBONE.json',
  'CAROTIDS.json',
  'PELVIS.json',
  'YELLOWBONE.json',
  'ABDOMEN_BONES.json',
];

const filters = files.map((file) => {
  const data = JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));
  return { id: file.replace(/\.json$/i, '').toLowerCase(), ...data };
});

const src = `/** Asclepios DICOM Viewer 3D transfer-function presets (ported from filters3d/*.json). */
export const ASCLEPIOS_FILTERS = ${JSON.stringify(filters, null, 2)};

export const ASCLEPIOS_MIP_ID = 'mip';

export function listAsclepiosFilterOptions() {
  return [
    ...ASCLEPIOS_FILTERS.map((filter) => ({ id: filter.id, label: filter.name })),
    { id: ASCLEPIOS_MIP_ID, label: 'MIP' },
  ];
}

export function findAsclepiosFilter(id) {
  if (!id || id === ASCLEPIOS_MIP_ID) return null;
  return ASCLEPIOS_FILTERS.find((item) => item.id === id) || null;
}

/**
 * Apply an Asclepios JSON filter to VTK.js volume property + TF objects.
 * Window/level mapping matches Asclepios TransferFunction::updateWindowLevel (window=1000, level=0).
 */
export function applyAsclepiosFilter(property, colorFn, opacityFn, filter, spacing, { window = 1000, level = 0 } = {}) {
  if (!filter) return;
  colorFn.removeAllPoints();
  opacityFn.removeAllPoints();
  const mapValue = (value) => level + (window * value) / 1000;
  for (const point of filter.color || []) {
    colorFn.addRGBPoint(mapValue(point.value), point.red, point.green, point.blue);
  }
  for (const point of filter.opacity || []) {
    opacityFn.addPoint(mapValue(point.value), point.alpha);
  }
  const ambient = filter.ambient?.value ?? 0.4;
  const diffuse = filter.diffuse?.value ?? 0.7;
  const specular = filter.specular?.value ?? 1;
  const specularPower = filter.specularpower?.value ?? 64;
  const shade = Boolean(filter.shade?.value ?? 1);
  property.setInterpolationTypeToLinear();
  property.setShade(shade);
  property.setAmbient(ambient);
  property.setDiffuse(diffuse);
  property.setSpecular(shade ? specular : 0);
  property.setSpecularPower(shade ? specularPower : 1);
  if (property.setUseGradientOpacity) {
    property.setUseGradientOpacity(0, shade);
    if (shade && property.setGradientOpacityMinimumValue) {
      property.setGradientOpacityMinimumValue(0, 4);
      property.setGradientOpacityMaximumValue(0, 40);
      property.setGradientOpacityMinimumOpacity(0, 0);
      property.setGradientOpacityMaximumOpacity(0, 1);
    }
  }
  const distance = Math.max(...(spacing || [1]).map((value) => (Number.isFinite(value) && value > 0 ? value : 1)));
  property.setScalarOpacityUnitDistance(0, distance * 0.75);
  property.modified();
}
`;

fs.writeFileSync(outFile, src);
const jsonPath = path.resolve('frontend/src/components/SlideViewer/asclepiosFilters.json');
if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
console.log(`Wrote ${filters.length} filters -> ${outFile}`);
