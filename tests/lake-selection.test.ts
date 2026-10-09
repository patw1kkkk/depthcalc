import assert from "node:assert/strict";
import {
  candidatesFromOverpass,
  lookupQuery,
  type OverpassData,
} from "../packages/core/lake-selection";
import {
  inside,
  prepareWaterTest,
  validWaterGeometry,
  geometryStats,
  type WaterGeometry,
  type Coord,
} from "../packages/core/geometry";
import { analyze, type Measurement } from "../packages/core/survey";
const outer: Coord[] = [
  [25, 61],
  [25.004, 61],
  [25.004, 61.004],
  [25, 61.004],
  [25, 61],
];
const island: Coord[] = [
  [25.001, 61.001],
  [25.003, 61.001],
  [25.003, 61.003],
  [25.001, 61.003],
  [25.001, 61.001],
];
const second: Coord[] = [
  [25.006, 61],
  [25.007, 61],
  [25.007, 61.001],
  [25.006, 61.001],
  [25.006, 61],
];
const line = (c: Coord[]) => c.map(([lon, lat]) => ({ lon, lat }));
const relation = {
  type: "relation",
  id: 100,
  tags: {
    type: "multipolygon",
    natural: "water",
    water: "lake",
    name: "Testilampi",
  },
  members: [
    { type: "way", ref: 1, role: "outer", geometry: line(outer.slice(0, 3)) },
    {
      type: "way",
      ref: 2,
      role: "outer",
      geometry: line([outer[2], outer[3], outer[4]]),
    },
    { type: "way", ref: 3, role: "inner", geometry: line(island) },
    { type: "way", ref: 4, role: "outer", geometry: line(second) },
  ],
};
const data: OverpassData = { elements: [relation] };
const found = candidatesFromOverpass(data, [25.0005, 61.0005]);
assert.equal(found.length, 1);
const lake = found[0];
assert.equal(lake.name, "Testilampi");
assert.equal(lake.source.osmType, "relation");
assert.equal(lake.source.osmId, 100);
assert.equal(lake.islands, 1);
assert.equal(lake.parts, 2);
assert.equal(lake.boundary.type, "MultiPolygon");
assert(
  inside([25.0065, 61.0005], lake.boundary),
  "Full second polygon must be retained even though click was in the first",
);
assert(!inside([25.002, 61.002], lake.boundary), "Island is land");
assert.equal(
  candidatesFromOverpass(data, [25.002, 61.002]).length,
  0,
  "Island click must not select enclosing lake",
);
assert.equal(
  candidatesFromOverpass(data, [25.02, 61]).length,
  0,
  "Never snap a land click to a nearby lake",
);
const partial = structuredClone(data);
partial.elements[0].members![2].geometry = undefined;
assert.equal(
  candidatesFromOverpass(partial, [25.0005, 61.0005]).length,
  0,
  "Missing island data must reject the whole lake",
);
assert.throws(
  () =>
    candidatesFromOverpass({ ...data, remark: "runtime timeout" }, [25, 61]),
  /incomplete/,
);
const standalone: OverpassData = {
  elements: [
    {
      type: "way",
      id: 200,
      tags: { natural: "water", water: "pond" },
      geometry: line(outer),
    },
  ],
};
assert.equal(
  candidatesFromOverpass(standalone, [25.0005, 61.0005])[0].name,
  "Unnamed lake",
);
const river: OverpassData = {
  elements: [
    { ...standalone.elements[0], tags: { natural: "water", water: "river" } },
  ],
};
assert.equal(candidatesFromOverpass(river, [25.0005, 61.0005]).length, 0);
assert(lookupQuery([25, 61]).includes("is_in(61.0000000,25.0000000)"));
assert(
  lookupQuery([25, 61]).endsWith("out geom;"),
  "No output bounding box clipping",
);
assert.throws(() => lookupQuery([NaN, 61]));
const test = prepareWaterTest(lake.boundary);
for (let i = 0; i < 1000; i++) {
  const p: Coord = [
    24.999 + (i % 40) * 0.00023,
    60.999 + Math.floor(i / 40) * 0.00025,
  ];
  assert.equal(test(p), inside(p, lake.boundary));
}
const measure = (id: string, p: Coord): Measurement => ({
  id,
  lakeId: "lake",
  sessionId: "session",
  longitude: p[0],
  latitude: p[1],
  depth: 8,
  accuracy: 3,
  timestamp: "2026-09-19T12:00:00Z",
});
const model = analyze(
  lake.boundary,
  [
    measure("water", [25.0005, 61.0005]),
    measure("island", [25.002, 61.002]),
    measure("second", [25.0065, 61.0005]),
  ],
  true,
);
assert.equal(model.usable, 2, "Island measurements cannot enter the model");
assert(
  model.cells.every((c) => inside(model.proj.from([c.x, c.y]), lake.boundary)),
  "All coverage/depth cells must be in actual water",
);
const noIslands: WaterGeometry = { type: "Polygon", coordinates: [outer] };
assert(geometryStats(lake.boundary).area < geometryStats(noIslands).area);
const invalid = structuredClone(lake.boundary) as {
  type: "MultiPolygon";
  coordinates: Coord[][][];
};
invalid.coordinates[0][0].pop();
assert(!validWaterGeometry(invalid), "Reject open rings");
console.log(
  "PASS: full OSM relation, islands, disjoint water parts, exact click containment, incomplete/rejected lookup, geometry validation, indexed containment, coverage and interpolation island exclusion",
);

const oldStyle: OverpassData = {
  elements: [
    {
      type: "way",
      id: 10,
      tags: { natural: "water", name: "Old-style lake" },
      geometry: line(outer),
    },
    {
      type: "relation",
      id: 11,
      tags: { type: "multipolygon" },
      members: [
        { type: "way", ref: 10, role: "outer", geometry: line(outer) },
        { type: "way", ref: 12, role: "inner", geometry: line(island) },
      ],
    },
  ],
};
assert.equal(
  candidatesFromOverpass(oldStyle, [25.0005, 61.0005])[0].islands,
  1,
);
assert.equal(
  candidatesFromOverpass(oldStyle, [25.002, 61.002]).length,
  0,
  "An outer water way must not swallow an old-style multipolygon island",
);
console.log("PASS: legacy OSM outer-way tags retain parent relation islands");
