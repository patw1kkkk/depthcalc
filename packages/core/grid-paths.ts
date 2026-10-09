import { bandCSS } from "./cartography";
import { contourMaximum } from "./filled-contours";
import type { analyze, Coord } from "./survey";

/** Batch consecutive, identically colored cells. Preserve cell order and the
 * original half-pixel overlap so adjacent colors and no-data hatching paint
 * exactly as before. Mercator X/Y are separable; project each grid axis once,
 * not two full geographic projections for every cell. Off-screen cells need
 * no drawing. This changes rendering only, never the generated depth field. */
export function gridPaths(
  g: ReturnType<typeof analyze>,
  interval: number,
  screen: (p: Coord) => Coord,
  width: number,
  height: number,
) {
  const xs = Array.from(
    { length: g.cols + 1 },
    (_, x) => screen([g.minX + x * g.step, g.minY])[0],
  );
  const ys = Array.from(
    { length: g.rows + 1 },
    (_, y) => screen([g.minX, g.minY + y * g.step])[1],
  );
  const max = Math.max(1, contourMaximum(g)),
    colors = new Map<number, string>();
  const paths: { fill: string; d: string }[] = [];
  for (const c of g.cells) {
    const col = Math.round((c.x - g.minX) / g.step - 0.5),
      row = Math.round((c.y - g.minY) / g.step - 0.5);
    const x = xs[col],
      y = ys[row + 1],
      w = Math.abs(xs[col + 1] - x) + 0.5,
      h = Math.abs(ys[row] - y) + 0.5;
    if (x > width || y > height || x + w < 0 || y + h < 0) continue;
    let fill = "url(#unknown)";
    if (c.value !== null) {
      const band = Math.floor(Math.max(0, c.value) / interval);
      fill = colors.get(band) ?? bandCSS(c.value, max, interval);
      colors.set(band, fill);
    }
    // Same clockwise rectangle as the old SVG rect, including its small overlap.
    const d = `M${x},${y}h${w}v${h}h${-w}Z`;
    const last = paths.at(-1);
    if (last?.fill === fill) last.d += d;
    else paths.push({ fill, d });
  }
  return paths;
}
