import { rings } from "./geometry";
import type { analyze } from "./survey";

type Grid = ReturnType<typeof analyze> & { surfaceMaximum?: number };

/** Diffusion scale in metres: conservative at 30%, broader at high values.
 * Small grids use physical distances; coarse grids retain a useful sub-cell
 * low setting. This scale is independent of IDW radius and contour interval. */
export function smoothingSigma(percent: number, step: number) {
  const s =
    Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0)) / 100;
  return (4 * s + 24 * s * s) * Math.max(1, step / 4);
}

/** Conservative heat diffusion on the known scalar nodes, before shore
 * extension and contouring. Symmetric flux preserves the mean in each water
 * component. Each step is a convex average (dt <= .2, degree <= 4), so it
 * cannot overshoot neighbouring depths. Nulls and land are impermeable, not
 * zero-depth samples. No raw measurements or input grid objects are changed.
 * Zero returns the original object, preserving the exact previous geometry. */
export function smoothSurface(g: Grid, percent: number): Grid {
  const sigma = smoothingSigma(percent, g.step);
  if (!sigma || !g.nodes.length) return g;
  const width = g.cols + 1,
    size = width * (g.rows + 1),
    known = new Uint8Array(size);
  let values = new Float64Array(size),
    next = new Float64Array(size);
  for (let y = 0; y <= g.rows; y++)
    for (let x = 0; x <= g.cols; x++) {
      const z = g.nodes[y][x],
        i = y * width + x;
      if (z !== null && Number.isFinite(z)) {
        known[i] = 1;
        values[i] = z;
      }
    }
  // Block edges intersecting ANY shoreline, including thin islands or narrow
  // land strips whose endpoints both happen to be water. Rasterize shoreline
  // crossings onto graph edges rather than checking every edge against OSM.
  const blocked = new Set<number>();
  const block = (x: number, y: number, axis: number) => {
    if (
      x >= 0 &&
      y >= 0 &&
      x <= g.cols - (axis === 0 ? 1 : 0) &&
      y <= g.rows - (axis === 1 ? 1 : 0)
    )
      blocked.add(2 * (y * width + x) + axis);
  };
  for (const ring of rings(g.geometry))
    for (let n = 0; n < ring.length; n++) {
      const a = ring[n],
        b = ring[(n + 1) % ring.length],
        ax = (a[0] - g.minX) / g.step,
        ay = (a[1] - g.minY) / g.step,
        bx = (b[0] - g.minX) / g.step,
        by = (b[1] - g.minY) / g.step;
      if (Math.abs(by - ay) > 1e-12)
        for (
          let y = Math.max(0, Math.ceil(Math.min(ay, by)));
          y <= Math.min(g.rows, Math.floor(Math.max(ay, by)));
          y++
        ) {
          const x = ax + ((bx - ax) * (y - ay)) / (by - ay),
            ix = Math.floor(x);
          block(ix, y, 0);
          if (Math.abs(x - Math.round(x)) < 1e-8)
            block(Math.round(x) - 1, y, 0);
        }
      if (Math.abs(bx - ax) > 1e-12)
        for (
          let x = Math.max(0, Math.ceil(Math.min(ax, bx)));
          x <= Math.min(g.cols, Math.floor(Math.max(ax, bx)));
          x++
        ) {
          const y = ay + ((by - ay) * (x - ax)) / (bx - ax),
            iy = Math.floor(y);
          block(x, iy, 1);
          if (Math.abs(y - Math.round(y)) < 1e-8)
            block(x, Math.round(y) - 1, 1);
        }
    }
  const aa: number[] = [],
    bb: number[] = [];
  for (let y = 0; y <= g.rows; y++)
    for (let x = 0; x <= g.cols; x++) {
      const i = y * width + x;
      if (!known[i]) continue;
      if (x < g.cols && known[i + 1] && !blocked.has(2 * i)) {
        aa.push(i);
        bb.push(i + 1);
      }
      if (y < g.rows && known[i + width] && !blocked.has(2 * i + 1)) {
        aa.push(i);
        bb.push(i + width);
      }
    }
  const from = Int32Array.from(aa),
    to = Int32Array.from(bb);
  // Fixed full steps plus a fractional final step make the percentage mapping
  // continuous, even when crossing a step-count boundary.
  let time = (sigma * sigma) / (2 * g.step * g.step);
  while (time > 1e-12) {
    const dt = Math.min(0.2, time);
    next.set(values);
    for (let e = 0; e < from.length; e++) {
      const a = from[e],
        b = to[e],
        flux = dt * (values[b] - values[a]);
      next[a] += flux;
      next[b] -= flux;
    }
    [values, next] = [next, values];
    time -= dt;
  }
  const nodes = g.nodes.map((row, y) =>
    row.map((z, x) => (z === null ? null : values[y * width + x])),
  );
  // Cell metadata is used by the legend/contour maximum. Derive it from this
  // same surface as well; OFF always receives the untouched original grid.
  const cells = g.cells.map((c) => {
    if (c.value === null) return c;
    const x = Math.round((c.x - g.minX) / g.step - 0.5),
      y = Math.round((c.y - g.minY) / g.step - 0.5);
    const v = [
      nodes[y]?.[x],
      nodes[y]?.[x + 1],
      nodes[y + 1]?.[x],
      nodes[y + 1]?.[x + 1],
    ].filter((z): z is number => z !== null && z !== undefined);
    return {
      ...c,
      value: v.length ? v.reduce((a, b) => a + b, 0) / v.length : c.value,
    };
  });
  const surfaceMaximum = values.reduce(
    (max, z, i) => (known[i] ? Math.max(max, z) : max),
    0,
  );
  return { ...g, nodes, cells, surfaceMaximum };
}
