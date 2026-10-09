import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseProject } from "../packages/core/files";
import { analyze, inside, projection } from "../packages/core/survey";
test("bundled Finnish demo has valid soundings, realistic size and mixed coverage", () => {
  const p = parseProject(
    readFileSync("example-data/kayralampi.depthcalc.json", "utf8"),
  );
  assert.equal(p.lake.source?.osmId, 4820156);
  assert.ok(
    p.measurements.every((m) =>
      inside([m.longitude, m.latitude], p.lake.boundary),
    ),
  );
  const m = analyze(
    p.lake.boundary,
    p.measurements,
    false,
    p.settings.radius,
    p.settings,
  );
  assert.ok(m.area / 10000 >= 70 && m.area / 10000 <= 100);
  assert.ok(m.well >= 78 && m.well <= 82);
  assert.ok(m.coverage > m.well && m.coverage < 97);
  assert.ok(Math.max(...p.measurements.map((m) => m.depth)) > 15);
  assert.ok(p.lake.name.includes("synthetic"));
  const proj = projection(p.lake.boundary);
  const gaps = p.measurements.slice(1).map((m, i) => {
    const a = proj.to([m.longitude, m.latitude]),
      prev = p.measurements[i];
    const b = proj.to([prev.longitude, prev.latitude]);
    return Math.hypot(a[0] - b[0], a[1] - b[1]);
  });
  assert.ok(gaps.filter((d) => d >= 4.99 && d <= 15.3).length / gaps.length > 0.9);
  assert.ok(new Set(gaps.map((d) => d.toFixed(1))).size > 20);
});
