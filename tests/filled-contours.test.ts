import assert from "node:assert/strict";
import { analyze, contours, type Coord } from "../packages/core/survey";
import { filledContours } from "../packages/core/filled-contours";
type Grid = ReturnType<typeof analyze>;
const grid = (nodes: (number | null)[][]): Grid =>
  ({
    nodes,
    cols: nodes[0].length - 1,
    rows: nodes.length - 1,
    minX: 0,
    minY: 0,
    step: 1,
    cells: nodes.flat().map((value) => ({ value, x: 0, y: 0, count: 3 })),
  }) as Grid;
const key = (p: Coord) => p.map((n) => n.toFixed(7)).join(",");
const area = (rings: Coord[][]) =>
  Math.abs(
    rings.reduce(
      (sum, r) =>
        sum +
        r.slice(1).reduce((s, b, i) => s + r[i][0] * b[1] - b[0] * r[i][1], 0) /
          2,
      0,
    ),
  );
function verify(g: Grid, interval: number) {
  const bands = filledContours(g, interval),
    lines = contours(g, interval);
  for (const band of bands) {
    for (const ring of band.rings)
      assert.equal(key(ring[0]), key(ring.at(-1)!), "closed polygon");
    if (!band.level) continue;
    const edges = new Set(
      band.rings.flatMap((r) =>
        r
          .slice(1)
          .flatMap((b, i) => [
            `${key(r[i])}|${key(b)}`,
            `${key(b)}|${key(r[i])}`,
          ]),
      ),
    );
    for (const line of lines.filter((l) => l.level === band.level)) {
      if (key(line.a) === key(line.b)) continue;
      const exactNode = (p: Coord) =>
        Number.isInteger(p[0]) &&
        Number.isInteger(p[1]) &&
        g.nodes[p[1]]?.[p[0]] === band.level;
      if (exactNode(line.a) && exactNode(line.b)) continue; // A zero-area plateau/ridge may have no filled interior.
      assert(
        edges.has(`${key(line.a)}|${key(line.b)}`),
        `Contour ${band.level} must be an exact fill edge`,
      );
    }
  }
  return bands;
}
const slope = verify(
  grid([
    [0, 8],
    [0, 8],
  ]),
  2,
);
assert.deepEqual(
  slope.map((b) => [b.level, area(b.rings)]),
  [
    [0, 1],
    [2, 0.75],
    [4, 0.5],
    [6, 0.25],
    [8, 0],
  ],
);
assert(
  slope[2].rings[0].some((p) => p[0] === 0.5),
  "actual interpolated boundary, not whole-cell color",
);
// Every marching-squares configuration, including both ambiguous saddle cases.
for (let mask = 0; mask < 16; mask++) {
  const v = Array.from({ length: 4 }, (_, i) => (mask & (1 << i) ? 4 : 0));
  verify(
    grid([
      [v[0], v[1]],
      [v[3], v[2]],
    ]),
    2,
  );
}
assert.equal(
  filledContours(
    grid([
      [0, 4],
      [4, 0],
    ]),
    2,
  )[1].rings.length,
  2,
);
assert.equal(
  filledContours(
    grid([
      [4, 0],
      [0, 4],
    ]),
    2,
  )[1].rings.length,
  1,
);
const flat = filledContours(
  grid([
    [3, 3, 3],
    [3, 3, 3],
    [3, 3, 3],
  ]),
  2,
);
assert.equal(flat[0].rings.length, 1);
assert.equal(area(flat[0].rings), 4);
// Missing support remains a hole; outer and hole rings have opposite orientation.
const hole = grid(
  Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => (x === 2 && y === 2 ? null : 3)),
  ),
);
const holes = verify(hole, 2);
assert.equal(holes[0].rings.length, 2);
assert.equal(area(holes[0].rings), 12);
assert.equal(
  filledContours(
    grid([
      [null, null],
      [null, null],
    ]),
    2,
  )[0].rings.length,
  0,
);
// Exact-level vertices, plateaus, holes, and mixed non-integer depths at all slider intervals.
let seed = 17;
const random = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
for (let n = 0; n < 16; n++) {
  const g = grid(
    Array.from({ length: 12 }, () =>
      Array.from({ length: 12 }, () =>
        random() < 0.05
          ? null
          : n % 2
            ? Math.floor(random() * 12)
            : random() * 12,
      ),
    ),
  );
  for (let interval = 1; interval <= 6; interval++) verify(g, interval);
}
console.log(
  "PASS: exact line/fill boundaries, fractional bands, all saddle cases, joined polygons, missing-data holes, plateaus and intervals 1–6 m.",
);
