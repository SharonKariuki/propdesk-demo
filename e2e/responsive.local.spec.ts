import { expect, test } from "@playwright/test";

import { hasNoHorizontalScroll } from "./helpers";

/**
 * The no-sideways-scroll sweep again, but on the local provider's seeded data:
 * real record counts, long names and wide tables, rather than two-row fixtures.
 */
const ROUTES = [
  "/dashboard", "/buildings", "/buildings/1", "/units", "/tenants", "/tenants/1",
  "/payments", "/reconciliation", "/expenses", "/income", "/water", "/accounting",
  "/notifications", "/reports", "/activity", "/settings",
];

for (const width of [360, 768, 1366]) {
  test(`seeded data: no page scrolls sideways at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login");
    await page.getByRole("button", { name: /owner@mawingu\.test/ }).click();
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/dashboard");
    await page.setViewportSize({ width, height: 900 });
    for (const path of ROUTES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(300);
      expect(await hasNoHorizontalScroll(page), `${path} overflows the viewport at ${width}px`).toBe(true);
    }
  });
}
