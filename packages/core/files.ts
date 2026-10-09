import { validWaterGeometry } from "./geometry";
import { DEFAULT_SETTINGS, RADII, type Settings } from "./settings";
import type { Lake, Measurement, Session } from "./survey";
export type NamedSession = Session & { name: string };
export type Project = {
  format: "depthcalc-project";
  version: 1;
  lake: Lake;
  sessions: NamedSession[];
  measurements: Measurement[];
  settings: Settings;
};
export const uid = () => crypto.randomUUID();
export const validDepth = (value: string) =>
  value.trim() !== "" &&
  Number.isFinite(Number(value.replace(",", "."))) &&
  Number(value.replace(",", ".")) >= 0 &&
  Number(value.replace(",", ".")) <= 500;
const fail = (message: string): never => {
  throw new Error(message);
};
function numeric(
  value: string,
  name: string,
  min: number,
  max: number,
  row: number,
) {
  if (
    !value.trim() ||
    !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(value.trim())
  )
    fail(`Row ${row}: invalid ${name}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max)
    fail(`Row ${row}: ${name} must be ${min}–${max}`);
  return n;
}
function timestamp(value: unknown) {
  if (typeof value !== "string") return false;
  const m =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!m || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second] = m.map(Number);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days &&
    hour < 24 &&
    minute < 60 &&
    second < 60
  );
}
/** RFC 4180 quoted fields, CRLF, BOM, and embedded newlines. No silent row loss. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let field = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
      continue;
    }
    if (c === '"') {
      if (field || closed) fail("Malformed CSV quoting");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some((v) => v.trim())) rows.push([...row]);
        row.length = 0;
      }
    } else {
      if (closed) fail("Unexpected text after CSV quote");
      field += c;
    }
  }
  if (quoted) fail("Unclosed CSV quote");
  row.push(field);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function importCSV(
  text: string,
  lakeId: string,
  name: string,
): { sessions: NamedSession[]; measurements: Measurement[] } {
  if (text.length > 20 * 1024 * 1024) fail("CSV exceeds 20 MB");
  const [header, ...rows] = csvRows(text),
    required = ["timestamp", "latitude", "longitude", "depth", "gps_accuracy"];
  if (
    !header ||
    required.some((k) => !header.includes(k)) ||
    new Set(header).size !== header.length
  )
    fail("CSV must have unique headers: " + required.join(","));
  if (!rows.length) fail("CSV contains no measurements");
  if (rows.length > 100000) fail("CSV exceeds 100,000 measurements");
  const sessions = new Map<string, NamedSession>();
  const measurements = rows.map((r, i) => {
    if (r.length !== header.length)
      fail(`Row ${i + 2}: wrong number of columns`);
    const get = (k: string) => r[header.indexOf(k)];
    const time = get("timestamp");
    if (!timestamp(time))
      fail(`Row ${i + 2}: timestamp needs an ISO 8601 date with timezone`);
    const group = header.includes("session_id") ? get("session_id") : "session";
    let s = sessions.get(group);
    if (!s) {
      s = {
        id: uid(),
        lakeId,
        name: group === "session" ? name : `${name} / ${group}`,
        startedAt: time,
        endedAt: time,
      };
      sessions.set(group, s);
    }
    if (Date.parse(time) < Date.parse(s.startedAt)) s.startedAt = time;
    if (Date.parse(time) > Date.parse(s.endedAt!)) s.endedAt = time;
    return {
      id: uid(),
      lakeId,
      sessionId: s.id,
      timestamp: time,
      latitude: numeric(get("latitude"), "latitude", -85, 85, i + 2),
      longitude: numeric(get("longitude"), "longitude", -180, 180, i + 2),
      depth: numeric(get("depth"), "depth", 0, 500, i + 2),
      accuracy: numeric(get("gps_accuracy"), "gps_accuracy", 0, 100000, i + 2),
    };
  });
  return { sessions: [...sessions.values()], measurements };
}
export function exportCSV(points: Measurement[], combined = false) {
  const quote = (v: unknown) => '"' + String(v).replaceAll('"', '""') + '"';
  return (
    (combined ? "session_id," : "") +
    "timestamp,latitude,longitude,depth,gps_accuracy\r\n" +
    points
      .map((p) =>
        (combined ? [quote(p.sessionId)] : [])
          .concat([
            p.timestamp,
            String(p.latitude),
            String(p.longitude),
            String(p.depth),
            String(p.accuracy),
          ])
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
export function createProject(lake: Lake): Project {
  return {
    format: "depthcalc-project",
    version: 1,
    lake,
    sessions: [],
    measurements: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}
export function parseProject(text: string): Project {
  if (text.length > 40 * 1024 * 1024) fail("Project exceeds 40 MB");
  let p!: Project;
  try {
    p = JSON.parse(text);
  } catch {
    fail("Invalid project JSON");
  }
  if (!p! || p.format !== "depthcalc-project" || p.version !== 1)
    fail("Unsupported project format or version");
  if (
    !p.lake ||
    typeof p.lake.id !== "string" ||
    !p.lake.id ||
    typeof p.lake.name !== "string" ||
    !p.lake.name.trim() ||
    p.lake.name.length > 200 ||
    !validWaterGeometry(p.lake.boundary) ||
    !timestamp(p.lake.createdAt)
  )
    fail("Invalid lake information or geometry");
  if (
    !Array.isArray(p.sessions) ||
    !Array.isArray(p.measurements) ||
    p.measurements.length > 100000
  )
    fail("Invalid sessions or measurements");
  const sessions = new Set<string>(),
    ids = new Set<string>();
  for (const s of p.sessions) {
    if (
      !s ||
      typeof s.id !== "string" ||
      !s.id ||
      sessions.has(s.id) ||
      s.lakeId !== p.lake.id ||
      typeof s.name !== "string" ||
      !timestamp(s.startedAt) ||
      (s.endedAt !== null && !timestamp(s.endedAt))
    )
      fail("Invalid or duplicate session");
    sessions.add(s.id);
  }
  for (const m of p.measurements) {
    if (
      !m ||
      typeof m.id !== "string" ||
      !m.id ||
      ids.has(m.id) ||
      m.lakeId !== p.lake.id ||
      !sessions.has(m.sessionId) ||
      !timestamp(m.timestamp) ||
      !Number.isFinite(m.latitude) ||
      Math.abs(m.latitude) > 85 ||
      !Number.isFinite(m.longitude) ||
      Math.abs(m.longitude) > 180 ||
      !Number.isFinite(m.depth) ||
      m.depth < 0 ||
      m.depth > 500 ||
      !Number.isFinite(m.accuracy) ||
      m.accuracy < 0 ||
      m.accuracy > 100000
    )
      fail("Invalid measurement or session reference");
    ids.add(m.id);
  }
  const s = p.settings;
  if (s) {
    if (s.smoothColors === undefined) s.smoothColors = true;
    if (s.smoothing === undefined) s.smoothing = 30;
  }
  if (
    !s ||
    !RADII.includes(s.radius as (typeof RADII)[number]) ||
    !Number.isInteger(s.interval) ||
    s.interval < 1 ||
    s.interval > 6 ||
    typeof s.smoothColors !== "boolean" ||
    !Number.isFinite(s.smoothing) ||
    s.smoothing < 0 ||
    s.smoothing > 100 ||
    !Number.isFinite(s.gpsAccuracy) ||
    s.gpsAccuracy <= 0 ||
    s.gpsAccuracy > 1000 ||
    !Number.isFinite(s.coverageGrid) ||
    s.coverageGrid < 2 ||
    s.coverageGrid > 100 ||
    !Number.isFinite(s.coverageRadius) ||
    s.coverageRadius < 1 ||
    s.coverageRadius > 100 ||
    !Number.isInteger(s.goodCount) ||
    s.goodCount < 1 ||
    s.goodCount > 100
  )
    fail("Invalid project settings");
  if (p.lake.source) {
    const s = p.lake.source;
    if (
      s.provider !== "openstreetmap" ||
      !["way", "relation"].includes(s.osmType) ||
      !Number.isSafeInteger(s.osmId) ||
      s.osmId <= 0 ||
      !timestamp(s.retrievedAt)
    )
      fail("Invalid shoreline source");
  }
  return p;
}
export function download(
  name: string,
  data: Blob | string,
  type = "application/octet-stream",
) {
  const url = URL.createObjectURL(
      typeof data === "string" ? new Blob([data], { type }) : data,
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
