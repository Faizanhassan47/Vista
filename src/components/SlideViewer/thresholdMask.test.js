import { keepLargestComponent, thresholdMask } from './thresholdMask';

const values = Float32Array.from([-1024, -950, -800, -600, -500, 0, 40, 400, 1000, 1500, Number.NaN]);

test('lung and bone ranges use inclusive bounds and skip non-finite values', () => {
  const lung = thresholdMask(values, -950, -600);
  expect(Array.from(lung.mask)).toEqual([0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0]);
  expect(lung.count).toBe(3);
  const bone = thresholdMask(values, 400, 1500);
  expect(bone.count).toBe(3);
  expect(thresholdMask(values, 2000, 3000).count).toBe(0);
  expect(thresholdMask(values, -3024, -3024).count).toBe(0);
});

test('largest piece keeps the bigger physical component and exact mode does not call it', () => {
  const mask = Uint8Array.from([1, 1, 0, 1, 0, 0, 0, 0]);
  const kept = keepLargestComponent(mask, [4, 2, 1], [1, 2, 3]);
  expect(kept).toBe(2);
  expect(Array.from(mask)).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
});
