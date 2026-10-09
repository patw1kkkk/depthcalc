import type { ScalarTriangle } from "./shore-field";
import type { analyze, Coord } from "./survey";

export type ContourSegment = { level: number; a: Coord; b: Coord };
export type FilledLevel = { level: number; rings: Coord[][] };
type Grid = ReturnType<typeof analyze>;
type Quad = { p: Coord[]; v: number[] };

function* quads(g: Grid): Generator<Quad> {
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++) {
      const v = [
        g.nodes[y][x],
        g.nodes[y][x + 1],
        g.nodes[y + 1][x + 1],
        g.nodes[y + 1][x],
      ];
      // Never bridge missing support or land/islands with an invented depth.
      if (v.some((n) => n === null || !Number.isFinite(n))) continue;
      yield {
        v: v as number[],
        p: [
          [g.minX + x * g.step, g.minY + y * g.step],
          [g.minX + (x + 1) * g.step, g.minY + y * g.step],
          [g.minX + (x + 1) * g.step, g.minY + (y + 1) * g.step],
          [g.minX + x * g.step, g.minY + (y + 1) * g.step],
        ],
      };
    }
}
function crossings({ p, v }: Quad, level: number) {
  const hits = new Map<number, Coord>();
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    if (v[i] < level === v[j] < level) continue;
    // Canonical direction gives neighboring cells identical edge coordinates.
    const [a, b] =
      p[i][0] < p[j][0] || (p[i][0] === p[j][0] && p[i][1] < p[j][1])
        ? [i, j]
        : [j, i];
    const t = (level - v[a]) / (v[b] - v[a]);
    hits.set(i, [
      p[a][0] + t * (p[b][0] - p[a][0]),
      p[a][1] + t * (p[b][1] - p[a][1]),
    ]);
  }
  return hits;
}
export function contourMaximum(g: Grid & { surfaceMaximum?: number }) {
  return (
    g.surfaceMaximum ??
    g.cells.reduce((max, c) => Math.max(max, c.value ?? 0), 0)
  );
}
export function contourSegments(
  g: Grid,
  interval: number,
  extension: ScalarTriangle[] = [],
): ContourSegment[] {
  if (!Number.isFinite(interval) || interval <= 0)
    throw new Error("Invalid contour interval");
  const result: ContourSegment[] = [],
    max = contourMaximum(g);
  for (const quad of quads(g))
    for (let level = interval; level <= max; level += interval) {
      const hits = [...crossings(quad, level).values()];
      for (let i = 0; i + 1 < hits.length; i += 2)
        result.push({ level, a: hits[i], b: hits[i + 1] });
    }
  for (const triangle of extension)
    for (let level = interval; level <= max; level += interval) {
      const hits = triangleCrossings(triangle, level);
      if (hits.length === 2) result.push({ level, a: hits[0], b: hits[1] });
    }
  return result;
}
const key = (p: Coord) => p.map((n) => n.toFixed(8)).join(",");

/** Union neighboring patches by removing shared edges before tracing rings.
 * A single compound path per level avoids internal cell seams, retains holes,
 * and makes the exported PDF independent of a raster resolution. */
class RingBuilder {
  edges = new Map<string, { a: Coord; b: Coord; start: string; end: string }>();
  add(poly: Coord[]) {
    if (poly.length < 3) return;
    const origin = poly[0];
    const area = poly.reduce((sum, a, i) => {
      const b = poly[(i + 1) % poly.length];
      return (
        sum +
        (a[0] - origin[0]) * (b[1] - origin[1]) -
        (b[0] - origin[0]) * (a[1] - origin[1])
      );
    }, 0);
    if (Math.abs(area) < 1e-12) return;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i],
        b = poly[(i + 1) % poly.length],
        start = key(a),
        end = key(b);
      if (start === end) continue;
      if (!this.edges.delete(`${end}|${start}`))
        this.edges.set(`${start}|${end}`, { a, b, start, end });
    }
  }
  finish(): Coord[][] {
    const outgoing = new Map<string, string[]>();
    for (const [id, e] of this.edges) {
      const list = outgoing.get(e.start) ?? [];
      list.push(id);
      outgoing.set(e.start, list);
    }
    const rings: Coord[][] = [];
    for (const [id, first] of this.edges) {
      const ring: Coord[] = [first.a];
      let current = id;
      while (true) {
        const edge = this.edges.get(current);
        if (!edge) break;
        this.edges.delete(current);
        ring.push(edge.b);
        if (edge.end === first.start) break;
        const candidates = (outgoing.get(edge.end) ?? []).filter((k) =>
          this.edges.has(k),
        );
        if (!candidates.length) throw new Error("Unclosed filled contour");
        // At an exact-level vertex, keep the interior on the same side.
        const angle = Math.atan2(edge.b[1] - edge.a[1], edge.b[0] - edge.a[0]);
        candidates.sort((a, b) => {
          const turn = (id: string) => {
            const e = this.edges.get(id)!;
            return (
              (Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) -
                angle +
                Math.PI * 2) %
              (Math.PI * 2)
            );
          };
          return turn(a) - turn(b);
        });
        current = candidates[0];
      }
      if (ring.length >= 4) rings.push(ring);
    }
    return rings;
  }
}
/** Nested superlevel polygons: painting levels in ascending order yields bands
 * [0, interval), [interval, 2*interval), … with exact marching-squares borders.
 * Ambiguous saddle cells use the SAME edge pairing as contourSegments. */
export function filledContours(
  g: Grid,
  interval: number,
  extension: ScalarTriangle[] = [],
): FilledLevel[] {
  if (!Number.isFinite(interval) || interval <= 0)
    throw new Error("Invalid contour interval");
  const levels = Array.from(
    { length: Math.floor(contourMaximum(g) / interval) + 1 },
    (_, i) => ({ level: i * interval, builder: new RingBuilder() }),
  );
  for (const quad of quads(g)) {
    levels[0].builder.add(quad.p);
    for (const { level, builder } of levels.slice(1)) {
      const mask = quad.v.reduce((n, v, i) => n | (v >= level ? 1 << i : 0), 0);
      if (mask === 0) continue;
      if (mask === 15) {
        builder.add(quad.p);
        continue;
      }
      const hits = crossings(quad, level),
        p = quad.p;
      if (mask === 10) {
        // High corners 1 and 3, isolated by hit pairs 0–1 and 2–3.
        builder.add([hits.get(0)!, p[1], hits.get(1)!]);
        builder.add([hits.get(2)!, p[3], hits.get(3)!]);
      } else {
        const polygon: Coord[] = [];
        for (let i = 0; i < 4; i++) {
          if (mask & (1 << i)) polygon.push(p[i]);
          const hit = hits.get(i);
          if (hit) polygon.push(hit);
        }
        builder.add(polygon);
      }
    }
  }
  // Keep the original domain separate: shoreline clipping may split a shared
  // grid edge, but cannot alter any existing interior polygon or contour.
  return levels.map(({ level, builder }) => {
    const extra = new RingBuilder();
    for (const t of extension) extra.add(triangleAbove(t, level));
    return { level, rings: [...builder.finish(), ...extra.finish()] };
  });
}

function triangleHit(
  a: Coord,
  b: Coord,
  av: number,
  bv: number,
  level: number,
): Coord {
  if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]))
    return triangleHit(b, a, bv, av, level);
  const t = (level - av) / (bv - av);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
}
function triangleCrossings({ p, v }: ScalarTriangle, level: number) {
  const hits: Coord[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (v[i] < level !== v[j] < level)
      hits.push(triangleHit(p[i], p[j], v[i], v[j], level));
  }
  return hits;
}
function triangleAbove({ p, v }: ScalarTriangle, level: number) {
  const ring: Coord[] = [];
  for (let i = 0; i < 3; i++) {
    const j = (i + 1) % 3;
    if (v[i] >= level) ring.push(p[i]);
    if (v[i] < level !== v[j] < level)
      ring.push(triangleHit(p[i], p[j], v[i], v[j], level));
  }
  return ring;
}
