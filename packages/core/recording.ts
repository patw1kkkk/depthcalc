import type { Coord, Measurement } from "./survey";
export function distanceMeters(a: Coord, b: Coord) {
  const r = Math.PI / 180,
    lat = (b[1] - a[1]) * r,
    lon = (b[0] - a[0]) * r;
  const h =
    Math.sin(lat / 2) ** 2 +
    Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
export function nearestDistance(position: Coord, points: Measurement[]) {
  return points.length
    ? Math.min(
        ...points.map((p) =>
          distanceMeters(position, [p.longitude, p.latitude]),
        ),
      )
    : null;
}
