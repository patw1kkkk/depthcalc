import assert from "node:assert/strict";
import { depthSampler } from "../packages/core/sample-depth";
import { extendShoreField } from "../packages/core/shore-field";
import { smoothSurface } from "../packages/core/surface-smoothing";
import type { analyze } from "../packages/core/survey";
const g = {
  minX: 0,
  minY: 0,
  step: 2,
  cols: 10,
  rows: 10,
  radius: 100,
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
        [0, 0],
      ],
    ],
  },
  nodes: Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 11 }, (_, x) =>
      x >= 3 && x <= 7 && y >= 3 && y <= 7 ? x * 2 + y * 2 : null,
    ),
  ),
  cells: [{ x: 9, y: 9, value: 17.2, count: 3 }],
} as ReturnType<typeof analyze>;
const ext = extendShoreField(g),
  at = depthSampler(g, true, ext),
  snapshot = JSON.stringify(g);
assert.equal(at([9, 9]), 18, "bilinear depth on sloping field");
assert.equal(at([6, 10]), 16, "exact supported node");
assert(
  Math.abs(at([2, 10])! - 16 / 3) < 1e-8,
  "shore extension barycentric interpolation",
);
assert.equal(at([21, 10]), null, "land");
assert.equal(
  depthSampler(g, true)([9, 19]),
  null,
  "unknown without a supported shore triangle",
);
assert.equal(
  depthSampler(g, false)([9, 9]),
  17.2,
  "OFF reports the rendered grid-cell value",
);
assert.equal(depthSampler(g, false)([2, 10]), null);
const island = {
  ...g,
  geometry: {
    type: "Polygon",
    coordinates: [
      (g.geometry as { coordinates: number[][][] }).coordinates[0],
      [
        [8, 8],
        [10, 8],
        [10, 10],
        [8, 10],
        [8, 8],
      ],
    ],
  },
} as typeof g;
assert.equal(depthSampler(island, true, ext)([9, 9]), null, "islands clipped");
const smooth = smoothSurface(g, 30);
assert.notEqual(
  depthSampler(smooth, true)([6, 6]),
  at([6, 6]),
  "read the selected smoothed field",
);
assert.equal(JSON.stringify(g), snapshot, "sampling never changes source");
console.log(
  "PASS: field values, smoothing, shore triangles, grid mode, clipping and immutable source.",
);
