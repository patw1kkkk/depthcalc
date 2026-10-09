import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const fixture = (name: string) => resolve("example-data", name);
const project = JSON.parse(
  readFileSync(fixture("demo.depthcalc.json"), "utf8"),
);
async function silenceTiles(page: Page) {
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
        "base64",
      ),
    }),
  );
}
async function importProject(page: Page, file = "empty-lake.depthcalc.json") {
  await page
    .getByText("Import project", { exact: true })
    .locator("input")
    .setInputFiles(fixture(file));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Example Lake",
  );
}
async function downloadFile(page: Page, name: string) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const d = await waiting;
  expect(await d.failure()).toBeNull();
  const path = await d.path();
  expect(path).toBeTruthy();
  return { name: d.suggestedFilename(), data: readFileSync(path!) };
}

test("Capture named session, table editing, end CSV, redownload and Studio import", async ({
  page,
  context,
}) => {
  await silenceTiles(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 61.1235,
    longitude: 24.1235,
    accuracy: 3,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/apps/capture/");
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByLabel("Session name", { exact: true }).fill("Morning survey");
  await page
    .getByRole("button", { name: "Begin session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Morning survey" }),
  ).toBeVisible();
  for (const depth of ["4.8", "5.2"]) {
    await context.setGeolocation({
      latitude: 61.1235,
      longitude: 24.12355,
      accuracy: 4,
    });
    await page.getByLabel("Fish finder depth").fill(depth);
    await page
      .getByRole("button", { name: "Add measurement", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      `${Number(depth).toFixed(1)} m saved`,
    );
  }
  await page
    .getByRole("button", { name: "Measurements (2)", exact: true })
    .click();
  await expect(page.locator("tbody tr")).toHaveCount(2);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("dialog").getByLabel("Depth (m)").fill("6.2");
  await page.getByRole("button", { name: "Save correction" }).click();
  await page.screenshot({
    path: "test-results/capture-table-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await page.screenshot({
    path: "test-results/capture-mobile.png",
    fullPage: true,
  });
  const csv = await downloadFile(page, "End and export session CSV");
  expect(csv.name).toBe("Morning survey.csv");
  expect(csv.data.toString()).toContain(",6.2,4");
  const repeat = await downloadFile(page, "Download session CSV");
  expect(repeat.data.equals(csv.data)).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Download session CSV" }),
  ).toBeVisible();
  expect(
    (await downloadFile(page, "Download session CSV")).data.equals(csv.data),
  ).toBeTruthy();
  await expect(
    page.getByRole("button", { name: "Resume session" }),
  ).toHaveCount(0);
  await page.goto("/apps/studio/");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await importProject(page);
  await page
    .getByText("Import session CSVs", { exact: true })
    .locator("input")
    .setInputFiles({
      name: "Morning survey.csv",
      mimeType: "text/csv",
      buffer: csv.data,
    });
  await expect(page.getByRole("status")).toContainText(
    "Imported 2 measurements",
  );
  expect(errors).toEqual([]);
});

test("Studio multiple CSVs, validation, coverage, charts, PDF/PNG and project round trip", async ({
  page,
}) => {
  await silenceTiles(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/apps/studio/");
  await importProject(page);
  const input = page
    .getByText("Import session CSVs", { exact: true })
    .locator("input");
  await input.setInputFiles([
    fixture("session-1.csv"),
    fixture("session-2.csv"),
  ]);
  await expect(page.locator(".session-row")).toHaveCount(2);
  await input.setInputFiles({
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("bad,data\n1,2"),
  });
  await expect(page.getByRole("alert")).toContainText("unique headers");
  await expect(page.locator(".session-row")).toHaveCount(2);
  await input.setInputFiles(fixture("session-1.csv"));
  await expect(page.getByRole("status")).toContainText(
    "exact duplicates skipped",
  );
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(page.locator(".big-percent")).not.toHaveText("0.0%");
  await expect(page.locator("aside")).toContainText("13 × 13 m");
  await page.getByLabel("GPS accuracy filter").selectOption("5");
  await expect(page.getByLabel("GPS accuracy filter")).toHaveValue("5");
  await page
    .getByRole("button", { name: "Bathymetric chart", exact: true })
    .click();
  await expect(page.getByLabel("Maximum interpolation radius")).toHaveValue(
    "100",
  );
  for (const radius of ["20", "30", "40", "50", "100"]) {
    await page.getByLabel("Maximum interpolation radius").selectOption(radius);
    await expect(page.getByLabel("Maximum interpolation radius")).toHaveValue(
      radius,
    );
    await page
      .getByRole("button", { name: "Generate bathymetric map" })
      .click();
    await expect(
      page.getByRole("button", { name: "Export PDF", exact: true }),
    ).toBeEnabled();
  }
  await page.getByLabel("Maximum interpolation radius").selectOption("40");
  await page.getByRole("button", { name: "Generate bathymetric map" }).click();
  await expect(
    page.getByRole("button", { name: "Export PDF", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Fit lake" }).click();
  const pdf = await downloadFile(page, "Export PDF");
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.data.length).toBeGreaterThan(10000);
  const png = await downloadFile(page, "Export PNG");
  expect(png.data.subarray(1, 4).toString()).toBe("PNG");
  expect(png.data.length).toBeGreaterThan(10000);
  const backup = await downloadFile(page, "Export project");
  const parsed = JSON.parse(backup.data.toString());
  expect(parsed.sessions.length).toBe(2);
  expect(parsed.settings.gpsAccuracy).toBe(5);
  expect(parsed.measurements.length).toBe(project.measurements.length);
  const raw = await (async () => {
    await page
      .getByRole("button", { name: "Measurements", exact: true })
      .click();
    return downloadFile(page, "Export combined CSV");
  })();
  expect(raw.data.toString()).toMatch(/^session_id,timestamp/);
  await page.getByRole("button", { name: "Edit", exact: true }).first().click();
  await page.getByRole("dialog").getByLabel("Depth (m)").fill("12.3");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(page.locator("tbody tr").first()).toContainText("12.3 m");
  await page.reload();
  await expect(page.locator("tbody tr").first()).toContainText("12.3 m");
  await page
    .getByText("Import project", { exact: true })
    .locator("input")
    .setInputFiles({
      name: "restored.depthcalc.json",
      mimeType: "application/json",
      buffer: backup.data,
    });
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "(imported)",
  );
  await expect(page.locator(".session-row")).toHaveCount(2);
  await expect(page.getByLabel("GPS accuracy filter")).toHaveValue("5");
  await page
    .getByRole("button", { name: "Bathymetric chart", exact: true })
    .click();
  await page.getByRole("button", { name: "Generate bathymetric map" }).click();
  await expect(
    page.getByRole("button", { name: "Export PDF", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Fit lake" }).click();
  await page.screenshot({
    path: "test-results/studio-chart.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("Lake click fetches complete shoreline, confirms project; failures remain recoverable", async ({
  page,
}) => {
  await silenceTiles(page);
  let count = 0;
  await page.route("https://overpass-api.de/api/interpreter", (route) => {
    count++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        elements: [
          {
            type: "way",
            id: 123,
            tags: {
              natural: "water",
              water: "lake",
              name: "Click Test Lake",
            },
            geometry: project.lake.boundary.coordinates[0].map(
              ([lon, lat]: number[]) => ({ lon, lat }),
            ),
          },
        ],
      }),
    });
  });
  await page.goto("/apps/studio/");
  await page.getByRole("button", { name: "Select a lake on the map" }).click();
  const map = page.locator(".map-surface>svg");
  await map.click({ position: { x: 400, y: 300 } }); // Fit precise click using known center next.
  await page.getByLabel("Go to latitude, longitude").fill("61.1235, 24.1235");
  await page.getByRole("button", { name: "Go to coordinates" }).click();
  const box = await map.boundingBox();
  await map.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(page.getByLabel("Project name")).toHaveValue("Click Test Lake");
  await expect(
    page.locator('.map-surface path[fill-rule="evenodd"]').first(),
  ).toHaveAttribute("d", /M/);
  await page
    .getByRole("button", { name: "Confirm lake & create project" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Click Test Lake",
  );
  expect(count).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Click Test Lake",
  );
  await page.unroute("https://overpass-api.de/api/interpreter");
  await page.route("https://overpass-api.de/api/interpreter", (r) =>
    r.fulfill({ status: 429, body: "busy" }),
  );
  await page.getByRole("button", { name: "New lake project" }).click();
  await map.click({ position: { x: 200, y: 250 } });
  await expect(page.getByRole("alert")).toContainText("busy");
  await expect(
    page.getByRole("button", { name: "Confirm lake & create project" }),
  ).toHaveCount(0);
});

test("Denied and stale GPS cannot start a session", async ({ page }) => {
  await silenceTiles(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (_ok: unknown, fail: (e: unknown) => void) => {
          fail({ code: 1 });
          return 1;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.goto("/apps/capture/");
  await expect(page.getByRole("alert")).toContainText("permission denied");
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeDisabled();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        watchPosition: (ok: (p: unknown) => void) => {
          ok({
            timestamp: Date.now() - 20000,
            coords: { latitude: 61.1235, longitude: 24.1235, accuracy: 3 },
          });
          return 2;
        },
        clearWatch: () => {},
      },
    });
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeDisabled();
});

test("Failed local write does not pretend a measurement was saved", async ({
  page,
  context,
}) => {
  await silenceTiles(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 61.1235,
    longitude: 24.1235,
    accuracy: 3,
  });
  await page.goto("/apps/capture/");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Begin session", exact: true })
    .click();
  await expect(page.locator(".metrics")).toContainText("± 3.0 m");
  await expect(page.getByLabel("Fish finder depth")).toBeVisible();
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      if (args[1] === "readwrite")
        throw new DOMException("Test quota exceeded", "QuotaExceededError");
      return original.apply(this, args);
    };
  });
  await page.getByLabel("Fish finder depth").fill("5");
  await page.getByRole("button", { name: "Add measurement" }).click();
  await expect(page.getByRole("alert")).toContainText("Not saved");
  await expect(
    page.getByRole("button", { name: "Measurements (0)", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Measurements (0)", exact: true }),
  ).toBeVisible();
});

test("Loaded Studio analyzes and exports with the network offline", async ({
  page,
  context,
}) => {
  await silenceTiles(page);
  await page.goto("/apps/studio/");
  await page.getByRole("button", { name: "Open Demo Lake", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Käyrälampi",
  );
  await page.getByRole("button", { name: "Open Demo Lake", exact: true }).click();
  await expect(page.getByLabel("Local projects").locator("option")).toHaveCount(1);
  await context.setOffline(true);
  await page.getByRole("button", { name: "Coverage", exact: true }).click();
  await expect(page.locator(".big-percent")).toContainText("92.");
  await page
    .getByRole("button", { name: "Bathymetric chart", exact: true })
    .click();
  await page.getByRole("button", { name: "Generate bathymetric map" }).click();
  await expect(
    page.getByRole("button", { name: "Export PDF", exact: true }),
  ).toBeEnabled();
  const pdf = await downloadFile(page, "Export PDF");
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  const png = await downloadFile(page, "Export PNG");
  expect(png.data.subarray(1, 4).toString()).toBe("PNG");
  await context.setOffline(false);
});

test("Capture pagination and empty session disposal", async ({
  page,
  context,
}) => {
  await silenceTiles(page);
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: 61.1235,
    longitude: 24.1235,
    accuracy: 3,
  });
  await page.goto("/apps/capture/");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByLabel("Session name", { exact: true }).fill("Empty");
  await page.getByRole("button", { name: "Begin session" }).click();
  await page
    .getByRole("button", { name: "End and export session CSV" })
    .click();
  await expect(page.getByRole("status")).toContainText("discarded");
  await expect(
    page.getByRole("button", { name: "Download session CSV" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin session" }).click();
  for (let i = 0; i < 16; i++) {
    await page.getByLabel("Fish finder depth").fill(String(i + 1));
    await page
      .getByRole("button", { name: "Add measurement", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(`${i + 1}.0 m saved`);
  }
  await page.getByRole("button", { name: "Measurements (16)" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(15);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("1.0 m");
});

test("Studio current chart defaults, smoothing dependency and persisted settings", async ({
  page,
}) => {
  await silenceTiles(page);
  await page.goto("/apps/studio/");
  await page.getByRole("button", { name: "Open example survey" }).click();
  await page
    .getByRole("button", { name: "Bathymetric chart", exact: true })
    .click();
  await expect(page.getByLabel("Maximum interpolation radius")).toHaveValue(
    "100",
  );
  const interval = page.getByRole("slider", {
      name: "Contour interval",
      exact: true,
    }),
    smoothing = page.getByRole("slider", {
      name: "Surface smoothing",
      exact: true,
    }),
    toggle = page.getByRole("switch", { name: "Smooth depth colors" });
  await expect(interval).toHaveValue("2");
  await expect(smoothing).toHaveValue("30");
  await expect(toggle).toBeChecked();
  await smoothing.fill("60");
  await expect(smoothing).toHaveValue("60");
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await expect(smoothing).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await expect(smoothing).toHaveValue("60");
  await interval.fill("6");
  await expect(interval).toHaveValue("6");
  await page.getByRole("button", { name: "Generate bathymetric map" }).click();
  await expect(page.locator("[data-depth-band]").first()).toBeVisible();
  const backup = await downloadFile(page, "Export project");
  const p = JSON.parse(backup.data.toString());
  expect(p.settings).toMatchObject({
    radius: 100,
    interval: 6,
    smoothColors: true,
    smoothing: 60,
  });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole("button", { name: "Generate bathymetric map" }).click();
  await expect(page.locator("[data-depth-grid]")).toBeVisible();
  await expect(page.locator("[data-depth-band]")).toHaveCount(0);
  const pdf = await downloadFile(page, "Export PDF");
  expect(pdf.data.subarray(0, 5).toString()).toBe("%PDF-");
  await page.screenshot({
    path: "test-results/studio-settings.png",
    fullPage: true,
  });
});

test("Lake lookup shows immediate on-map loading feedback", async ({
  page,
}) => {
  await silenceTiles(page);
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  await page.route("https://overpass-api.de/api/interpreter", async (r) => {
    await gate;
    await r.fulfill({ status: 429, body: "busy" });
  });
  await page.goto("/apps/studio/");
  await page.getByRole("button", { name: "Select a lake on the map" }).click();
  await page
    .locator(".map-surface>svg")
    .click({ position: { x: 300, y: 250 } });
  await expect(page.locator(".lake-loading")).toContainText(
    "Finding lake shoreline",
  );
  await expect(page.locator(".loading-spinner")).toBeVisible();
  release();
  await expect(page.locator(".lake-loading")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("busy");
});
