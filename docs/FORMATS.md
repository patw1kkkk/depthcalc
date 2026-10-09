# Portable formats

## Capture CSV, version 1

UTF-8 (optional BOM), comma-separated, dot decimals, metres, WGS84 coordinates. CRLF and LF are accepted, along with RFC 4180 quoted fields. Header names are case-sensitive; their order can vary. These five unique columns are required:

```csv
timestamp,latitude,longitude,depth,gps_accuracy
2026-09-23T10:32:14Z,61.123456,24.123456,4.8,3.2
2026-09-23T10:32:21Z,61.123501,24.123623,5.1,3.8
```

| Column         | Meaning / accepted values                                                         |
| -------------- | --------------------------------------------------------------------------------- |
| `timestamp`    | ISO 8601 date/time with `Z` or explicit timezone offset; GPS fix time in Capture  |
| `latitude`     | WGS84 decimal degrees, −85 through 85                                             |
| `longitude`    | WGS84 decimal degrees, −180 through 180                                           |
| `depth`        | Water depth in metres, 0 through 500                                              |
| `gps_accuracy` | Reported horizontal accuracy in metres, 0 through 100000; required, never guessed |

Negative depth/accuracy, nonfinite values, blank required values, missing/duplicate headers, malformed rows, and invalid timestamps are errors. Blank lines are ignored. Unknown additional columns are accepted and ignored. No partial import occurs when a file or another file in the same import batch fails validation. Semicolon-separated and comma-decimal CSVs are not supported; convert them to this format first.

Capture exports exactly the five columns. Studio's combined export prepends `session_id`. On import, each distinct `session_id` creates a session within that file; otherwise the whole file is one session. Internal UUIDs are assigned to imported sessions/measurements. Session names come from file names. A combined CSV preserves session grouping, but the full project format is needed to preserve names, IDs, settings and geometry exactly.

Exact record duplicates across the project/import batch are skipped using timestamp, coordinates, depth and accuracy. Repeated coordinates at different times remain valid raw records; they do not create distinct interpolation locations. Poor-accuracy or outside-lake points are retained, shown in Studio, and excluded from calculations according to project settings.

Maximum 20 MB and 100,000 rows per CSV; maximum 100,000 measurements per Studio project.

## Project JSON, version 1

Filename convention: `lake-name.depthcalc.json`. Top-level shape:

```json
{
  "format": "depthcalc-project",
  "version": 1,
  "lake": {
    "id": "uuid",
    "name": "My lake",
    "createdAt": "2026-09-23T10:00:00Z",
    "boundary": {
      "type": "Polygon",
      "coordinates": [
        [
          [24, 61],
          [24.01, 61],
          [24.01, 61.01],
          [24, 61.01],
          [24, 61]
        ]
      ]
    }
  },
  "sessions": [],
  "measurements": [],
  "settings": {
    "coverageGrid": 13,
    "coverageRadius": 20,
    "goodCount": 3,
    "gpsAccuracy": 35,
    "radius": 100,
    "interval": 2,
    "smoothColors": true,
    "smoothing": 30
  }
}
```

`lake.boundary` is GeoJSON Polygon or MultiPolygon in `[longitude, latitude]` order with closed rings. The first ring is water exterior; following rings are islands/holes. It is a geometry, not a Feature or FeatureCollection. OSM projects additionally carry `lake.source` with `provider: "openstreetmap"`, `osmType: "way" | "relation"`, positive `osmId`, and `retrievedAt` ISO timestamp.

Sessions contain `id`, `lakeId`, `name`, `startedAt`, and `endedAt` (ISO timestamp or `null`). Measurements contain `id`, `lakeId`, `sessionId`, `timestamp`, `latitude`, `longitude`, `depth`, and `accuracy`. Note the internal JSON name **`accuracy`**, versus **`gps_accuracy`** in CSV.

IDs must be unique, session references must resolve, and all lake IDs must match. Unknown format versions, invalid geometry, invalid values or settings are rejected before changing local storage. Maximum file size is 40 MB. Export/import preserves original sessions and measurements; importing an already-open lake creates a separate local copy and adjusts its lake references. Future format migrations must explicitly increment/support the version.

Generated surfaces are not serialized. Recompute them using the restored settings. This keeps backups independent of renderer internals and avoids stale generated maps.

Contour interval accepts integer values 1–6. Surface smoothing accepts 0–100; smoothColors is a boolean. Version 1 files missing the two new smoothing settings load with ON / 30% defaults. OFF retains the saved percentage but bypasses smoothing.
