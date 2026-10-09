import { DEFAULT_SETTINGS, type Settings } from "./settings";
import {
  exteriorPoints,
  mapGeometry,
  prepareWaterTest,
  bounds,
  type Boundary,
  type Coord,
} from "./geometry";
export { inside } from "./geometry";
export type { Coord, Boundary, WaterGeometry } from "./geometry";
export type Lake = {
  id: string;
  name: string;
  boundary: Boundary;
  createdAt: string;
  source?: {
    provider: "openstreetmap";
    osmType: "way" | "relation";
    osmId: number;
    retrievedAt: string;
  };
};
export type Session = {
  id: string;
  lakeId: string;
  startedAt: string;
  endedAt: string | null;
};
export type Measurement = {
  id: string;
  lakeId: string;
  sessionId: string;
  longitude: number;
  latitude: number;
  depth: number;
  timestamp: string;
  accuracy: number;
};
export function validBoundary(p: Coord[]) {
  if (
    p.length < 3 ||
    p.length > 2000 ||
    p.some(
      (c) =>
        c.length !== 2 ||
        !c.every(Number.isFinite) ||
        Math.abs(c[0]) > 180 ||
        Math.abs(c[1]) > 85,
    )
  )
    return false;
  const cross = (a: Coord, b: Coord, c: Coord) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < p.length; i++)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      const a = p[i],
        b = p[(i + 1) % p.length],
        c = p[j],
        d = p[(j + 1) % p.length];
      if (
        cross(a, b, c) * cross(a, b, d) < 0 &&
        cross(c, d, a) * cross(c, d, b) < 0
      )
        return false;
    }
  const area = Math.abs(
    p.reduce((s, a, i) => {
      const b = p[(i + 1) % p.length];
      return s + a[0] * b[1] - b[0] * a[1];
    }, 0),
  );
  return area > 1e-10;
}
export function projection(input: Boundary) {
  const boundary = exteriorPoints(input);
  const lat = boundary.reduce((s, p) => s + p[1], 0) / boundary.length;
  const lon = boundary.reduce((s, p) => s + p[0], 0) / boundary.length;
  const k = 111320 * Math.cos((lat * Math.PI) / 180);
  return {
    to: (p: Coord): Coord => [(p[0] - lon) * k, (p[1] - lat) * 111320],
    from: (p: Coord): Coord => [p[0] / k + lon, p[1] / 111320 + lat],
  };
}
export type Cell = {
  x: number;
  y: number;
  count: number;
  value: number | null;
};
export function analyze(
  boundary: Boundary,
  points: Measurement[],
  depth = false,
  radius = 100,
  settings: Settings = DEFAULT_SETTINGS,
) {
  if (![20, 30, 40, 50, 100].includes(radius))
    throw new Error("Invalid interpolation radius");
  const proj = projection(boundary),
    geometry = mapGeometry(boundary, proj.to),
    poly = exteriorPoints(geometry);
  const water = prepareWaterTest(geometry);
  const good = points
    .filter(
      (p) =>
        Number.isFinite(p.depth) &&
        p.depth >= 0 &&
        Number.isFinite(p.accuracy) &&
        p.accuracy >= 0 &&
        p.accuracy <= settings.gpsAccuracy &&
        water(proj.to([p.longitude, p.latitude])),
    )
    .map((p) => ({ p: proj.to([p.longitude, p.latitude]), d: p.depth }));
  const fullBox = bounds(poly),
    active = depth && good.length ? bounds(good.map((p) => p.p)) : fullBox,
    padding = depth && good.length ? radius * 2 + 4 : 0;
  const minX = Math.max(fullBox.minX, active.minX - padding),
    minY = Math.max(fullBox.minY, active.minY - padding),
    width = Math.min(fullBox.maxX, active.maxX + padding) - minX,
    height = Math.min(fullBox.maxY, active.maxY + padding) - minY;
  const step = Math.max(
    depth ? 2 : settings.coverageGrid,
    Math.ceil(Math.sqrt((width * height) / (depth ? 160000 : 18000))),
    Math.ceil(width / 500),
    Math.ceil(height / 500),
  );
  const cols = Math.ceil(width / step),
    rows = Math.ceil(height / step);
  const bins = new Map<string, typeof good>();
  for (const p of good) {
    const key = `${Math.floor(p.p[0] / 100)},${Math.floor(p.p[1] / 100)}`;
    const a = bins.get(key) || [];
    a.push(p);
    bins.set(key, a);
  }
  const at = (x: number, y: number) => {
    let count = 0,
      nearby = 0,
      weighted = 0,
      weights = 0;
    const locations = new Set<string>();
    let exact: number | null = null;
    const bx = Math.floor(x / 100),
      by = Math.floor(y / 100);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const p of bins.get(`${bx + dx},${by + dy}`) || []) {
          const d2 = (p.p[0] - x) ** 2 + (p.p[1] - y) ** 2;
          if (d2 <= settings.coverageRadius ** 2) count++;
          if (depth && d2 <= radius * radius) {
            const location = p.p.join(",");
            if (locations.has(location)) continue;
            locations.add(location);
            nearby++;
            if (d2 < 0.01) exact = p.d;
            const w = 1 / Math.max(0.01, d2);
            weighted += p.d * w;
            weights += w;
          }
        }
    return {
      count,
      value:
        depth && nearby >= 3
          ? (exact ?? (weights ? weighted / weights : null))
          : null,
    };
  };
  const cells: Cell[] = [];
  let covered = 0,
    well = 0;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const px = minX + (x + 0.5) * step,
        py = minY + (y + 0.5) * step;
      if (!water([px, py])) continue;
      const v = at(px, py);
      cells.push({ x: px, y: py, ...v });
      if (v.count) covered++;
      if (v.count >= settings.goodCount) well++;
    }
  const nodes: (number | null)[][] = [];
  if (depth)
    for (let y = 0; y <= rows; y++) {
      const row: (number | null)[] = [];
      for (let x = 0; x <= cols; x++) {
        const p: Coord = [minX + x * step, minY + y * step];
        row.push(water(p) ? at(...p).value : null);
      }
      nodes.push(row);
    }
  return {
    radius,
    settings,
    proj,
    poly,
    geometry,
    minX,
    minY,
    width,
    height,
    step,
    cols,
    rows,
    cells,
    nodes,
    coverage: cells.length ? (100 * covered) / cells.length : 0,
    well: cells.length ? (100 * well) / cells.length : 0,
    area: cells.length * step * step,
    usable: good.length,
  };
}
export { contourSegments as contours } from "./filled-contours";
export function world(p: Coord, z: number): Coord {
  const size = 256 * 2 ** z;
  return [
    ((p[0] + 180) / 360) * size,
    ((1 - Math.asinh(Math.tan((p[1] * Math.PI) / 180)) / Math.PI) / 2) * size,
  ];
}
export function unworld(p: Coord, z: number): Coord {
  const size = 256 * 2 ** z;
  return [
    (p[0] / size) * 360 - 180,
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * p[1]) / size))) * 180) / Math.PI,
  ];
}
