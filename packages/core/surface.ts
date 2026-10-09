// Compatibility exports; all chart geometry now uses the private edition's field.
import { filledContours, contourSegments } from "./filled-contours";
import type { analyze } from "./survey";
export const groupedDepthBands = filledContours;
export const surfaceContours = contourSegments;
export function depthBands(g: ReturnType<typeof analyze>, interval: number) {
  return filledContours(g, interval).flatMap((b) =>
    b.rings.map((points) => ({ level: b.level, points })),
  );
}
