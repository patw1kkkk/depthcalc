import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { test } from "node:test";
import { parseProject, importCSV } from "../packages/core/files";
import { analyze, contours } from "../packages/core/survey";
import { depthBands } from "../packages/core/surface";
import { DEFAULT_SETTINGS } from "../packages/core/settings";
import { createPDF } from "../packages/core/export-pdf";
import { chartSVG } from "../packages/core/export-image";
const read = (name: string) =>
  readFileSync(new URL("../example-data/" + name, import.meta.url), "utf8");
test("Two Capture-format CSVs → coverage → all interpolation radii → contours → PDF/SVG", () => {
  const p = parseProject(read("empty-lake.depthcalc.json"));
  for (const f of ["session-1.csv", "session-2.csv"]) {
    const data = importCSV(read(f), p.lake.id, f);
    p.sessions.push(...data.sessions);
    p.measurements.push(...data.measurements);
  }
  assert.equal(p.sessions.length, 2);
  const coverage = analyze(p.lake.boundary, p.measurements);
  assert.equal(coverage.step, 13);
  assert(coverage.coverage > 80);
  assert(coverage.well > 50);
  assert(coverage.usable < p.measurements.length);
  for (const radius of [20, 30, 40, 50, 100]) {
    const g = analyze(p.lake.boundary, p.measurements, true, radius),
      bands = depthBands(g, 2),
      lines = contours(g, 2);
    assert(bands.length > 0);
    assert(lines.length > 0);
    // Every contour endpoint lies on an edge of a matching depth band.
    const vertices = new Set(
      bands
        .filter((b) => b.level > 0)
        .flatMap((b) =>
          b.points.map(
            (v) => `${b.level}:${v.map((n) => n.toFixed(5)).join(",")}`,
          ),
        ),
    );
    for (const line of lines) {
      assert(
        vertices.has(
          `${line.level}:${line.a.map((n) => n.toFixed(5)).join(",")}`,
        ),
      );
      assert(
        vertices.has(
          `${line.level}:${line.b.map((n) => n.toFixed(5)).join(",")}`,
        ),
      );
    }
  }
  const g = analyze(p.lake.boundary, p.measurements, true),
    doc = createPDF(p.lake, p.measurements, g, 2),
    pdf = doc.output("arraybuffer");
  assert(pdf.byteLength > 10000);
  assert.equal(doc.getNumberOfPages(), 1);
  const svg = chartSVG(p.lake, p.measurements, g, 2);
  assert(svg.includes('clip-rule="evenodd"'));
  assert(!svg.includes("linearGradient"));
  assert(!svg.includes("NaN"));
  mkdirSync("test-results", { recursive: true });
  writeFileSync("test-results/workflow.pdf", Buffer.from(pdf));
  writeFileSync("test-results/workflow.svg", svg);
});
test("Coverage settings are honored independently of the interpolation radius", () => {
  const p = parseProject(read("demo.depthcalc.json"));
  const narrow = { ...DEFAULT_SETTINGS, gpsAccuracy: 2 };
  assert.equal(
    analyze(p.lake.boundary, p.measurements, false, 40, narrow).coverage,
    0,
  );
  const g = analyze(p.lake.boundary, p.measurements, false, 40, {
    ...DEFAULT_SETTINGS,
    coverageRadius: 10,
    goodCount: 10,
  });
  assert(g.well < g.coverage);
});
