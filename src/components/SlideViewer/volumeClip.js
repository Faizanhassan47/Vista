const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function directionOf(direction) {
  return direction && direction.length === 9 ? direction : IDENTITY;
}

function finiteTriple(values, fallback) {
  if (!values || values.length < 3) return fallback.slice();
  return [0, 1, 2].map((index) => (Number.isFinite(values[index]) ? values[index] : fallback[index]));
}

export function indexToWorld(index, geometry) {
  const origin = finiteTriple(geometry?.origin, [0, 0, 0]);
  const spacing = finiteTriple(geometry?.spacing, [1, 1, 1]).map((value) => (value > 0 ? value : 1));
  const direction = directionOf(geometry?.direction);
  const scaled = [0, 1, 2].map((axis) => index[axis] * spacing[axis]);
  return [0, 1, 2].map((row) => (
    origin[row]
    + direction[row] * scaled[0]
    + direction[row + 3] * scaled[1]
    + direction[row + 6] * scaled[2]
  ));
}

export function imageAxis(geometry, axis) {
  const direction = directionOf(geometry?.direction);
  const column = [direction[axis * 3], direction[axis * 3 + 1], direction[axis * 3 + 2]];
  const length = Math.hypot(...column) || 1;
  return column.map((value) => value / length);
}

function axisExtent(geometry, axis) {
  const dims = geometry?.dims || [1, 1, 1];
  return Math.max((Number(dims[axis]) || 1) - 1, 0);
}

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function centerIndex(geometry, axis, along) {
  return [0, 1, 2].map((index) => (index === axis ? along : axisExtent(geometry, index) / 2));
}

export function planeDefinition(geometry, { axis = 0, fraction = 0, reverse = false } = {}) {
  const safeAxis = axis === 1 || axis === 2 ? axis : 0;
  const along = clamp01(fraction) * axisExtent(geometry, safeAxis);
  const direction = imageAxis(geometry, safeAxis);
  const normal = reverse ? direction.map((value) => -value) : direction;
  return {
    origin: indexToWorld(centerIndex(geometry, safeAxis, along), geometry),
    normal,
  };
}

export function clampBoxFractions(box) {
  const next = {};
  ['x', 'y', 'z'].forEach((name, axis) => {
    let min = clamp01(box?.[`${name}Min`]);
    let max = clamp01(box?.[`${name}Max`]);
    if (min > max) [min, max] = [max, min];
    if (max - min < 0.001) {
      if (max >= 1) min = 0.999;
      else max = Math.min(1, min + 0.001);
    }
    next[axis] = [min, max];
    next[`${name}Min`] = min;
    next[`${name}Max`] = max;
  });
  return next;
}

export function boxDefinitions(geometry, box) {
  const fractions = clampBoxFractions(box);
  const planes = [];
  [0, 1, 2].forEach((axis) => {
    const [minFraction, maxFraction] = fractions[axis];
    const direction = imageAxis(geometry, axis);
    const extent = axisExtent(geometry, axis);
    planes.push({
      origin: indexToWorld(centerIndex(geometry, axis, minFraction * extent), geometry),
      normal: direction,
    });
    planes.push({
      origin: indexToWorld(centerIndex(geometry, axis, maxFraction * extent), geometry),
      normal: direction.map((value) => -value),
    });
  });
  return planes;
}

export function boxCorners(geometry, box) {
  const fractions = clampBoxFractions(box);
  const corners = [];
  [0, 1].forEach((x) => {
    [0, 1].forEach((y) => {
      [0, 1].forEach((z) => {
        const picks = [x, y, z];
        const index = [0, 1, 2].map((axis) => fractions[axis][picks[axis]] * axisExtent(geometry, axis));
        corners.push(indexToWorld(index, geometry));
      });
    });
  });
  return corners;
}

export function planeKeepsPoint(point, plane) {
  const delta = [
    point[0] - plane.origin[0],
    point[1] - plane.origin[1],
    point[2] - plane.origin[2],
  ];
  return delta[0] * plane.normal[0] + delta[1] * plane.normal[1] + delta[2] * plane.normal[2] >= -1e-6;
}

export const FULL_BOX = { xMin: 0, xMax: 1, yMin: 0, yMax: 1, zMin: 0, zMax: 1 };
