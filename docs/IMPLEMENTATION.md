# Implementation and source reuse

Updated 8 October 2026 from the local private DepthCalc application. This directory remains self-contained: it imports no parent files or Sites backend code.

- Capture: compact marine-inspired mobile layout, named GPS-gated sessions, transactional IndexedDB writes, map/table switching, 15-row pagination, automatic CSV download at completion and repeat download after reload. No resuming ended sessions and no travel tracks.
- Studio: direct public Overpass shoreline lookup with immediate loading overlay, exact lake selection, islands and disconnected water polygons.
- Chart: private edition scalar grid, marching squares filled bands and contour lines, bounded data-supported shoreline triangles, scalar smoothing, efficient batched grid paths and cursor depth sampling.
- Defaults: 100 m IDW radius, 2 m contour interval (1–6 m), smooth colors ON, surface smoothing 30% (0–100%). Existing coverage defaults stay at 13 m, 20 m coverage distance and 3 points for good coverage.
- Exports: PDF and PNG share the smoothed surface, contours and shoreline extension with the map. OFF exports cell colors. The PNG extent uses the complete lake geometry, even when the calculation grid covers only surveyed areas.
- Files: existing version 1 project files without smoothing fields receive true/30 defaults on import. Explicit settings are preserved and validated. Measurements remain original raw records.

The source modules are copied/adapted, not runtime dependencies on the parent app. The application is entirely static; no account, server database or API secrets are required.
