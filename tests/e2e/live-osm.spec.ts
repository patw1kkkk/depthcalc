import { test, expect } from "@playwright/test";
// Identify the automated integration test to the public service.
test.use({
  userAgent: "DepthCalc/0.1 (local-first open-source lake survey tool)",
});
test("live browser CORS lookup selects Bodominjärvi from public OSM", async ({
  page,
}) => {
  test.skip(
    process.env.DEPTHCALC_LIVE_OSM !== "1",
    "Optional live network check; deterministic lake tests always run.",
  );
  await page.goto("/apps/studio/");
  await page.getByRole("button", { name: "Select a lake on the map" }).click();
  await page.getByLabel("Go to latitude, longitude").fill("60.257, 24.66");
  await page.getByRole("button", { name: "Go to coordinates" }).click();
  const map = page.locator(".map-surface>svg"),
    box = await map.boundingBox();
  await map.click({ position: { x: box!.width / 2, y: box!.height / 2 } });
  await expect(page.getByLabel("Project name")).toHaveValue(/Bodom/i, {
    timeout: 45000,
  });
  await page
    .getByRole("button", { name: "Confirm lake & create project" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Bodom/i);
  await page.screenshot({ path: "test-results/live-lake.png" });
});
