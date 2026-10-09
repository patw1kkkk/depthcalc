import assert from "node:assert/strict";
import { analyze, contours, type Coord } from "../packages/core/survey";
import {
  extendShoreField,
  type ScalarTriangle,
} from "../packages/core/shore-field";
import { filledContours } from "../packages/core/filled-contours";
import { inside, type WaterGeometry } from "../packages/core/geometry";
type Grid = ReturnType<typeof analyze>;
const geometry: WaterGeometry = {
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
};
function make(
  field: (x: number, y: number) => number | null,
  geo = geometry,
  radius = 100,
): Grid {
  const nodes = Array.from({ length: 11 }, (_, y) =>
    Array.from({ length: 11 }, (_, x) => field(x * 2, y * 2)),
  );
  return {
    geometry: geo,
    nodes,
    cols: 10,
    rows: 10,
    minX: 0,
    minY: 0,
    width: 20,
    height: 20,
    step: 2,
    radius,
    cells: nodes.flat().map((value) => ({ x: 0, y: 0, value, count: 3 })),
  } as Grid;
}
const g = make((x, y) => (x >= 6 && x <= 14 && y >= 6 && y <= 14 ? 12 : null)),
  before = JSON.stringify(g),
  oldLines = contours(g, 2),
  oldFills = filledContours(g, 2);
const ext = extendShoreField(g);
assert(ext.length > 0);
assert.equal(
  JSON.stringify(g),
  before,
  "original scalar field must not change",
);
const vertices = ext.flatMap((t) => t.p.map((p, i) => ({ p, z: t.v[i] })));
const at = (x: number, y: number) =>
  vertices.find(
    (v) => Math.abs(v.p[0] - x) < 1e-7 && Math.abs(v.p[1] - y) < 1e-7,
  )?.z;
assert.equal(at(0, 10), 0);
assert.equal(at(6, 10), 12);
assert(Math.abs(at(2, 10)! - 4) < 1e-7);
assert(Math.abs(at(4, 10)! - 8) < 1e-7);
assert(vertices.every((v) => v.z >= 0 && v.z <= 12));
const newLines = contours(g, 2, ext);
assert.deepEqual(newLines.slice(0, oldLines.length), oldLines);
for (const level of [2, 4, 6, 8, 10])
  assert(
    newLines.some((l) => l.level === level),
    "natural added contour bands",
  );
const newFills = filledContours(g, 2, ext);
newFills.forEach((b, i) =>
  assert.deepEqual(
    b.rings.slice(0, oldFills[i].rings.length),
    oldFills[i].rings,
  ),
);
const key = (p: Coord) => p.map((n) => n.toFixed(7)).join(",");
for (const band of newFills) {
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
  for (const line of newLines.filter((l) => l.level === band.level)) {
    if (key(line.a) === key(line.b)) continue;
    assert(
      edges.has(key(line.a) + "|" + key(line.b)),
      "added lines must exactly bound their fills",
    );
  }
}
assert.equal(
  extendShoreField(make(() => null)).length,
  0,
  "shore zeros alone cannot generate a map",
);
const near = extendShoreField({ ...g, radius: 3 });
assert(
  !near.some((t) =>
    t.p.some((p) => p[0] === 0 || p[0] === 20 || p[1] === 0 || p[1] === 20),
  ),
  "no unlimited extrapolation",
);
const hole = make((x, y) =>
  x >= 4 && x <= 16 && y >= 4 && y <= 16 && !(x === 10 && y === 10) ? 12 : null,
);
assert(
  !extendShoreField(hole).some((t) => {
    const c = t.p.reduce(
      (s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3] as Coord,
      [0, 0] as Coord,
    );
    return c[0] > 8 && c[0] < 12 && c[1] > 8 && c[1] < 12;
  }),
  "interior data holes stay unknown",
);
const island: WaterGeometry = {
  type: "Polygon",
  coordinates: [
    geometry.coordinates[0],
    [
      [8, 8],
      [12, 8],
      [12, 12],
      [8, 12],
      [8, 8],
    ],
  ],
};
const gi = make(
  (x, y) =>
    x >= 2 &&
    x <= 18 &&
    y >= 2 &&
    y <= 18 &&
    (x < 6 || x > 14 || y < 6 || y > 14)
      ? 10
      : null,
  island,
);
const ei = extendShoreField(gi);
assert(ei.length > 0);
for (const t of ei) {
  const c = t.p.reduce((s, p) => [s[0] + p[0] / 3, s[1] + p[1] / 3] as Coord, [
    0, 0,
  ] as Coord);
  assert(inside(c, island), "never fill an island");
}
assert(
  ei.some((t) =>
    t.p.some((p, i) => p[0] === 8 && p[1] >= 8 && p[1] <= 12 && t.v[i] === 0),
  ),
  "island shoreline is zero",
);
filledContours(gi, 2, ei);
console.log(
  `PASS: ${ext.length} supported shore triangles, linear 12→8→4→0 taper, unchanged interior, matching bands/lines, unknown holes, radius limits, islands.`,
);
