import assert from "node:assert/strict";
import {
  analyze,
  contours,
  inside,
  validBoundary,
  world,
  unworld,
  type Measurement,
  type Coord,
} from "../packages/core/survey";
const boundary: Coord[] = [
  [25, 61],
  [25.004, 61],
  [25.004, 61.002],
  [25, 61.002],
];
function point(
  id: string,
  x: number,
  y: number,
  depth = 7,
  accuracy = 3,
): Measurement {
  return {
    id,
    lakeId: "test-lake",
    sessionId: "test-session",
    longitude: x,
    latitude: y,
    depth,
    accuracy,
    timestamp: "2026-09-19T12:00:00Z",
  };
}
assert(validBoundary(boundary));
assert(
  !validBoundary([
    [0, 0],
    [1, 1],
    [0, 1],
    [1, 0],
  ]),
);
assert(
  !validBoundary([
    [0, 0],
    [1, 1],
    [2, 2],
  ]),
);
assert(inside([25.002, 61.001], boundary));
assert(!inside([26, 62], boundary));
const one = point("a", 25.001, 61.001);
const a = analyze(boundary, [one]);
const repeated = analyze(
  boundary,
  Array.from({ length: 500 }, (_, i) => ({ ...one, id: String(i) })),
);
assert.equal(
  a.coverage,
  repeated.coverage,
  "Repeated samples at one location must not inflate covered area",
);
assert(a.coverage > 0 && a.coverage < 20);
assert.equal(analyze(boundary, [{ ...one, accuracy: 36 }]).coverage, 0);
assert.equal(analyze(boundary, [point("out", 25.1, 61.1)]).coverage, 0);
const plane = analyze(
  boundary,
  [
    point("a", 25.001, 61.0005),
    point("b", 25.003, 61.0005),
    point("c", 25.002, 61.0015),
  ],
  true,
  100,
);
for (const c of plane.cells) {
  assert(inside([c.x, c.y], plane.poly));
  if (c.value !== null)
    assert(
      Math.abs(c.value - 7) < 1e-8,
      "Constant depth IDW should stay constant",
    );
}
assert(
  plane.cells.some((c) => c.value === null),
  "Unobserved areas must stay unknown",
);
const varied = analyze(
  boundary,
  [
    point("a", 25.001, 61.0005, 2),
    point("b", 25.003, 61.0005, 14),
    point("c", 25.002, 61.0015, 8),
  ],
  true,
  100,
);
const lines = contours(varied, 2);
assert(lines.length > 0);
assert(
  lines.every(
    (l) =>
      l.level % 2 === 0 &&
      l.a.every(Number.isFinite) &&
      l.b.every(Number.isFinite),
  ),
);
for (const p of boundary) {
  const q = unworld(world(p, 15), 15);
  assert(Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9);
}
assert.equal(one.depth, 7);
console.log(
  "PASS: boundary validation, clipping, coverage, GPS exclusion, constant-depth IDW, unknown areas, contours, projection round trip, source preservation",
);
