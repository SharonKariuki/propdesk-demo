import type { Page } from "@playwright/test";

/**
 * Test doubles for the backend. Every `/api/**` request is intercepted:
 * specific endpoints get realistic fixtures, everything else falls back to an
 * empty list / object so pages render their normal (or empty) state without a
 * server.
 */

const USER = { id: 1, email: "owner@mawingu.test", username: "owner", first_name: "Amani", last_name: "Njoroge", role: "owner" };

const DASHBOARD = {
  kpis: {
    total_units: 67, occupied: 60, vacant: 7,
    total_arrears: 452350, collection_received: 320000, collection_expected: 691100,
    collection_percentage: 46, last_month_received: 300000,
  },
  income_trend: [
    { month: "Feb", amount: 280000 }, { month: "Mar", amount: 300000 },
    { month: "Apr", amount: 320000 },
  ],
  occupancy: { paid: 40, partial: 8, unpaid: 12, arrears: 5, vacant: 7 },
  buildings: [{ id: 1, name: "Mawingu Court - Kilimani", total: 8, occupied: 8, vacant: 0 }],
  recent_payments: [],
  alerts: [],
};

// Two tenants, one with an email address and one without: statements can only
// be sent to the first, and the UI has to say so rather than silently dropping
// the second from a batch.
const TENANTS = [
  {
    id: 1, full_name: "Achieng Otieno", first_name: "Achieng", last_name: "Otieno",
    phone: "+254700000001", email: "achieng.otieno@example.com", unit: 1, unit_label: "KC1A",
    building_name: "Mawingu Court - Kilimani", building_id: 1,
    monthly_rent: "12000.00", deposit_paid: "12000.00", status: "active",
    status_display: "Active", kyc_status: "verified", kyc_status_display: "Verified",
    balance: "0.00", payment_status: "paid", move_in_date: "2026-01-01",
    move_out_date: null, due_day: 5, is_billable: true,
  },
  {
    id: 2, full_name: "Brian Mutua", first_name: "Brian", last_name: "Mutua",
    phone: "+254700000002", email: "", unit: 2, unit_label: "KC1B",
    building_name: "Mawingu Court - Kilimani", building_id: 1,
    monthly_rent: "15000.00", deposit_paid: "15000.00", status: "active",
    status_display: "Active", kyc_status: "pending", kyc_status_display: "Pending Review",
    balance: "15000.00", payment_status: "in_arrears", move_in_date: "2026-02-01",
    move_out_date: null, due_day: 5, is_billable: true,
  },
];

const BUILDING = {
  id: 1, name: "Mawingu Court - Kilimani", property_type_display: "Residential",
  units: [
    { id: 1, label: "KC1A", classification_display: "Residential", monthly_rent: "12000.00", status: "occupied_paid", status_display: "Paid" },
    { id: 2, label: "KC1B", classification_display: "Residential", monthly_rent: "15000.00", status: "occupied_unpaid", status_display: "Unpaid" },
  ],
};

export async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/\/api/, "").replace(/\/$/, "");
    const method = route.request().method();

    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/login" && method === "POST") {
      return json({ access: "test-access", refresh: "test-refresh", user: USER });
    }
    if (path === "/auth/me") return json(USER);
    if (path === "/auth/logout") return json({});
    if (path === "/dashboard/summary") return json(DASHBOARD);
    if (path === "/tenants" && method === "GET") return json(TENANTS);
    if (path === "/tenants" && method === "POST") return json({ id: 3, ...TENANTS[0] }, 201);
    if (path === "/tenants/email-statements" && method === "POST") {
      return json({ sent: 1, failed: 0, total: 1, notifications: [] }, 201);
    }
    if (path.startsWith("/tenants/") && path.endsWith("/payment-history")) {
      return json({ total_paid: "120000.00", total_arrears: "0.00", payments: [], arrears: [] });
    }
    if (path.startsWith("/tenants/")) return json(TENANTS[0]);
    if (path === "/buildings/1") return json(BUILDING);
    if (path === "/buildings") return json(DASHBOARD.buildings.map((b) => ({ ...b, unit_count: b.total, occupied_count: b.occupied })));
    if (path === "/units") return json([]);
    if (path === "/payments" && method === "POST") return json({ id: 1, amount: "12000.00" }, 201);

    // Default: empty list for collection endpoints, empty object otherwise.
    return json(path.endsWith("s") ? [] : {});
  });
}

/** Seed a logged-in session so authenticated pages load directly. */
export async function seedAuth(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("wk_access", "test-access");
    localStorage.setItem("wk_refresh", "test-refresh");
    localStorage.setItem(
      "wk_user",
      JSON.stringify({ id: 1, email: "owner@mawingu.test", username: "owner", first_name: "Amani", last_name: "Njoroge", role: "owner" }),
    );
  });
}

/** True when the page has no horizontal overflow at the current viewport. */
export async function hasNoHorizontalScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.documentElement;
    // Allow a 1px rounding tolerance.
    return el.scrollWidth <= el.clientWidth + 1;
  });
}
