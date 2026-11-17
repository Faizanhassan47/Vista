/** Inclusive intensity mask. Non-finite values, including padding stored as NaN, are not selected. */
export function thresholdMask(values, low, high) {
  const mask = new Uint8Array(values.length);
  let count = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (Number.isFinite(value) && value >= low && value <= high) {
      mask[index] = 1;
      count += 1;
    }
  }
  return { mask, count };
}

/**
 * Keep the connected piece with the largest physical volume.
 * Voxel volume is spacingX * spacingY * spacingZ, so anisotropic spacing is included.
 * Disabled by default; exact HU mode must not call this.
 */
export function keepLargestComponent(mask, dims, spacing) {
  const [nx, ny, nz] = dims;
  const slice = nx * ny;
  const voxelMm3 = Math.abs(spacing[0] * spacing[1] * spacing[2]) || 1;
  const labels = new Int32Array(mask.length);
  let label = 0;
  let bestLabel = 0;
  let bestMm3 = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index] || labels[index]) continue;
    label += 1;
    const stack = [index];
    labels[index] = label;
    let count = 0;
    while (stack.length) {
      const point = stack.pop();
      count += 1;
      const x = point % nx;
      const y = Math.floor((point % slice) / nx);
      const z = Math.floor(point / slice);
      const tryNeighbor = (neighbor) => {
        if (mask[neighbor] && !labels[neighbor]) {
          labels[neighbor] = label;
          stack.push(neighbor);
        }
      };
      if (x > 0) tryNeighbor(point - 1);
      if (x + 1 < nx) tryNeighbor(point + 1);
      if (y > 0) tryNeighbor(point - nx);
      if (y + 1 < ny) tryNeighbor(point + nx);
      if (z > 0) tryNeighbor(point - slice);
      if (z + 1 < nz) tryNeighbor(point + slice);
    }
    const volumeMm3 = count * voxelMm3;
    if (volumeMm3 > bestMm3) {
      bestMm3 = volumeMm3;
      bestLabel = label;
    }
  }
  if (!bestLabel) return 0;
  let kept = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (labels[index] === bestLabel) kept += 1;
    else mask[index] = 0;
  }
  return kept;
}
