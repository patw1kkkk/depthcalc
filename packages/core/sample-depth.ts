import { prepareWaterTest, type Coord } from "./geometry";
import type { analyze } from "./survey";
import type { ScalarTriangle } from "./shore-field";

/** Read the already generated surface. Never rerun IDW during pointer moves. */
export function depthSampler(
  g: ReturnType<typeof analyze>,
  smooth: boolean,
  extension: ScalarTriangle[] = [],
) {
  const water = prepareWaterTest(g.geometry),
    buckets = new Map<number, ScalarTriangle[]>();
  const index = (x: number, y: number) => y * g.cols + x;
  const cells = new Map<number, number | null>();
  if (!smooth)
    for (const c of g.cells)
      cells.set(
        index(
          Math.round((c.x - g.minX) / g.step - 0.5),
          Math.round((c.y - g.minY) / g.step - 0.5),
        ),
        c.value,
      );
  for (const t of extension) {
    const xs = t.p.map((p) => (p[0] - g.minX) / g.step),
      ys = t.p.map((p) => (p[1] - g.minY) / g.step);
    for (
      let y = Math.max(0, Math.floor(Math.min(...ys)));
      y <= Math.min(g.rows - 1, Math.floor(Math.max(...ys)));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(Math.min(...xs)));
        x <= Math.min(g.cols - 1, Math.floor(Math.max(...xs)));
        x++
      ) {
        const key = index(x, y),
          list = buckets.get(key) ?? [];
        list.push(t);
        buckets.set(key, list);
      }
  }
  return (p: Coord): number | null => {
    if (!water(p)) return null;
    const gx = (p[0] - g.minX) / g.step,
      gy = (p[1] - g.minY) / g.step;
    if (gx < 0 || gy < 0 || gx > g.cols || gy > g.rows) return null;
    const x = Math.min(g.cols - 1, Math.floor(gx)),
      y = Math.min(g.rows - 1, Math.floor(gy));
    // Pixel mode reports the actual estimate represented by the hovered cell.
    if (!smooth) return cells.get(index(x, y)) ?? null;
    const v = [
      g.nodes[y]?.[x],
      g.nodes[y]?.[x + 1],
      g.nodes[y + 1]?.[x],
      g.nodes[y + 1]?.[x + 1],
    ];
    if (
      v.every(
        (z): z is number => z !== null && z !== undefined && Number.isFinite(z),
      )
    ) {
      const tx = gx - x,
        ty = gy - y;
      return (
        (1 - ty) * ((1 - tx) * v[0] + tx * v[1]) +
        ty * ((1 - tx) * v[2] + tx * v[3])
      );
    }
    for (const {
      p: [a, b, c],
      v,
    } of buckets.get(index(x, y)) ?? []) {
      const det = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(det) < 1e-12) continue;
      const u =
        ((b[1] - c[1]) * (p[0] - c[0]) + (c[0] - b[0]) * (p[1] - c[1])) / det;
      const w =
          ((c[1] - a[1]) * (p[0] - c[0]) + (a[0] - c[0]) * (p[1] - c[1])) / det,
        h = 1 - u - w;
      if (u >= -1e-8 && w >= -1e-8 && h >= -1e-8)
        return Math.max(0, u * v[0] + w * v[1] + h * v[2]);
    }
    return null;
  };
}
