import { expect, test, type Page } from "@playwright/test";

/** What each role sees: navigation, guarded routes and action buttons. */
async function signInAs(page: Page, email: string) {
  await page.goto("/login");
  await page.getByRole("button", { name: new RegExp(email.replace(".", "\\.")) }).click();
  await page.waitForURL("**/dashboard");
}

const sidebar = (page: Page) => page.locator("aside");

test("caretaker: operational screens only, no money", async ({ page }) => {
  await signInAs(page, "caretaker@mawingu.test");
  for (const visible of ["Dashboard", "Buildings", "Units", "Tenants", "Water", "Settings"]) {
    await expect(sidebar(page).getByRole("link", { name: visible })).toBeVisible();
  }
  for (const hidden of ["Payments", "Reconciliation", "Expenses", "Income", "Accounting", "Notifications", "Reports", "Activity"]) {
    await expect(sidebar(page).getByRole("link", { name: hidden })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: "Record payment" })).toHaveCount(0);

  // A typed URL lands on the no-access screen, not a page of errors.
  await page.goto("/payments");
  await expect(page.getByText("This page isn't available to you.")).toBeVisible();

  // Tenant page: no edit / move-out / money actions.
  await page.goto("/tenants/1");
  await expect(page.getByText("Unit KC1A")).toBeVisible();
  for (const name of ["Edit", "Move Out", "Add Credit", "Add Charge", "Statement PDF"]) {
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  }
});

test("accountant: records money but cannot reverse it", async ({ page }) => {
  await signInAs(page, "accountant@mawingu.test");
  await expect(sidebar(page).getByRole("link", { name: "Payments" })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Activity" })).toHaveCount(0);
  await page.goto("/payments");
  await expect(page.getByRole("button", { name: "Record Payment" })).toBeVisible();
  await page.goto("/tenants/2");
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Credit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Void/ })).toHaveCount(0);
  await page.goto("/buildings");
  await expect(page.getByRole("button", { name: "Add Building" })).toBeHidden();
});

test("owner: sees the team and can change a role", async ({ page }) => {
  await signInAs(page, "owner@mawingu.test");
  await page.goto("/settings");
  await expect(page.getByText("Roles & permissions")).toBeVisible();
  const select = page.getByLabel("Role for caretaker@mawingu.test");
  await select.selectOption("accountant");
  await expect(page.getByText("caretaker@mawingu.test is now Accountant")).toBeVisible();
  await select.selectOption("caretaker");
  await expect(page.getByText("caretaker@mawingu.test is now Caretaker")).toBeVisible();
});
