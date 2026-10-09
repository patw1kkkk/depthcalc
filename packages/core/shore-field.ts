import earcut, { flatten } from "earcut";
import polygonClipping from "polygon-clipping";
import { polygons, rings, prepareWaterTest, type Coord } from "./geometry";
import type { analyze } from "./survey";

export type ScalarTriangle = {
  p: [Coord, Coord, Coord];
  v: [number, number, number];
};
type Grid = ReturnType<typeof analyze>;
type Box = { minX: number; minY: number; maxX: number; maxY: number };
type Edge = Box & { a: Coord; b: Coord; av: number; bv: number };
const box = (a: Coord, b: Coord): Box => ({
  minX: Math.min(a[0], b[0]),
  maxX: Math.max(a[0], b[0]),
  minY: Math.min(a[1], b[1]),
  maxY: Math.max(a[1], b[1]),
});
const edge = (a: Coord, b: Coord, av = 0, bv = 0): Edge => ({
  ...box(a, b),
  a,
  b,
  av,
  bv,
});
function touchesBox(e: Edge, b: Box) {
  let lo = 0,
    hi = 1;
  for (const axis of [0, 1]) {
    const d = e.b[axis] - e.a[axis],
      min = axis ? b.minY : b.minX,
      max = axis ? b.maxY : b.maxX;
    if (Math.abs(d) < 1e-12) {
      if (e.a[axis] < min || e.a[axis] > max) return false;
    } else {
      const a = (min - e.a[axis]) / d,
        c = (max - e.a[axis]) / d;
      lo = Math.max(lo, Math.min(a, c));
      hi = Math.min(hi, Math.max(a, c));
      if (lo > hi) return false;
    }
  }
  return true;
}
const overlap = (a: Box, b: Box) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
const boxDistance = (p: Coord, b: Box) =>
  Math.max(b.minX - p[0], 0, p[0] - b.maxX) ** 2 +
  Math.max(b.minY - p[1], 0, p[1] - b.maxY) ** 2;
function project(p: Coord, e: Edge) {
  const dx = e.b[0] - e.a[0],
    dy = e.b[1] - e.a[1],
    t = Math.max(
      0,
      Math.min(
        1,
        ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) /
          (dx * dx + dy * dy || 1),
      ),
    );
  const q: Coord = [e.a[0] + t * dx, e.a[1] + t * dy];
  return {
    q,
    d: Math.hypot(p[0] - q[0], p[1] - q[1]),
    value: e.av + t * (e.bv - e.av),
  };
}
type Hit = ReturnType<typeof project>;
/** Spatial index keeps detailed shorelines out of the per-vertex full scan. */
class EdgeIndex {
  box: Box;
  left?: EdgeIndex;
  right?: EdgeIndex;
  edges: Edge[] = [];
  constructor(edges: Edge[]) {
    this.box = edges.reduce(
      (b, e) => ({
        minX: Math.min(b.minX, e.minX),
        minY: Math.min(b.minY, e.minY),
        maxX: Math.max(b.maxX, e.maxX),
        maxY: Math.max(b.maxY, e.maxY),
      }),
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    if (edges.length <= 12) this.edges = edges;
    else {
      const x = this.box.maxX - this.box.minX >= this.box.maxY - this.box.minY;
      edges.sort((a, b) =>
        x
          ? a.minX + a.maxX - b.minX - b.maxX
          : a.minY + a.maxY - b.minY - b.maxY,
      );
      const m = Math.floor(edges.length / 2);
      this.left = new EdgeIndex(edges.slice(0, m));
      this.right = new EdgeIndex(edges.slice(m));
    }
  }
  query(b: Box, visit: (e: Edge) => void) {
    if (!overlap(this.box, b)) return;
    if (this.left) {
      this.left.query(b, visit);
      this.right!.query(b, visit);
    } else for (const e of this.edges) if (overlap(e, b)) visit(e);
  }
  nearest(
    p: Coord,
    limit = Infinity,
    accept: (h: Hit) => boolean = () => true,
  ) {
    let hit: Hit | null = null,
      best = limit;
    const walk = (n: EdgeIndex) => {
      if (boxDistance(p, n.box) > best * best) return;
      if (n.left) {
        const children = [n.left, n.right!].sort(
          (a, b) => boxDistance(p, a.box) - boxDistance(p, b.box),
        );
        walk(children[0]);
        walk(children[1]);
      } else
        for (const e of n.edges) {
          const h = project(p, e);
          if (h.d <= best && accept(h)) {
            best = h.d;
            hit = h;
          }
        }
    };
    walk(this);
    return hit as Hit | null;
  }
}
const cross = (a: Coord, b: Coord, c: Coord) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const rect = (b: Box): Coord[][] => [
  [
    [b.minX, b.minY],
    [b.maxX, b.minY],
    [b.maxX, b.maxY],
    [b.minX, b.maxY],
    [b.minX, b.minY],
  ],
];

/** A separate, bounded scalar field ONLY in missing shore-connected cells.
 * Existing IDW nodes and complete marching-squares cells are never modified.
 * Source depths are linear along the existing valid domain's edges. New water
 * vertices taper as z = z_source * distance_to_shore / (distance_to_shore +
 * distance_to_source). Actual shoreline intersections are fixed to 0 m.
 * No source within the selected radius, across land, or inward from the source
 * means no estimate. Zero-depth shoreline constraints alone cannot create data.
 */
export function extendShoreField(g: Grid): ScalarTriangle[] {
  if (!g.nodes.length) return [];
  const { cols, rows, step } = g,
    water = prepareWaterTest(g.geometry),
    geometry = polygons(g.geometry);
  const coord = (x: number, y: number): Coord => [
    g.minX + x * step,
    g.minY + y * step,
  ];
  const valid = new Uint8Array(cols * rows),
    allowed = new Uint8Array(cols * rows),
    coastal = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      valid[y * cols + x] = [
        g.nodes[y][x],
        g.nodes[y][x + 1],
        g.nodes[y + 1][x + 1],
        g.nodes[y + 1][x],
      ].every((v) => v !== null && Number.isFinite(v))
        ? 1
        : 0;
  const good = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && valid[y * cols + x];
  const supportEdges: Edge[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if (good(x, y)) {
        const p = [
            coord(x, y),
            coord(x + 1, y),
            coord(x + 1, y + 1),
            coord(x, y + 1),
          ],
          v = [
            g.nodes[y][x]!,
            g.nodes[y][x + 1]!,
            g.nodes[y + 1][x + 1]!,
            g.nodes[y + 1][x]!,
          ];
        const neighbors = [
          [x, y - 1],
          [x + 1, y],
          [x, y + 1],
          [x - 1, y],
        ];
        neighbors.forEach(([nx, ny], i) => {
          if (!good(nx, ny))
            supportEdges.push(edge(p[i], p[(i + 1) % 4], v[i], v[(i + 1) % 4]));
        });
      }
  if (!supportEdges.length) return [];
  const source = new EdgeIndex(supportEdges),
    shore = new EdgeIndex(
      rings(g.geometry).flatMap((r) =>
        r
          .map((a, i) => edge(a, r[(i + 1) % r.length]))
          .filter((e) => e.a[0] !== e.b[0] || e.a[1] !== e.b[1]),
      ),
    );
  const queue: number[] = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (valid[i]) continue;
      const b = box(coord(x, y), coord(x + 1, y + 1));
      let touches = false;
      shore.query(b, (e) => {
        if (touchesBox(e, b)) touches = true;
      });
      if (touches || water(coord(x + 0.5, y + 0.5))) allowed[i] = 1;
      if (touches) {
        coastal[i] = 1;
        queue.push(i);
      }
    }
  // Interior no-data holes and separate unsupported water bodies stay unknown.
  for (let n = 0; n < queue.length; n++) {
    const i = queue[n],
      x = i % cols,
      y = Math.floor(i / cols);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ])
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) {
        const j = ny * cols + nx;
        if (allowed[j] && !coastal[j]) {
          coastal[j] = 1;
          queue.push(j);
        }
      }
  }
  const shoreCache = new Map<string, number>(),
    values = new Map<string, number | null>();
  const key = (p: Coord) => p.map((v) => v.toFixed(8)).join(",");
  const shoreDistance = (p: Coord) => {
    const k = key(p);
    let d = shoreCache.get(k);
    if (d === undefined) {
      d = shore.nearest(p)!.d;
      shoreCache.set(k, d);
    }
    return d;
  };
  const visible = (a: Coord, b: Coord) => {
    if (!water([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])) return false;
    let blocked = false;
    shore.query(box(a, b), (e) => {
      const rx = b[0] - a[0],
        ry = b[1] - a[1],
        sx = e.b[0] - e.a[0],
        sy = e.b[1] - e.a[1],
        den = rx * sy - ry * sx;
      if (Math.abs(den) < 1e-12) return;
      const dx = e.a[0] - a[0],
        dy = e.a[1] - a[1],
        t = (dx * sy - dy * sx) / den,
        u = (dx * ry - dy * rx) / den;
      if (t > 1e-7 && t < 1 - 1e-7 && u > 1e-7 && u < 1 - 1e-7) blocked = true;
    });
    return !blocked;
  };
  const value = (p: Coord): number | null => {
    const k = key(p);
    if (values.has(k)) return values.get(k)!;
    const x = (p[0] - g.minX) / step,
      y = (p[1] - g.minY) / step,
      ix = Math.round(x),
      iy = Math.round(y);
    // Keep all original samples, including partially populated grid cells.
    if (Math.abs(x - ix) < 1e-8 && Math.abs(y - iy) < 1e-8) {
      const z = g.nodes[iy]?.[ix];
      if (z !== null && z !== undefined) {
        values.set(k, z);
        return z;
      }
    }
    const ds = shoreDistance(p);
    const h = source.nearest(
      p,
      g.radius,
      (h) => h.d < 1e-7 || (ds <= shoreDistance(h.q) + 1e-7 && visible(p, h.q)),
    );
    const z = h
      ? h.d < 1e-7
        ? h.value
        : ds < 1e-7
          ? 0
          : (h.value * ds) / (ds + h.d)
      : null;
    values.set(k, z);
    return z;
  };
  const tiles = new Map<string, Coord[][][]>(),
    result: ScalarTriangle[] = [];
  for (const i of queue) {
    const x = i % cols,
      y = Math.floor(i / cols),
      b = box(coord(x, y), coord(x + 1, y + 1));
    // Skip distant cells before expensive polygon operations.
    if (!source.nearest(coord(x + 0.5, y + 0.5), g.radius + step * Math.SQRT2))
      continue;
    let touches = false;
    shore.query(b, (e) => {
      if (touchesBox(e, b)) touches = true;
    });
    let pieces: Coord[][][];
    if (touches) {
      const tx = Math.floor(x / 16) * 16,
        ty = Math.floor(y / 16) * 16,
        k = `${tx},${ty}`;
      let tile = tiles.get(k);
      if (!tile) {
        tile = polygonClipping.intersection(
          geometry,
          rect(box(coord(tx, ty), coord(tx + 16, ty + 16))),
        );
        tiles.set(k, tile);
      }
      pieces = tile.length ? polygonClipping.intersection(tile, rect(b)) : [];
    } else pieces = water(coord(x + 0.5, y + 0.5)) ? [rect(b)] : [];
    for (const polygon of pieces) {
      const { vertices, holes } = flatten(polygon),
        indices = earcut(vertices, holes);
      for (let n = 0; n < indices.length; n += 3) {
        let p = indices
          .slice(n, n + 3)
          .map(
            (j) => [vertices[j * 2], vertices[j * 2 + 1]] as Coord,
          ) as ScalarTriangle["p"];
        if (cross(...p) < 0) p = [p[0], p[2], p[1]];
        const v = p.map(value);
        if (v.some((z) => z === null) || Math.abs(cross(...p)) < 1e-12)
          continue;
        if (v.every((z) => z === 0)) {
          const center: Coord = [
              (p[0][0] + p[1][0] + p[2][0]) / 3,
              (p[0][1] + p[1][1] + p[2][1]) / 3,
            ],
            z = value(center);
          if (z !== null && z > 0) {
            for (let j = 0; j < 3; j++)
              result.push({ p: [p[j], p[(j + 1) % 3], center], v: [0, 0, z] });
            continue;
          }
        }
        result.push({ p, v: v as ScalarTriangle["v"] });
      }
    }
  }
  return result;
}
