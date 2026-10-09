# Verification

Run from the standalone repository root:

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite serves the production static build, not a mock app. It stubs only map tiles/public shoreline responses for deterministic tests; GPS comes from Chromium's geolocation permission/position emulation. For a preinstalled Chromium, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to its executable path. The default uses Playwright's installed browser.

## Coverage

| Requirement                 | Verification                                                                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPS access when allowed     | Browser context grants permission and supplies fixes; accuracy/location and recording verified                                                     |
| Add/edit/delete             | Capture browser test; Studio depth correction and reload                                                                                           |
| End/export and persistence | Named Capture sessions, automatic CSV on completion, repeat download after reload, no resume; Studio project reload                                                           |
| CSV export/import           | Download Capture CSV, inspect fields, import the exact bytes into Studio                                                                           |
| Multiple sessions           | Import both sample files; retain two sessions in backup/restore                                                                                    |
| Invalid files               | Missing headers, malformed quoting, nonfinite/negative/range errors, calendar dates, invalid JSON versions/geometry/references/settings            |
| Lake selection              | Whole OSM relations, islands, disjoint water parts, incomplete data, exact containment, browser click/confirm/reload and recoverable service error |
| Coverage                    | 13 m base grid, distance/count/GPS thresholds, excluded islands, bounds and estimates                                                              |
| IDW                         | All five radii, hard distance cutoff, three distinct locations, constant-depth surface, unsupported cells and duplicate locations                  |
| Bands/contours              | Solid band colors and identical band/contour endpoints across all radii; label joining, spacing, repetition and short-curve suppression            |
| Portable project            | Deep-equal core round trip plus browser export/import including settings and session grouping                                                      |
| PDF/PNG                     | Browser downloads with valid file signatures; vector PDF generation, full-chart SVG, rendered visual review                                        |
| Local write failure         | Simulated quota failure does not add a point; error is visible; reload confirms absence                                                            |
| Offline processing          | Disconnect browser network after loading Studio; generate chart and download PDF/PNG                                                               |

`npm test` currently reports **9 passing tests** (including the adapted reference regression suites). The default browser suite reports **6 passing workflows**, with the optional live test skipped. `npm run build` performs TypeScript checking and builds both apps plus the landing page. Generated verification files and screenshots go into ignored `test-results/`.

## Live public-service check

```sh
DEPTHCALC_LIVE_OSM=1 npm run test:e2e -- --grep 'live browser'
```

Verified on 2026-09-23: a real browser CORS request selected **Bodominjärvi**, with its complete boundary and four islands, and created the project. The service rejected the default automated HeadlessChrome identification with HTTP 406; the test now identifies itself as DepthCalc. The application itself does not attempt to override the browser's User-Agent. This check is optional in CI because public availability/rate limits are outside the project's control; normal browsers still require a reachable CORS-enabled service.

An isolated copy outside the parent repository also passed a clean dependency install, build and core tests, confirming no parent-package imports are needed.

Visual review covered Capture at 390 px width, desktop Studio, a rendered PDF, and the generated solid bands. Fine antialias seams found in early triangle rendering were removed by drawing compound paths per band. Tests also exposed and led to fixes for empty-project startup and asynchronous dropdown persistence.

## Field testing still required

Browser-emulated GPS verifies application behavior, not a physical receiver. Test your phone's permission prompts, accuracy, battery/wake-lock behavior, HTTPS hosting and fish-finder workflow outdoors before relying on a long survey. Mobile background GPS, fully offline reopening, and multi-tab concurrent editing are not guaranteed.

## October 2026 update

Added regression coverage for filled contours, shoreline extension, mean-preserving surface smoothing, cursor depth sampling and efficient grid drawing. Browser tests cover the new Capture layout, naming, GPS gating, automatic/repeat CSV downloads, empty-session disposal, pagination, Studio slider/toggle persistence and immediate shoreline-loading feedback. Existing offline PDF/PNG export and atomic file validation tests remain enabled. Live Overpass testing remains opt-in.
