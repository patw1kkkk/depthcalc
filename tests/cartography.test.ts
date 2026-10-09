import assert from "node:assert/strict";
import {
  analyze,
  projection,
  type Coord,
  type Measurement,
} from "../packages/core/survey";
import {
  bandCSS,
  joinContours,
  mapLabels,
  deepSpots,
} from "../packages/core/cartography";
import { nearestDistance } from "../packages/core/recording";
const boundary: Coord[] = [
  [24, 60],
  [24.004, 60],
  [24.004, 60.004],
  [24, 60.004],
];
const proj = projection(boundary),
  point = (id: string, x: number, y: number, depth = 10): Measurement => {
    const [longitude, latitude] = proj.from([x, y]);
    return {
      id,
      longitude,
      latitude,
      depth,
      accuracy: 2,
      lakeId: "l",
      sessionId: "s",
      timestamp: "2026-09-20T10:00:00Z",
    };
  };
const points = [
  point("a", -10, -10),
  point("b", 10, -10),
  point("c", 0, 10),
  point("far", 100, 0, 99),
];
for (const radius of [20, 30, 40, 50, 100]) {
  const g = analyze(boundary, points, true, radius);
  assert.equal(g.radius, radius);
  assert(g.cells.some((c) => c.value !== null));
  for (const cell of g.cells.filter((c) => c.value !== null)) {
    const near = points.filter((p) => {
      const a = proj.to([p.longitude, p.latitude]);
      return Math.hypot(a[0] - cell.x, a[1] - cell.y) <= radius + 0.001;
    });
    assert(near.length >= 3);
    if (radius === 40 && Math.hypot(cell.x, cell.y) < 5)
      assert(Math.abs(cell.value! - 10) < 1e-8);
  }
}
assert.equal(analyze(boundary, points, true).radius, 100);
assert(
  analyze(boundary, points.slice(0, 2), true).cells.every(
    (c) => c.value === null,
  ),
);
assert(
  analyze(boundary, [points[0], points[0], points[0]], true).cells.every(
    (c) => c.value === null,
  ),
);
assert.equal(bandCSS(0.2, 20, 2), bandCSS(1.9, 20, 2));
assert.notEqual(bandCSS(1.9, 20, 2), bandCSS(2, 20, 2));
const line = Array.from({ length: 100 }, (_, i) => ({
  level: 10,
  a: [20 + i * 10, 100] as Coord,
  b: [30 + i * 10, 100] as Coord,
}));
const curves = joinContours(line.reverse());
assert.equal(curves.length, 1);
assert.equal(curves[0].points.length, 101);
const labels = mapLabels(curves, (p) => p, [], 1100, 300);
assert(labels.length >= 2 && labels.length <= 4);
for (let i = 0; i < labels.length; i++)
  for (let j = i + 1; j < labels.length; j++)
    assert(
      Math.hypot(
        labels[i].position[0] - labels[j].position[0],
        labels[i].position[1] - labels[j].position[1],
      ) > 40,
    );
assert.equal(
  mapLabels(
    [
      {
        level: 2,
        points: [
          [1, 1],
          [3, 1],
        ],
      },
    ],
    (p) => p,
    [],
    100,
    100,
  ).length,
  0,
);
assert(deepSpots(points, proj.to, 40).some((p) => p.depth === 99));
const origin = proj.from([0, 0]);
assert.equal(nearestDistance(origin, []), null);
assert(nearestDistance(origin, [points[3], points[2]])! < 11);
console.log(
  "PASS: five radii, default 100 m, strict local support, duplicate exclusion, discrete bands, connected contour labeling/spacing, deep soundings, nearest point.",
);
