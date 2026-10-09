"use client";
import { memo, useMemo } from "react";
import { gridPaths } from "../core/grid-paths";
import { world, type analyze, type Coord } from "../core/survey";

/** Cache the grid drawing across session-clock and other unrelated updates. */
export const DepthGrid = memo(function DepthGrid({
  model,
  interval,
  zoom,
  left,
  top,
  width,
  height,
}: {
  model: ReturnType<typeof analyze>;
  interval: number;
  zoom: number;
  left: number;
  top: number;
  width: number;
  height: number;
}) {
  const paths = useMemo(
    () =>
      gridPaths(
        model,
        interval,
        (p) => {
          const q = world(model.proj.from(p), zoom);
          return [q[0] - left, q[1] - top] as Coord;
        },
        width,
        height,
      ),
    [model, interval, zoom, left, top, width, height],
  );
  return (
    <g data-depth-grid>
      {paths.map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} />
      ))}
    </g>
  );
});
