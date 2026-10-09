/** Rebuild synthetic soundings; the bundled OSM shoreline remains unchanged. */
import { readFileSync, writeFileSync } from "node:fs";
import {
  projection,
  analyze,
  type Measurement,
  type Coord,
} from "../packages/core/survey";
import {
  bounds,
  exteriorPoints,
  mapGeometry,
  prepareWaterTest,
  rings,
} from "../packages/core/geometry";
import { DEFAULT_SETTINGS } from "../packages/core/settings";
import { parseProject, type Project } from "../packages/core/files";
const path = "example-data/kayralampi.depthcalc.json";
const lake =
  JSON.parse(readFileSync(process.argv[2] ?? path, "utf8")).lake ??
  JSON.parse(readFileSync(process.argv[2]!, "utf8"));
const proj = projection(lake.boundary),
  shape = mapGeometry(lake.boundary, proj.to),
  water = prepareWaterTest(shape),
  box = bounds(exteriorPoints(shape));
const width = box.maxX - box.minX,
  height = box.maxY - box.minY;
function shoreDistance(p: Coord) {
  let best = Infinity;
  for (const ring of rings(shape))
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i],
        dx = b[0] - a[0],
        dy = b[1] - a[1];
      const t = Math.max(
        0,
        Math.min(
          1,
          ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1),
        ),
      );
      best = Math.min(
        best,
        Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy),
      );
    }
  return best;
}
const lakeId = "demo-kayralampi-v3",
  sessionId = "demo-kayralampi-survey";
// A continuous terrain function: two connected basins, a saddle and a broad shoal.
function depth(x: number, y: number) {
  const u = (x - box.minX) / width,
    v = (y - box.minY) / height;
  const g = (cx: number, cy: number, sx: number, sy: number) =>
    Math.exp(-(((u - cx) / sx) ** 2 + ((v - cy) / sy) ** 2));
  const terrain =
    4 +
    13 * g(0.39, 0.52, 0.25, 0.27) +
    9 * g(0.69, 0.48, 0.2, 0.23) -
    3 * g(0.54, 0.67, 0.16, 0.13);
  return (
    Math.round(
      Math.max(0.2, terrain * (1 - Math.exp(-shoreDistance([x, y]) / 65))) * 10,
    ) / 10
  );
}
// Seeded randomness makes the bundled demo reproducible.
let seed = 73921;
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
}
const candidates: {
  x: number;
  y: number;
  pass: number;
  score: number;
  time: number;
  depth: number;
  accuracy: number;
}[] = [];
let elapsed = 0;
let last: Coord | null = null;
// Uneven, gently wandering boat passes, alternately driven in opposite directions.
// Sample by travelled distance, not by a 2D lattice. Points are about 5–15 m apart.
for (
  let pass = 0, base = box.minY + 9;
  base < box.maxY;
  pass++, base += 25 + random() * 12
) {
  const phase = random() * Math.PI * 2,
    amplitude = 5 + random() * 9;
  const slope = (random() - 0.5) * 0.035;
  const direction = pass % 2 ? -1 : 1;
  let accumulated = 0,
    next = 5 + random() * 10;
  let previous: Coord | null = null;
  for (let t = 0; t <= width; t += 0.2) {
    const x = direction > 0 ? box.minX + t : box.maxX - t;
    const y =
      base +
      amplitude * Math.sin(t / 145 + phase) +
      3 * Math.sin(t / 47 + phase) +
      slope * (t - width / 2);
    const p: Coord = [x, y];
    if (previous) accumulated += Math.hypot(x - previous[0], y - previous[1]);
    previous = p;
    if (accumulated < next) continue;
    accumulated = 0;
    next = 5 + random() * 10;
    if (!water(p) || shoreDistance(p) < 4) continue;
    // Time includes travel through unmeasured stretches and turns between passes.
    elapsed += last ? Math.hypot(x - last[0], y - last[1]) / 1.4 : 0;
    last = p;
    const u = (x - box.minX) / width,
      v = (y - box.minY) / height;
    const score = Math.min(
      ((u - 0.78) / 0.27) ** 2 + ((v - 0.74) / 0.29) ** 2,
      ((u - 0.16) / 0.18) ** 2 + ((v - 0.35) / 0.24) ** 2,
    );
    candidates.push({
      x,
      y,
      pass,
      score,
      time: elapsed,
      depth: depth(x, y),
      accuracy: Math.round((1.8 + random() * 1.4) * 10) / 10,
    });
  }
}
function measurements(cut: number): Measurement[] {
  // Sparse zones have only occasional boat passes, still sampled at the same spacing.
  return candidates
    .filter((p) => p.score > cut || p.pass % 4 === 0)
    .map((p, i) => {
      const [longitude, latitude] = proj.from([p.x, p.y]);
      return {
        id: `demo-kayralampi-v3-${i}`,
        lakeId,
        sessionId,
        longitude,
        latitude,
        depth: p.depth,
        accuracy: p.accuracy,
        timestamp: new Date(
          Date.UTC(2026, 8, 19, 8) + Math.round(p.time * 1000),
        ).toISOString(),
      };
    });
}
let lo = 0,
  hi = 3,
  points: Measurement[] = [];
for (let i = 0; i < 10; i++) {
  const cut = (lo + hi) / 2;
  points = measurements(cut);
  const a = analyze(lake.boundary, points, false, 100, DEFAULT_SETTINGS);
  if (a.well > 80) lo = cut;
  else hi = cut;
}
const result: Project = {
  format: "depthcalc-project",
  version: 1,
  lake: {
    ...lake,
    id: lakeId,
    name: "Käyrälampi · DEMO (synthetic depths)",
    createdAt: "2026-09-19T08:00:00.000Z",
  },
  settings: { ...DEFAULT_SETTINGS },
  sessions: [
    {
      id: sessionId,
      lakeId,
      name: "Demo survey — synthetic soundings",
      startedAt: "2026-09-19T08:00:00.000Z",
      endedAt: points.at(-1)!.timestamp,
    },
  ],
  measurements: points,
};
parseProject(JSON.stringify(result));
writeFileSync(path, JSON.stringify(result));
const a = analyze(lake.boundary, points, false, 100, DEFAULT_SETTINGS);
console.log({
  points: points.length,
  areaHa: a.area / 10000,
  well: a.well,
  covered: a.coverage,
  maxDepth: Math.max(...points.map((p) => p.depth)),
});
