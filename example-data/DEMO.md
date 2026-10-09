# Käyrälampi demo

The Studio “Open Demo Lake” button loads `kayralampi.depthcalc.json`, without a live shoreline lookup. Reopening it selects the existing local demo and preserves edits. Map generation is left to the user.

Käyrälampi, Kouvola, Finland: published area 90.2 ha; the bundled OSM boundary measures approximately 88.6 ha. Source: https://www.kouvola.fi/en/free-time-and-hobbies/welcome-to-the-kayralampi-trail/

Shoreline © OpenStreetMap contributors, ODbL, way 4820156, retrieved 2026-10-09: https://www.openstreetmap.org/way/4820156 . Attribution and license: https://www.openstreetmap.org/copyright

All 2,754 depth measurements are **synthetic**, not observations of the real lake bottom. A continuous analytic terrain creates connected basins, a saddle, a shoal and shallow shore areas. Irregular, gently curving boat passes have soundings about 5–15 m apart along the route. Pass spacing varies, and two sparse patches contain fewer passes. Default coverage analysis reports approximately 80.1% well covered and 92.3% with any coverage. Depths range up to 17.8 m and are for demonstration only.

Regenerate the synthetic soundings using the bundled shoreline:

    node --import tsx scripts/generate-demo.ts

The revised demo uses a new project ID; opening it preserves any previously saved demo as a separate project.
