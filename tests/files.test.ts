import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  parseProject,
  importCSV,
  exportCSV,
  csvRows,
  validDepth,
} from "../packages/core/files";
const example = readFileSync(
  new URL("../example-data/demo.depthcalc.json", import.meta.url),
  "utf8",
);
const header = "timestamp,latitude,longitude,depth,gps_accuracy";
const row = "2026-09-23T10:32:14Z,61.123456,24.123456,4.8,3.2";
test("Capture CSV and combined CSV round trip retain values and sessions", () => {
  const p = parseProject(example),
    a = importCSV(exportCSV(p.measurements), "lake", "capture.csv");
  assert.equal(a.sessions.length, 1);
  assert.equal(a.measurements.length, p.measurements.length);
  assert.equal(a.measurements[0].depth, p.measurements[0].depth);
  const b = importCSV(exportCSV(p.measurements, true), "lake", "combined.csv");
  assert.equal(b.sessions.length, 2);
  assert.equal(b.measurements[0].accuracy, p.measurements[0].accuracy);
});
test("BOM, quoted commas, CRLF and extra columns accepted", () => {
  const parsed = importCSV(
    "\uFEFF" + header + ",note\r\n" + row + ',"hello, lake"\r\n',
    "l",
    "s",
  );
  assert.equal(parsed.measurements.length, 1);
  assert.deepEqual(csvRows('a,b\r\n"a""b","multi\nline"'), [
    ["a", "b"],
    ['a"b', "multi\nline"],
  ]);
});
test("Invalid CSV is rejected atomically with informative errors", () => {
  for (const text of [
    "",
    header,
    header + "\n" + row.replace("4.8", "NaN"),
    header + "\n" + row.replace("2026-09-23", "2026-02-30"),
    header + "\n" + row.replace("61.123456", "91"),
    header + "\n" + row.replace("4.8", "-1"),
    header + "\n" + row.replace("3.2", ""),
    header + "\n" + row.replace("3.2", "-3"),
    header + "\n" + row.replace("2026-09-23T10:32:14Z", "yesterday"),
    header + "\n" + row + ",extra",
    header + "\n" + row + "\ninvalid",
    '"unclosed',
  ])
    assert.throws(() => importCSV(text, "l", "s"));
  assert(!validDepth(""));
  assert(!validDepth("Infinity"));
  assert(!validDepth("-2"));
  assert(validDepth("5,1"));
});
test("Portable project round trip and malformed geometry, references, settings rejected", () => {
  const p = parseProject(example);
  assert.deepEqual(parseProject(JSON.stringify(p)), p);
  for (const mutate of [
    (p: any) => (p.version = 2),
    (p: any) => p.lake.boundary.coordinates[0].pop(),
    (p: any) => (p.settings.radius = 41),
    (p: any) => (p.settings.coverageRadius = 101),
    (p: any) => (p.measurements[0].sessionId = "missing"),
    (p: any) => p.measurements.push(p.measurements[0]),
    (p: any) => (p.measurements[0].accuracy = -1),
    (p: any) => (p.lake = null),
  ]) {
    const bad = JSON.parse(example);
    mutate(bad);
    assert.throws(() => parseProject(JSON.stringify(bad)));
  }
  for (const value of ["null", "[]", "{}", "true", "broken"])
    assert.throws(() => parseProject(value));
});
