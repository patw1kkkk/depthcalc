/** Canonical water geometry. Every polygon has one exterior ring and zero or more island rings. */
export type Coord = [number, number];
export type WaterGeometry =
  | { type: "Polygon"; coordinates: Coord[][] }
  | { type: "MultiPolygon"; coordinates: Coord[][][] };
/** Legacy projects retain their original ring; no destructive migration is needed. */
export type Boundary = Coord[] | WaterGeometry;
export const polygons = (boundary: Boundary): Coord[][][] =>
  Array.isArray(boundary)
    ? boundary.length
      ? [[boundary]]
      : []
    : boundary.type === "Polygon"
      ? [boundary.coordinates]
      : boundary.coordinates;
export const rings = (boundary: Boundary) => polygons(boundary).flat();
export const exteriorPoints = (boundary: Boundary) =>
  polygons(boundary).flatMap((p) => p[0]);
export function bounds(points: Coord[]) {
  return points.reduce(
    (b, p) => ({
      minX: Math.min(b.minX, p[0]),
      minY: Math.min(b.minY, p[1]),
      maxX: Math.max(b.maxX, p[0]),
      maxY: Math.max(b.maxY, p[1]),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
export function inRing(p: Coord, ring: Coord[]) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes;
  }
  return yes;
}
export function inside(p: Coord, boundary: Boundary) {
  return polygons(boundary).some(
    (polygon) =>
      inRing(p, polygon[0]) &&
      !polygon.slice(1).some((hole) => inRing(p, hole)),
  );
}
/** Bucket shoreline edges by latitude so detailed OSM coastlines do not require a full scan per grid cell. */
export function prepareWaterTest(boundary: Boundary) {
  const prepared = polygons(boundary).map((poly) =>
    poly.map((ring) => {
      const b = bounds(ring),
        span = b.maxY - b.minY || 1;
      const buckets: [Coord, Coord][][] = Array.from({ length: 128 }, () => []);
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i],
          c = ring[j];
        const lo = Math.max(
          0,
          Math.floor(((Math.min(a[1], c[1]) - b.minY) / span) * 128),
        );
        const hi = Math.min(
          127,
          Math.floor(((Math.max(a[1], c[1]) - b.minY) / span) * 128),
        );
        for (let k = lo; k <= hi; k++) buckets[k].push([a, c]);
      }
      return (p: Coord) => {
        if (p[0] < b.minX || p[0] > b.maxX || p[1] < b.minY || p[1] > b.maxY)
          return false;
        const bucket =
          buckets[Math.min(127, Math.floor(((p[1] - b.minY) / span) * 128))];
        let yes = false;
        for (const [a, c] of bucket)
          if (
            a[1] > p[1] !== c[1] > p[1] &&
            p[0] < ((c[0] - a[0]) * (p[1] - a[1])) / (c[1] - a[1]) + a[0]
          )
            yes = !yes;
        return yes;
      };
    }),
  );
  return (p: Coord) =>
    prepared.some(
      (poly) => poly[0](p) && !poly.slice(1).some((test) => test(p)),
    );
}
export function asGeometry(boundary: Boundary): WaterGeometry {
  if (!Array.isArray(boundary)) return boundary;
  const ring = [...boundary];
  if (
    ring.length &&
    (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])
  )
    ring.push([...ring[0]]);
  return { type: "Polygon", coordinates: [ring] };
}
export function validWaterGeometry(value: unknown): value is WaterGeometry {
  if (!value || typeof value !== "object") return false;
  const g = value as WaterGeometry;
  if (
    !["Polygon", "MultiPolygon"].includes(g.type) ||
    !Array.isArray(g.coordinates)
  )
    return false;
  const ps = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  if (!ps.length || ps.length > 1000) return false;
  let count = 0;
  for (const poly of ps) {
    if (!Array.isArray(poly) || !poly.length || poly.length > 5000)
      return false;
    for (const ring of poly) {
      if (
        !Array.isArray(ring) ||
        ring.length < 4 ||
        (count += ring.length) > 100000
      )
        return false;
      if (
        ring.some(
          (p) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            !p.every(Number.isFinite) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 85,
        )
      )
        return false;
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])
        return false;
      const origin = ring[0];
      const area = ring.reduce((s, a, i) => {
        const b = ring[(i + 1) % ring.length];
        return (
          s +
          (a[0] - origin[0]) * (b[1] - origin[1]) -
          (b[0] - origin[0]) * (a[1] - origin[1])
        );
      }, 0);
      if (Math.abs(area) < 1e-14) return false;
    }
    // An island must belong to this exterior, not to an unrelated water body.
    if (poly.slice(1).some((hole) => !inRing(hole[0], poly[0]))) return false;
  }
  return true;
}
export function mapGeometry(
  boundary: Boundary,
  transform: (p: Coord) => Coord,
): WaterGeometry {
  return {
    type: "MultiPolygon",
    coordinates: polygons(boundary).map((poly) =>
      poly.map((ring) => ring.map(transform)),
    ),
  };
}
export function geometryStats(boundary: Boundary) {
  const ps = polygons(boundary),
    pts = exteriorPoints(boundary),
    b = bounds(pts);
  const latitude = (b.minY + b.maxY) / 2,
    longitude = (b.minX + b.maxX) / 2;
  const k = 111320 * Math.cos((latitude * Math.PI) / 180);
  const areaOf = (ring: Coord[]) =>
    Math.abs(
      ring.reduce((sum, p, i) => {
        const q = ring[(i + 1) % ring.length];
        return (
          sum +
          (p[0] - longitude) * k * (q[1] - latitude) * 111320 -
          (q[0] - longitude) * k * (p[1] - latitude) * 111320
        );
      }, 0),
    ) / 2;
  return {
    area: ps.reduce(
      (s, poly) =>
        s + areaOf(poly[0]) - poly.slice(1).reduce((a, r) => a + areaOf(r), 0),
      0,
    ),
    islands: ps.reduce((s, p) => s + p.length - 1, 0),
    parts: ps.length,
    ...b,
  };
}
