import osmtogeojson from "osmtogeojson";
import {
  geometryStats,
  inside,
  validWaterGeometry,
  type Coord,
  type WaterGeometry,
} from "./geometry";
import type { Lake } from "./survey";

export type LakeSelection = {
  name: string;
  boundary: WaterGeometry;
  source: NonNullable<Lake["source"]>;
  area: number;
  islands: number;
  parts: number;
};
type OsmElement = {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: {
    type: string;
    ref: number;
    role: string;
    geometry?: ({ lat: number; lon: number } | null)[];
  }[];
};
export type OverpassData = { elements: OsmElement[]; remark?: string };
export class LakeLookupError extends Error {
  constructor(
    message: string,
    public status = 503,
  ) {
    super(message);
  }
}
const isLake = (tags: Record<string, string> = {}) =>
  tags.landuse === "reservoir" ||
  (tags.natural === "water" &&
    (!tags.water ||
      ["lake", "pond", "reservoir", "oxbow"].includes(tags.water)));
const complete = (e: OsmElement) => {
  const validLine = (g: OsmElement["geometry"]) =>
    !!g &&
    g.length >= 2 &&
    g.every((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (e.type === "way") return validLine(e.geometry);
  return (
    !!e.members?.length &&
    e.members
      .filter((m) => m.role === "outer" || m.role === "inner" || !m.role)
      .every((m) => m.type === "way" && validLine(m.geometry))
  );
};
/** Convert full, un-clipped OSM geometry, preserving every exterior and inner ring. Never choose a nearby lake. */
export function candidatesFromOverpass(
  data: OverpassData,
  point: Coord,
): LakeSelection[] {
  if (!Array.isArray(data.elements) || data.remark)
    throw new LakeLookupError(
      "Shoreline response was incomplete. Wait a moment and retry.",
    );
  // Older OSM multipolygons can keep water tags on an outer way instead of the relation.
  const ways = new Map(
    data.elements.filter((e) => e.type === "way").map((e) => [e.id, e]),
  );
  const elements = data.elements.map((e) => {
    if (
      e.type !== "relation" ||
      e.tags?.type !== "multipolygon" ||
      isLake(e.tags)
    )
      return e;
    const outer = e.members
      ?.filter((m) => m.role === "outer" || !m.role)
      .map((m) => ways.get(m.ref))
      .find((w) => w && isLake(w.tags));
    return outer ? { ...e, tags: { ...outer.tags, ...e.tags } } : e;
  });
  // Do not let a relation's outer member reappear as a hole-free standalone lake.
  const memberWays = new Set(
    elements
      .filter((e) => e.type === "relation" && isLake(e.tags))
      .flatMap(
        (e) =>
          e.members?.filter((m) => m.type === "way").map((m) => m.ref) ?? [],
      ),
  );
  const found: LakeSelection[] = [];
  for (const element of elements) {
    if (
      !["way", "relation"].includes(element.type) ||
      !isLake(element.tags) ||
      !complete(element) ||
      (element.type === "way" && memberWays.has(element.id))
    )
      continue;
    // Convert each complete feature independently to retain its relation identity even for simple multipolygons.
    const collection = osmtogeojson(
      { elements: [structuredClone(element)] } as any,
      { flatProperties: false },
    ) as any;
    for (const feature of collection.features ?? []) {
      if (
        feature.properties?.tainted ||
        !validWaterGeometry(feature.geometry) ||
        !inside(point, feature.geometry)
      )
        continue;
      const boundary = feature.geometry as WaterGeometry,
        stats = geometryStats(boundary);
      if (JSON.stringify(boundary).length > 1500000)
        throw new LakeLookupError(
          "The full shoreline exceeds this version’s geometry limit. No project was created.",
          422,
        );
      if (stats.area <= 0) continue;
      found.push({
        name: (
          element.tags?.["name:fi"] ||
          element.tags?.name ||
          "Unnamed lake"
        ).slice(0, 100),
        boundary,
        source: {
          provider: "openstreetmap",
          osmType: element.type as "way" | "relation",
          osmId: element.id,
          retrievedAt: new Date().toISOString(),
        },
        area: stats.area,
        islands: stats.islands,
        parts: stats.parts,
      });
    }
  }
  return found.sort((a, b) => a.area - b.area);
}
const filter =
  '["natural"="water"]["water"!~"^(river|canal|stream|ditch|basin|wastewater)$"]';
export function lookupQuery(point: Coord, nearby = false) {
  const [lon, lat] = point;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    Math.abs(lat) > 85 ||
    Math.abs(lon) > 180
  )
    throw new LakeLookupError("Invalid location.", 400);
  const at = `${lat.toFixed(7)},${lon.toFixed(7)}`;
  const seed = nearby
    ? `(way(around:1000,${at})${filter};relation(around:1000,${at})${filter};way(around:1000,${at})["landuse"="reservoir"];relation(around:1000,${at})["landuse"="reservoir"];)->.water;`
    : `is_in(${at})->.areas;(way(pivot.areas)${filter};relation(pivot.areas)${filter};way(pivot.areas)["landuse"="reservoir"];relation(pivot.areas)["landuse"="reservoir"];)->.water;`;
  // Parents restore islands when a tagged outer way also belongs to a water multipolygon.
  return `[out:json][timeout:25];${seed}(.water;relation(bw.water)["type"="multipolygon"];);out geom;`;
}
