import { contours, type Coord, type Measurement } from "./survey";
export const coverageColors: Record<string, string> = {
  Hyvä: "#2b9c7b",
  Kohtalainen: "#b4b83b",
  Vähän: "#e9a34a",
  "Ei dataa": "#df7968",
};
export function bandColor(value: number, max: number, interval: number) {
  const band = Math.floor(Math.max(0, value) / interval),
    bands = Math.max(1, Math.floor(max / interval));
  const t = Math.min(1, band / bands);
  const stops = [
    [65, 139, 176],
    [113, 178, 205],
    [174, 212, 228],
    [225, 239, 245],
    [250, 252, 253],
  ];
  const v = t * (stops.length - 1),
    i = Math.min(stops.length - 2, Math.floor(v)),
    f = v - i;
  return stops[i].map((n, c) => Math.round(n + (stops[i + 1][c] - n) * f)) as [
    number,
    number,
    number,
  ];
}
export const bandCSS = (value: number, max: number, interval: number) =>
  `rgb(${bandColor(value, max, interval).join(",")})`;
export type Curve = { level: number; points: Coord[] };
/** Join marching-squares segments into actual connected lines before labeling. */
export function joinContours(lines: ReturnType<typeof contours>): Curve[] {
  const byLevel = new Map<number, typeof lines>();
  for (const line of lines) {
    const group = byLevel.get(line.level) ?? [];
    group.push(line);
    byLevel.set(line.level, group);
  }
  const result: Curve[] = [];
  const key = (p: Coord) => p.map((n) => n.toFixed(4)).join(",");
  for (const [level, segments] of byLevel) {
    const adjacency = new Map<string, number[]>();
    segments.forEach((s, i) => {
      for (const p of [s.a, s.b]) {
        const k = key(p),
          a = adjacency.get(k) ?? [];
        a.push(i);
        adjacency.set(k, a);
      }
    });
    const used = new Set<number>();
    const walk = (start: Coord, index: number) => {
      const points = [start];
      let current = start,
        i = index;
      while (!used.has(i)) {
        used.add(i);
        const segment = segments[i];
        current = key(segment.a) === key(current) ? segment.b : segment.a;
        points.push(current);
        const next = adjacency.get(key(current))?.find((n) => !used.has(n));
        if (next === undefined) break;
        i = next;
      }
      if (points.length > 1) result.push({ level, points });
    };
    for (const [k, edges] of adjacency)
      if (edges.length === 1 && !used.has(edges[0])) {
        const segment = segments[edges[0]];
        walk(key(segment.a) === k ? segment.a : segment.b, edges[0]);
      }
    segments.forEach((s, i) => {
      if (!used.has(i)) walk(s.a, i);
    });
  }
  return result;
}
export type MapLabel = {
  text: string;
  position: Coord;
  angle: number;
  level?: number;
  spot?: boolean;
};
/** Coordinates are display pixels, so collision spacing follows zoom and print scale. */
export function mapLabels(
  curves: Curve[],
  project: (p: Coord) => Coord,
  spots: { position: Coord; depth: number }[],
  width: number,
  height: number,
  blocked: { x: number; y: number; w: number; h: number }[] = [],
) {
  const labels: MapLabel[] = [];
  const occupied: { x: number; y: number; w: number; h: number }[] = [
    ...blocked,
  ];
  const add = (label: MapLabel) => {
    const [x, y] = label.position,
      w = label.text.length * 7 + 20,
      h = Math.abs(label.angle) > 10 ? 42 : 26;
    if (x < w / 2 + 8 || y < 20 || x > width - w / 2 - 8 || y > height - 20)
      return false;
    if (
      occupied.some(
        (b) =>
          Math.abs(b.x - x) < (b.w + w) / 2 &&
          Math.abs(b.y - y) < (b.h + h) / 2,
      )
    )
      return false;
    occupied.push({ x, y, w, h });
    labels.push(label);
    return true;
  };
  for (const spot of spots) {
    const position = project(spot.position);
    if (
      labels.some(
        (l) =>
          Math.hypot(l.position[0] - position[0], l.position[1] - position[1]) <
          90,
      )
    )
      continue;
    if (
      add({ text: spot.depth.toFixed(1), position, angle: 0, spot: true }) &&
      labels.length >= 8
    )
      break;
  }
  for (const curve of [...curves].sort(
    (a, b) => (b.level % 10 === 0 ? 1 : 0) - (a.level % 10 === 0 ? 1 : 0),
  )) {
    const pts = curve.points.map(project),
      lengths = [0];
    for (let i = 1; i < pts.length; i++)
      lengths.push(
        lengths[i - 1] +
          Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]),
      );
    const total = lengths.at(-1)!;
    if (total < 65) continue;
    const sample = (distance: number): Coord => {
      let i = 1;
      while (i < lengths.length - 1 && lengths[i] < distance) i++;
      const t =
        (distance - lengths[i - 1]) /
        Math.max(0.001, lengths[i] - lengths[i - 1]);
      return [
        pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]),
        pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]),
      ];
    };
    const count = Math.min(4, Math.max(1, Math.floor(total / 180)));
    for (let i = 0; i < count; i++) {
      const d = (total * (i + 0.5)) / count;
      for (const offset of [0, 24, -24, 48, -48]) {
        const at = Math.max(15, Math.min(total - 15, d + offset)),
          position = sample(at),
          a = sample(at - 10),
          b = sample(at + 10);
        let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        // Keep collision rectangles conservative for sloped text.
        if (Math.abs(angle) > 55) angle = 0;
        if (
          add({
            text: String(curve.level),
            position,
            angle,
            level: curve.level,
          })
        )
          break;
      }
    }
  }
  return labels;
}
/** Separate measured local maxima, not invented interpolated soundings. */
export function deepSpots(
  points: Measurement[],
  project: (p: Coord) => Coord,
  radius: number,
  gpsAccuracy = 35,
) {
  const valid = points
    .filter((p) => p.accuracy <= gpsAccuracy)
    .map((p) => ({
      position: project([p.longitude, p.latitude]),
      depth: p.depth,
    }))
    .sort((a, b) => b.depth - a.depth);
  const threshold = valid.length
    ? valid[Math.floor(valid.length / 2)].depth
    : 0;
  return valid.filter(
    (p) =>
      p.depth >= threshold &&
      !valid.some(
        (q) =>
          q.depth > p.depth &&
          Math.hypot(
            q.position[0] - p.position[0],
            q.position[1] - p.position[1],
          ) <= radius,
      ),
  );
}
