import { expect, test } from "@playwright/test";

import { hasNoHorizontalScroll } from "./helpers";

/**
 * The no-sideways-scroll sweep again, but on the local provider's seeded data:
 * real record counts, long names and wide tables, rather than two-row fixtures.
 */
const ROUTES = [
  "/dashboard", "/buildings", "/buildings/1", "/units", "/tenants", "/tenants/1",
  "/payments", "/reconciliation", "/expenses", "/income", "/water", "/accounting",
  "/notifications", "/reports", "/activity", "/settings", "/deposits", "/short-stay", "/tax",
];

for (const width of [360, 768, 1366]) {
  test(`seeded data: no page scrolls sideways at ${width}px`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/login");
    await page.getByRole("button", { name: /owner@mawingu\.test/ }).click();
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

/** The sign-in page fits every common screen: nothing scrolls sideways and the
 *  heading is never pushed above the top edge (it used to be on short laptops). */
for (const [w, h] of [[320, 568], [390, 844], [844, 390], [768, 1024], [1366, 768], [1862, 873], [2560, 1440]]) {
  test(`login fits a ${w}×${h} screen`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    const top = await page.getByRole("heading", { name: "Sign in" }).evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(await hasNoHorizontalScroll(page)).toBe(true);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeInViewport({ ratio: 1 }).catch(async () => {
      // On very short screens the button may sit below the fold — it must still be reachable by scrolling.
      await page.getByRole("button", { name: "Sign in" }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("button", { name: "Sign in" })).toBeInViewport();
    });
  });
}
