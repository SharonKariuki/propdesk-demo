import { expect, test, type Page } from "@playwright/test";

/**
 * End-to-end CRUD against the real local data provider (no route mocking):
 * create, view, edit and delete through the UI, then reload the page and check
 * the change survived and the dashboard moved with it.
 *
 * Runs in the "local" Playwright project, against a build made with
 * VITE_DATA_PROVIDER=local.
 */
test.describe.configure({ mode: "serial" });

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /owner@mawingu\.test/ }).click();
  await page.waitForURL("**/dashboard");
}

const kes = (text: string) => Number(text.replace(/[^\d.]/g, ""));

/** The collected figure, read from the hero card's accessible name:
 *  "Collected KES 1,234 of KES 5,678 in October". */
async function collected(page: Page) {
  const label = await page.getByRole("link", { name: /^Collected KES/ }).getAttribute("aria-label");
  return kes(/Collected KES ([\d,]+)/.exec(label ?? "")?.[1] ?? "");
}

test("building → units → tenant → payment → expense, persisted across reloads", async ({ page }) => {
  await signIn(page);

  // Baseline: what the dashboard says has been collected this month.
  await expect(page.getByRole("link", { name: /^Collected KES/ })).toBeVisible();
  const collectedBefore = await collected(page);

  // ── Create a building with two units (wizard) ──
  await page.goto("/buildings/new");
  await page.getByLabel("Building name *").fill("Test Heights - Demo");
  await page.getByLabel("Number of floors *").fill("1");
  await page.getByLabel("Number of units *").fill("2");
  await page.getByRole("button", { name: /Next: set up units/ }).click();
  const labels = page.getByLabel("Label *");
  await labels.nth(0).fill("TH1A");
  await labels.nth(1).fill("TH1B");
  const rents = page.getByLabel("Rent (KES) *");
  await rents.nth(0).fill("15000");
  await rents.nth(1).fill("16000");
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByRole("button", { name: /Create building/ }).click();
  await expect(page.getByText("Test Heights - Demo created with 2 units")).toBeVisible();

  // ── Register a tenant into TH1A ──
  await page.goto("/tenants?new=1");
  await page.getByLabel("First name *").fill("Test");
  await page.getByLabel("Last name *").fill("Tenant");
  await page.getByLabel("ID number *").fill("99887766");
  await page.getByLabel("Phone *").fill("+254700099001");
  await page.getByLabel("Unit *").selectOption({ label: "Test Heights - Demo — TH1A (KES 15,000)" });
  await page.getByLabel("Monthly rent (KES) *").fill("15000");
  await page.getByRole("button", { name: /Register & move in/ }).click();
  await expect(page.getByText("Tenant registered")).toBeVisible();

  // ── View and edit the tenant ──
  await page.getByPlaceholder(/Search/i).first().fill("Test Tenant");
  await page.getByText("Test Tenant").first().click();
  await page.waitForURL(/\/tenants\/\d+$/);
  const tenantUrl = page.url();
  await expect(page.getByText("Test Heights - Demo · Unit TH1A")).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Phone", { exact: true }).fill("+254700099002");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Updated")).toBeVisible();

  // ── Record a payment for the new tenant ──
  await page.goto("/payments");
  await page.getByRole("button", { name: "Record Payment" }).click();
  await page.getByRole("combobox").first().fill("TH1A");
  await page.getByRole("option").first().click();
  await page.getByLabel("Amount (KES) *").fill("15000");
  await page.getByLabel("Reference").fill("TESTREF001");
  await page.locator("form").getByRole("button", { name: /Record/ }).last().click();
  await expect(page.getByText("Payment recorded")).toBeVisible();

  // The dashboard's collected figure moved by the payment.
  await page.goto("/dashboard");
  await expect(page.getByRole("link", { name: /^Collected KES/ })).toBeVisible();
  await expect.poll(() => collected(page)).toBe(collectedBefore + 15000);

  // ── Record an expense, then delete it ──
  await page.goto("/expenses");
  await page.getByRole("button", { name: "Record Expense" }).click();
  await page.locator("select", { has: page.locator("option", { hasText: "Select category…" }) }).selectOption({ label: "5200 · Repairs & Maintenance" });
  await page.getByLabel("Amount (KES) *").fill("4321");
  await page.getByLabel("Description *").fill("E2E test repair");
  await page.locator("form").getByRole("button", { name: /Save|Record/ }).last().click();
  await expect(page.getByText("E2E test repair").first()).toBeVisible();

  // ── Everything survives a full reload ──
  await page.reload();
  await expect(page.getByText("E2E test repair").first()).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("row", { name: /E2E test repair/ }).getByLabel("Delete expense").click();
  await expect(page.getByText("E2E test repair")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("E2E test repair")).toHaveCount(0);

  await page.goto(tenantUrl);
  await expect(page.getByText("+254700099002").first()).toBeVisible();
  await expect(page.getByText("TESTREF001").first()).toBeVisible();

  // ── A building with no tenancy history can be deleted ──
  await page.goto("/buildings/new");
  await page.getByLabel("Building name *").fill("Delete Me Annex");
  await page.getByLabel("Number of floors *").fill("1");
  await page.getByLabel("Number of units *").fill("1");
  await page.getByRole("button", { name: /Next: set up units/ }).click();
  await page.getByLabel("Label *").first().fill("DMA1");
  await page.getByLabel("Rent (KES) *").first().fill("9000");
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByRole("button", { name: /Create building/ }).click();
  await expect(page.getByText("Delete Me Annex created with 1 unit")).toBeVisible();
  await page.goto("/buildings");
  const card = page.locator("article, div").filter({ hasText: "Delete Me Annex" }).filter({ has: page.getByRole("button", { name: "Delete" }) }).last();
  await card.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: /Delete permanently/ }).click();
  await expect(page.getByText("Delete Me Annex deleted")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Delete Me Annex")).toHaveCount(0);
  await expect(page.getByText("Test Heights - Demo").first()).toBeVisible();
});

test("validation errors come back from the local API", async ({ page }) => {
  await signIn(page);
  await page.goto("/buildings/new");
  // Building names are unique — the API refuses a duplicate.
  await page.getByLabel("Building name *").fill("Mawingu Court - Kilimani");
  await page.getByLabel("Number of floors *").fill("1");
  await page.getByLabel("Number of units *").fill("1");
  await page.getByRole("button", { name: /Next: set up units/ }).click();
  await page.getByLabel("Label *").first().fill("ZZ1A");
  await page.getByLabel("Rent (KES) *").first().fill("9000");
  await page.getByRole("button", { name: /^Review/ }).click();
  await page.getByRole("button", { name: /Create building/ }).click();
  await expect(page.getByText("A building with this name already exists.")).toBeVisible();
});
