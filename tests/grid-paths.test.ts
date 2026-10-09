import assert from "node:assert/strict";
import { gridPaths } from "../packages/core/grid-paths";
import type { analyze, Coord } from "../packages/core/survey";
const cols = 200,
  rows = 100;
const cells = Array.from({ length: rows }, (_, y) =>
  Array.from({ length: cols }, (_, x) => ({
    x: x + 0.5,
    y: y + 0.5,
    count: 3,
    value: x < 100 ? 6 : null,
  })),
).flat();
const grid = { minX: 0, minY: 0, step: 1, cols, rows, cells } as ReturnType<
  typeof analyze
>;
let calls = 0;
const project = ([x, y]: Coord): Coord => {
  calls++;
  return [x, rows - y];
};
const before = JSON.stringify(grid),
  paths = gridPaths(grid, 2, project, cols, rows);
assert.equal(
  paths.length,
  rows * 2,
  "20,000 cells need only 200 ordered drawing paths",
);
assert.equal(
  calls,
  cols + rows + 2,
  "projection work scales with axes, not number of cells",
);
assert.equal(
  paths.reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0),
  cells.length,
  "all grid cells remain represented",
);
assert.equal(paths[0].fill, "rgb(250,252,253)");
assert.equal(paths[1].fill, "url(#unknown)");
assert(
  paths[0].d.startsWith("M0,99h1.5v1.5h-1.5Z"),
  "original half-pixel overlap preserved",
);
const cropped = gridPaths(grid, 2, ([x, y]) => [x - 150, 100 - y], 20, 20);
assert(
  cropped.every((p) => p.fill === "url(#unknown)"),
  "viewport clipping preserves no-data area",
);
assert(
  cropped.reduce((n, p) => n + (p.d.match(/M/g)?.length ?? 0), 0) <
    cells.length / 10,
);
assert.equal(
  JSON.stringify(grid),
  before,
  "rendering never mutates source data",
);
console.log(
  "PASS: batched geometry, color/no-data order, overlap, viewport clipping, bounded projection work, immutable grid.",
);
