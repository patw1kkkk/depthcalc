import assert from "node:assert/strict";
import {
  smoothSurface,
  smoothingSigma,
} from "../packages/core/surface-smoothing";
import { analyze, contours, type Coord } from "../packages/core/survey";
import { filledContours } from "../packages/core/filled-contours";
import { extendShoreField } from "../packages/core/shore-field";
import type { WaterGeometry } from "../packages/core/geometry";
type Grid = ReturnType<typeof analyze>;
function grid(f: (x: number, y: number) => number | null, step = 2): Grid {
  const cols = 60,
    rows = 60,
    nodes = Array.from({ length: rows + 1 }, (_, y) =>
      Array.from({ length: cols + 1 }, (_, x) => f(x * step, y * step)),
    );
  return {
    cols,
    rows,
    nodes,
    step,
    minX: 0,
    minY: 0,
    width: cols * step,
    height: rows * step,
    radius: 100,
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-1, -1],
          [cols * step + 1, -1],
          [cols * step + 1, rows * step + 1],
          [-1, rows * step + 1],
          [-1, -1],
        ],
      ],
    },
    cells: nodes
      .slice(0, -1)
      .flatMap((row, y) =>
        row
          .slice(0, -1)
          .map((value, x) => ({
            x: (x + 0.5) * step,
            y: (y + 0.5) * step,
            count: 3,
            value,
          })),
      ),
  } as Grid;
}
const numeric = (g: Grid) =>
  g.nodes.flat().filter((z): z is number => z !== null);
const mean = (g: Grid) =>
  numeric(g).reduce((a, b) => a + b, 0) / numeric(g).length;
const energy = (g: Grid) =>
  g.nodes.reduce(
    (s, row, y) =>
      s +
      row.reduce<number>(
        (t, z, x) =>
          t +
          (z === null
            ? 0
            : [row[x + 1], g.nodes[y + 1]?.[x]].reduce<number>(
                (v, n) => v + (n == null ? 0 : (n - z) ** 2),
                0,
              )),
        0,
      ),
    0,
  );
const g = grid(
  (x, y) =>
    8 +
    8 * Math.exp(-((x - 60) ** 2 + (y - 60) ** 2) / 900) +
    (x === 50 && y === 60 ? 8 : 0) +
    (x === 70 && y === 60 ? 8 : 0),
);
const original = JSON.stringify(g),
  zero = smoothSurface(g, 0);
assert.equal(zero, g, "zero is exact identity, not a numerical approximation");
const strengths = [0, 1, 10, 30, 60, 100],
  fields = strengths.map((s) => smoothSurface(g, s));
for (let i = 0; i < fields.length; i++) {
  const out = fields[i];
  assert(Math.abs(mean(out) - mean(g)) < 1e-10, "no overall depth shift");
  assert(Math.max(...numeric(out)) <= Math.max(...numeric(g)) + 1e-10);
  assert(Math.min(...numeric(out)) >= Math.min(...numeric(g)) - 1e-10);
  if (i)
    assert(
      energy(out) < energy(fields[i - 1]),
      "progressively less small-scale variation",
    );
}
assert.equal(JSON.stringify(g), original, "input not mutated");
assert(
  fields[3].nodes[30][25]! < g.nodes[30][25]! - 5,
  "default removes point-sized peak",
);
assert(fields[3].nodes[30][30]! > 15, "default retains broad depression");
const constant = grid(() => 13.7);
assert.deepEqual(smoothSurface(constant, 100).nodes, constant.nodes);
const missing = grid((x, y) =>
    x === 60 || (x === 40 && y === 40) ? null : x < 60 ? 5 : 20,
  ),
  missingOut = smoothSurface(missing, 100);
assert.deepEqual(
  missingOut.nodes,
  missing.nodes,
  "no exchange across unknown strips; isolated unknowns remain null",
);
const island = grid((x) => (x <= 60 ? 5 : 20));
island.geometry = {
  type: "Polygon",
  coordinates: [
    (island.geometry as WaterGeometry & { type: "Polygon" }).coordinates[0],
    [
      [60.4, -0.5],
      [61.6, -0.5],
      [61.6, 120.5],
      [60.4, 120.5],
      [60.4, -0.5],
    ],
  ],
};
assert.deepEqual(
  smoothSurface(island, 100).nodes,
  island.nodes,
  "thin land between known nodes blocks flux",
);
assert.deepEqual(
  smoothSurface({ ...g, radius: 20 }, 30).nodes,
  fields[3].nodes,
  "scale independent of interpolation radius",
);
assert(smoothingSigma(30, 2) > 2 && smoothingSigma(30, 2) < 4);
// Two nearby narrow deep observations become one wider depression at a high
// setting, while a low setting retains both local maxima on the section.
const twin = grid(
  (x, y) =>
    5 +
    10 * Math.exp(-((x - 54) ** 2 + (y - 60) ** 2) / 8) +
    10 * Math.exp(-((x - 66) ** 2 + (y - 60) ** 2) / 8),
);
const peaks = (g: Grid) =>
  g.nodes[30].filter(
    (v, x, a) => x > 0 && x < a.length - 1 && v! > a[x - 1]! && v! > a[x + 1]!,
  ).length;
assert.equal(peaks(twin), 2);
assert.equal(peaks(smoothSurface(twin, 60)), 1);
// Small percentage changes remain continuous, including a diffusion step boundary.
const a = smoothSurface(g, 29.99),
  b = smoothSurface(g, 30.01);
assert(
  Math.max(...numeric(a).map((z, i) => Math.abs(z - numeric(b)[i]))) < 0.01,
);
const smooth = fields[3],
  ext = extendShoreField(smooth),
  lines = contours(smooth, 2, ext),
  bands = filledContours(smooth, 2, ext);
const key = (p: Coord) => p.map((n) => n.toFixed(7)).join(",");
for (const band of bands) {
  if (!band.level) continue;
  const edges = new Set(
    band.rings.flatMap((r) =>
      r
        .slice(1)
        .flatMap((p, i) => [
          key(r[i]) + "|" + key(p),
          key(p) + "|" + key(r[i]),
        ]),
    ),
  );
  for (const line of lines.filter((l) => l.level === band.level)) {
    if (key(line.a) !== key(line.b))
      assert(
        edges.has(key(line.a) + "|" + key(line.b)),
        "smoothed lines exactly match band boundaries",
      );
  }
}
console.log(
  "PASS: exact zero, immutable source, preserved mean, no overshoot, progressive scale, broad feature retained, twin pits merge, null/island barriers, matching contours/bands.",
);
