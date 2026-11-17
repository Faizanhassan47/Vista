import { describe, expect, it } from 'vitest';
import {
  FULL_BOX,
  boxDefinitions,
  clampBoxFractions,
  indexToWorld,
  planeDefinition,
  planeKeepsPoint,
} from './volumeClip';

const anisotropic = {
  origin: [10, -4, 2],
  spacing: [0.5, 2, 3],
  direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  dims: [5, 4, 3],
};

const rotated = {
  origin: [0, 0, 0],
  spacing: [1, 1, 1],
  direction: [0, 1, 0, -1, 0, 0, 0, 0, 1],
  dims: [3, 3, 3],
};

describe('volume clipping geometry', () => {
  it('places a plane on the image axis using origin and spacing', () => {
    const plane = planeDefinition(anisotropic, { axis: 0, fraction: 0.5, reverse: false });
    expect(plane.origin[0]).toBeCloseTo(11);
    expect(plane.normal).toEqual([1, 0, 0]);
    const low = indexToWorld([0, 1.5, 1], anisotropic);
    const high = indexToWorld([4, 1.5, 1], anisotropic);
    expect(planeKeepsPoint(low, plane)).toBe(false);
    expect(planeKeepsPoint(high, plane)).toBe(true);
  });

  it('reverses which side of the plane stays visible', () => {
    const plane = planeDefinition(anisotropic, { axis: 2, fraction: 0, reverse: true });
    const inside = indexToWorld([2, 1.5, 0], anisotropic);
    const above = indexToWorld([2, 1.5, 2], anisotropic);
    expect(planeKeepsPoint(inside, plane)).toBe(true);
    expect(planeKeepsPoint(above, plane)).toBe(false);
  });

  it('keeps the whole volume when the plane sits on the near boundary', () => {
    const plane = planeDefinition(anisotropic, { axis: 1, fraction: 0, reverse: false });
    const far = indexToWorld([2, 3, 1], anisotropic);
    expect(planeKeepsPoint(far, plane)).toBe(true);
  });

  it('follows a rotated direction matrix', () => {
    const plane = planeDefinition(rotated, { axis: 0, fraction: 0.5, reverse: false });
    expect(plane.normal[0]).toBeCloseTo(0);
    expect(plane.normal[1]).toBeCloseTo(1);
    const kept = indexToWorld([2, 1, 1], rotated);
    const cut = indexToWorld([0, 1, 1], rotated);
    expect(planeKeepsPoint(kept, plane)).toBe(true);
    expect(planeKeepsPoint(cut, plane)).toBe(false);
  });

  it('does not let a box minimum pass its maximum', () => {
    const box = clampBoxFractions({ xMin: 0.8, xMax: 0.2, yMin: 0.5, yMax: 0.5, zMin: 0, zMax: 1 });
    expect(box.xMin).toBeCloseTo(0.2);
    expect(box.xMax).toBeCloseTo(0.8);
    expect(box.yMax).toBeGreaterThan(box.yMin);
  });

  it('keeps only the inside of the six box planes', () => {
    const planes = boxDefinitions(anisotropic, { xMin: 0.25, xMax: 0.75, yMin: 0, yMax: 1, zMin: 0, zMax: 1 });
    expect(planes).toHaveLength(6);
    const inside = indexToWorld([2, 1, 1], anisotropic);
    const outside = indexToWorld([0, 1, 1], anisotropic);
    expect(planes.every((plane) => planeKeepsPoint(inside, plane))).toBe(true);
    expect(planes.every((plane) => planeKeepsPoint(outside, plane))).toBe(false);
  });

  it('reset fractions describe the full physical extent', () => {
    const planes = boxDefinitions(anisotropic, FULL_BOX);
    const corner = indexToWorld([0, 0, 0], anisotropic);
    const far = indexToWorld([4, 3, 2], anisotropic);
    expect(planes.every((plane) => planeKeepsPoint(corner, plane))).toBe(true);
    expect(planes.every((plane) => planeKeepsPoint(far, plane))).toBe(true);
  });
});
