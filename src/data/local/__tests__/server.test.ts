/**
 * The local data provider, exercised through `handle()` exactly as the axios
 * adapter calls it: every read endpoint answers, CRUD round-trips, money
 * moves consistently between balances, the dashboard and the books, and
 * changes survive a restart against the same storage.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { dataConfig } from "../../config";
import { permissionsForRole } from "@/lib/permissions";

import { bootDatabase, handle, routesWithoutAccessRule, shutdown } from "../server";
import { MemoryDriver } from "../storage";

const driver = new MemoryDriver();
let token = "";

async function call<T = Record<string, unknown>>(method: string, url: string, body?: unknown, auth = token) {
  const res = await handle({ method, url, body, authorization: auth ? `Bearer ${auth}` : "" });
  return res as { status: number; data: T; headers?: Record<string, string> };
}

async function ok<T = Record<string, unknown>>(method: string, url: string, body?: unknown) {
  const res = await call<T>(method, url, body);
  if (res.status >= 400) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(res.data)}`);
  return res.data;
}

const num = (v: unknown) => Number(v);
const today = new Date();
const month = today.getMonth() + 1;
const year = today.getFullYear();
const iso = `${year}-${String(month).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

beforeAll(async () => {
  dataConfig.localLatencyMs = 0;
  dataConfig.localFailureRate = 0;
  if (!URL.createObjectURL) {
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;
  }
  await bootDatabase(driver);
  const login = await call<{ access: string }>("POST", "/auth/login/", { email: "owner@mawingu.test", password: "demo1234" }, "");
  expect(login.status).toBe(200);
  token = login.data.access;
}, 60_000);

afterAll(() => shutdown());

describe("auth", () => {
  it("rejects requests without a token and bad passwords", async () => {
    expect((await call("GET", "/tenants/", undefined, "")).status).toBe(401);
    const bad = await call("POST", "/auth/login/", { email: "owner@mawingu.test", password: "nope" }, "");
    expect(bad.status).toBe(400);
  });

  it("returns the user with their permissions", async () => {
    const me = await ok("GET", "/auth/me/");
    expect(me).toMatchObject({ email: "owner@mawingu.test", role: "owner", can_forgive_money: true });
  });

  it("keeps a caretaker from recording money", async () => {
    const login = await call<{ access: string }>("POST", "/auth/login/", { email: "caretaker@mawingu.test", password: "demo1234" }, "");
    const res = await call("POST", "/expenses/", {}, login.data.access);
    expect(res.status).toBe(403);
  });
});

describe("role-based access control", () => {
  const as = async (email: string) =>
    (await call<{ access: string }>("POST", "/auth/login/", { email, password: "demo1234" }, "")).data.access;

  it("gives every API route an access rule (so none is open by accident)", () => {
    expect(routesWithoutAccessRule()).toEqual([]);
  });

  it("sends each user their role's permissions", async () => {
    const me = await call<{ permissions: string[]; role_display: string }>("GET", "/auth/me/", undefined, await as("caretaker@mawingu.test"));
    expect(me.data.role_display).toBe("Caretaker");
    expect(me.data.permissions).toEqual(permissionsForRole("caretaker"));
  });

  it.each([
    // [role email, method, url, expected status]
    ["caretaker@mawingu.test", "GET", "/payments/", 403],
    ["caretaker@mawingu.test", "GET", "/reports/arrears/", 403],
    ["caretaker@mawingu.test", "GET", "/reports/accounting/?tab=pnl", 403],
    ["caretaker@mawingu.test", "GET", "/expenses/", 403],
    ["caretaker@mawingu.test", "GET", "/auth/activity/", 403],
    ["caretaker@mawingu.test", "GET", "/tenants/", 200],
    ["caretaker@mawingu.test", "GET", "/utility-charges/previous-reading/?tenant=1", 200],
    ["caretaker@mawingu.test", "POST", "/tenants/", 403],
    ["accountant@mawingu.test", "GET", "/payments/", 200],
    ["accountant@mawingu.test", "GET", "/reports/accounting/?tab=pnl", 200],
    ["accountant@mawingu.test", "POST", "/payments/1/void/", 403],
    ["accountant@mawingu.test", "POST", "/tenant-credits/", 403],
    ["accountant@mawingu.test", "POST", "/buildings/", 403],
    ["accountant@mawingu.test", "GET", "/auth/activity/", 403],
    ["accountant@mawingu.test", "GET", "/auth/users/", 403],
  ])("%s → %s %s answers %i", async (email, method, url, status) => {
    const res = await call(method, url, method === "GET" ? undefined : {}, await as(email));
    expect(res.status).toBe(status);
  });

  it("lets a caretaker do the on-site work", async () => {
    const token = await as("caretaker@mawingu.test");
    const maintenance = await call("POST", "/maintenance/", { unit: 1, description: "Gate hinge loose", cost: "0", reported_date: iso }, token);
    expect(maintenance.status).toBe(201);
  });

  it("records refusals in the activity log", async () => {
    await call("GET", "/payments/", undefined, await as("caretaker@mawingu.test"));
    const log = await ok<{ results: { kind: string; summary: string }[] }>("GET", "/auth/activity/");
    expect(log.results.some((r) => r.kind === "denied" && r.summary.includes("/payments/"))).toBe(true);
  });

  it("lets the owner change a team member's role, but never their own or the last owner's", async () => {
    const users = await ok<{ id: number; role: string; email: string }[]>("GET", "/auth/users/");
    const caretaker = users.find((u) => u.role === "caretaker")!;
    const owner = users.find((u) => u.role === "owner")!;
    const promoted = await ok<{ role: string }>("PATCH", `/auth/users/${caretaker.id}/`, { role: "accountant" });
    expect(promoted.role).toBe("accountant");
    const now = await call("GET", "/payments/", undefined, await as(caretaker.email));
    expect(now.status).toBe(200);
    await ok("PATCH", `/auth/users/${caretaker.id}/`, { role: "caretaker" });
    expect((await call("PATCH", `/auth/users/${owner.id}/`, { role: "caretaker" })).status).toBe(403);
  });
});

describe("every read endpoint answers", () => {
  const reads = [
    "/buildings/", "/buildings/1/", "/units/", "/units/status-summary/", "/tenants/", "/tenants/1/",
    "/tenants/1/payment-history/", "/payments/", "/payments/recent/", "/payments/collection-progress/",
    "/transactions/", "/unmatched-credits/", "/utility-charges/", "/utility-charges/options/",
    "/utility-charges/previous-reading/?tenant=1", "/expenses/", "/expenses/categories/", "/manual-income/",
    "/accounting/accounts/", "/accounting/accounts/?type=income", "/tenant-credits/?tenant=1",
    "/tenant-credits/position/?tenant=1", "/refunds/?tenant=1", "/notifications/", "/notifications/templates/",
    "/notifications/sms-balance/", "/dashboard/summary/", "/auth/login-audit/", "/auth/activity/", "/maintenance/?unit=1",
    `/reports/monthly-collection/?month=${month}&year=${year}`, `/reports/annual-income/?year=${year}`,
    "/reports/arrears/", `/reports/rent-balances/?month=${month}&year=${year}`,
    `/reports/rent-overpayments/?month=${month}&year=${year}`, "/reports/aging-arrears/",
    "/reports/expiring-leases/?days=60", "/reports/tenant-history/1/", "/reports/tenant-statement/1/",
    "/reports/unit-statement/1/", `/reports/landlord-statement/?month=${month}&year=${year}`,
    "/reports/occupancy/", "/reports/vacant-units/", "/reports/move-log/",
    `/reports/profit-loss/?month=${month}&year=${year}&mode=monthly`, `/reports/profit-loss/?year=${year}&mode=annual`,
    `/reports/trial-balance/?month=${month}&year=${year}`, `/reports/expense-breakdown/?month=${month}&year=${year}`,
    ...["balance_sheet", "pnl", "trial_balance", "ledger", "coa", "petty_cash", "budgeting"].map(
      (tab) => `/reports/accounting/?tab=${tab}&start=${year}-01-01&end=${iso}`,
    ),
    `/reports/accounting/?tab=ledger&view=journal&start=${year}-01-01&end=${iso}`,
  ];
  it.each(reads)("GET %s", async (url) => {
    const res = await call("GET", url);
    expect(res.status, JSON.stringify(res.data)).toBe(200);
  });

  it("answers an unknown route with 404", async () => {
    expect((await call("GET", "/nothing-here/")).status).toBe(404);
  });
});

describe("seeded data is realistic and consistent", () => {
  it("has a populated portfolio", async () => {
    const buildings = await ok<unknown[]>("GET", "/buildings/");
    const tenants = await ok<{ status: string }[]>("GET", "/tenants/");
    const units = await ok<unknown[]>("GET", "/units/");
    expect(buildings.length).toBeGreaterThanOrEqual(5);
    expect(units.length).toBeGreaterThan(50);
    expect(tenants.filter((t) => t.status === "active").length).toBeGreaterThan(40);
    expect(tenants.some((t) => t.status === "moved_out")).toBe(true);
  });

  it("keeps the books in balance", async () => {
    const tb = await ok<{ balanced: boolean }>("GET", `/reports/accounting/?tab=trial_balance&start=${year}-01-01&end=${iso}`);
    const bs = await ok<{ balanced: boolean; difference: number }>("GET", `/reports/accounting/?tab=balance_sheet&start=${year}-01-01&end=${iso}`);
    expect(tb.balanced).toBe(true);
    expect(bs.balanced, `difference ${bs.difference}`).toBe(true);
  });

  it("reports the same arrears on the dashboard and in the arrears report", async () => {
    const dash = await ok<{ kpis: { total_arrears: number } }>("GET", "/dashboard/summary/");
    const report = await ok<{ total_balance: number }>("GET", "/reports/arrears/");
    expect(dash.kpis.total_arrears).toBeCloseTo(report.total_balance, 2);
  });
});

describe("CRUD round trips", () => {
  let buildingId = 0;
  let unitId = 0;
  let tenantId = 0;

  it("creates, edits and lists a building with units", async () => {
    const b = await ok<{ id: number }>("POST", "/buildings/", { name: "Vitest Villas", address: "1 Test Rd", total_floors: 1 });
    buildingId = b.id;
    await ok("PATCH", `/buildings/${buildingId}/`, { address: "2 Test Rd" });
    const detail = await ok<{ address: string; units: { id: number; label: string }[] }>(
      "POST", `/buildings/${buildingId}/bulk-create-units/`,
      { units: [{ label: "VV1", floor: 1, unit_type: "1br", monthly_rent: "20000" }, { label: "VV2", floor: 1, unit_type: "shop", classification: "BUSINESS", monthly_rent: "30000" }] },
    );
    expect(detail.address).toBe("2 Test Rd");
    expect(detail.units.map((u) => u.label)).toEqual(["VV1", "VV2"]);
    unitId = detail.units[0].id;
  });

  it("refuses a duplicate unit label with a field error", async () => {
    const res = await call<Record<string, string[]>>("POST", `/buildings/${buildingId}/bulk-create-units/`, { units: [{ label: "VV1", monthly_rent: "1" }] });
    expect(res.status).toBe(400);
    expect(res.data.label[0]).toMatch(/already in use/);
  });

  it("registers a tenant, which lets the unit and bills the month", async () => {
    const t = await ok<{ id: number; balance: string }>("POST", "/tenants/", {
      first_name: "Vita", last_name: "Test", id_number: "11112222", phone: "+254700000999",
      unit: unitId, monthly_rent: "20000", deposit_paid: "20000", deposit_source: "mpesa", move_in_date: `${year}-${String(month).padStart(2, "0")}-01`,
    });
    tenantId = t.id;
    expect(num(t.balance)).toBe(20000);
    const vacant = await ok<{ id: number }[]>("GET", "/units/?status=vacant");
    expect(vacant.some((u) => u.id === unitId)).toBe(false);
    const detail = await ok<{ deposit_paid: string }>("GET", `/tenants/${tenantId}/`);
    expect(num(detail.deposit_paid)).toBe(20000);
  });

  it("records a payment: balance, collections and the dashboard move together", async () => {
    const before = await ok<{ kpis: { collection_received: number } }>("GET", "/dashboard/summary/");
    const payment = await ok<{ id: number; transaction_id: number }>("POST", "/payments/", {
      tenant: tenantId, amount: "15000", payment_date: iso, period_month: month, period_year: year,
      source: "mpesa", payment_type: "rent", reference: "VITEST001",
    });
    const after = await ok<{ kpis: { collection_received: number } }>("GET", "/dashboard/summary/");
    expect(after.kpis.collection_received - before.kpis.collection_received).toBeCloseTo(15000, 2);
    const t = await ok<{ balance: string; payment_status: string }>("GET", `/tenants/${tenantId}/`);
    expect(num(t.balance)).toBe(5000);
    expect(t.payment_status).toBe("in_arrears");
    const receipt = await ok<{ total_amount: string; show_total_only: boolean }>("GET", `/transactions/${payment.transaction_id}/receipt/`);
    expect(receipt).toMatchObject({ total_amount: "15000.00", show_total_only: true });

    // Voiding puts it all back.
    await ok("POST", `/payments/${payment.id}/void/`, { reason: "Test", scope: "single" });
    const voided = await ok<{ balance: string }>("GET", `/tenants/${tenantId}/`);
    expect(num(voided.balance)).toBe(20000);
  });

  it("rejects a payment dated in the future and a duplicate reference", async () => {
    const base = { tenant: tenantId, amount: "100", period_month: month, period_year: year, source: "mpesa", payment_type: "rent" };
    expect((await call("POST", "/payments/", { ...base, payment_date: `${year + 1}-01-01` })).status).toBe(400);
    await ok("POST", "/payments/", { ...base, payment_date: iso, reference: "DUPREF" });
    expect((await call("POST", "/payments/", { ...base, payment_date: iso, reference: "DUPREF" })).status).toBe(400);
  });

  it("captures a water reading that chains from the previous one", async () => {
    const first = await ok<{ amount: string; units: string }>("POST", "/utility-charges/reading/", {
      tenant: tenantId, period_month: month, period_year: year, opening_reading: "100", closing_reading: "110",
    });
    expect(num(first.units)).toBe(10);
    const next = month === 12 ? { m: 1, y: year + 1 } : { m: month + 1, y: year };
    const prev = await ok<{ previous_reading: string }>("GET", `/utility-charges/previous-reading/?tenant=${tenantId}&month=${next.m}&year=${next.y}`);
    expect(num(prev.previous_reading)).toBe(110);
    const backwards = await call("POST", "/utility-charges/reading/", { tenant: tenantId, period_month: next.m, period_year: next.y, closing_reading: "90" });
    expect(backwards.status).toBe(400);
  });

  it("issues a credit and schedules a refund within the credit", async () => {
    const form = new FormData();
    form.append("tenant", String(tenantId));
    form.append("reason", "opening_credit");
    form.append("amount", "50000");
    form.append("credit_date", iso);
    form.append("description", "Test credit");
    const credit = await ok<{ number: string; amount: string }>("POST", "/tenant-credits/", form);
    expect(credit.number).toMatch(/^CR-/);
    const position = await ok<{ balance: string; refundable: string }>("GET", `/tenant-credits/position/?tenant=${tenantId}`);
    expect(num(position.balance)).toBeLessThan(0);
    const tooMuch = await call("POST", "/refunds/", { tenant: tenantId, amount: "999999", method: "mpesa", paid_to: "x", already_sent: false });
    expect(tooMuch.status).toBe(400);
    const refund = await ok<{ status: string }>("POST", "/refunds/", { tenant: tenantId, amount: "1000", method: "mpesa", paid_to: "+254700000999", already_sent: true, sent_on: iso });
    expect(refund.status).toBe("sent");
  });

  it("records and deletes an expense; the P&L follows", async () => {
    const categories = await ok<{ id: number; account_code: string }[]>("GET", "/expenses/categories/");
    const repairs = categories.find((c) => c.account_code === "5200")!;
    const pl = async () => (await ok<{ total_expenses: number }>("GET", `/reports/profit-loss/?month=${month}&year=${year}&mode=monthly`)).total_expenses;
    const before = await pl();
    const e = await ok<{ id: number }>("POST", "/expenses/", {
      date: iso, building: buildingId, unit: null, category: repairs.id, amount: "777", description: "Vitest repair",
      period_month: month, period_year: year,
    });
    expect(await pl()).toBeCloseTo(before + 777, 2);
    await ok("DELETE", `/expenses/${e.id}/`);
    expect(await pl()).toBeCloseTo(before, 2);
  });

  it("sends a simulated message and debits the demo wallet", async () => {
    const before = await ok<{ balance: string }>("GET", "/notifications/sms-balance/");
    const res = await ok<{ sent: number }>("POST", "/notifications/send/", { audience: "tenant", tenant_ids: [tenantId], channel: "sms", body: "Hello {first_name}" });
    expect(res.sent).toBe(1);
    const after = await ok<{ balance: string }>("GET", "/notifications/sms-balance/");
    expect(num(after.balance)).toBeLessThan(num(before.balance));
    const list = await ok<{ body: string; channel_display: string }[]>("GET", "/notifications/");
    expect(list[0].body).toBe("Hello Vita");
    expect(list[0].channel_display).toMatch(/simulated/);
  });

  it("assigns an unmatched bank credit to a tenant", async () => {
    const queue = await ok<{ id: number; amount: string }[]>("GET", "/unmatched-credits/");
    const res = await ok<{ payment_id: number }>("POST", `/unmatched-credits/${queue[0].id}/assign/`, { tenant: tenantId });
    expect(res.payment_id).toBeGreaterThan(0);
    const after = await ok<{ id: number }[]>("GET", "/unmatched-credits/");
    expect(after.some((c) => c.id === queue[0].id)).toBe(false);
    // Voiding it with requeue sends it back.
    await ok("POST", `/payments/${res.payment_id}/void/`, { reason: "Wrong tenant", scope: "single", requeue: true });
    const back = await ok<{ id: number; void_requeue_count: number }[]>("GET", "/unmatched-credits/");
    expect(back.find((c) => c.id === queue[0].id)?.void_requeue_count).toBe(1);
  });

  it("moves the tenant out and frees the unit; the books still balance", async () => {
    await ok("POST", `/tenants/${tenantId}/move-out/`, { move_out_date: iso, deposit_refund_percentage: 50 });
    const vacant = await ok<{ id: number }[]>("GET", "/units/?status=vacant");
    expect(vacant.some((u) => u.id === unitId)).toBe(true);
    const bs = await ok<{ balanced: boolean }>("GET", `/reports/accounting/?tab=balance_sheet&start=${year}-01-01&end=${iso}`);
    expect(bs.balanced).toBe(true);
    const again = await ok<{ id: number; status: string }>("POST", `/tenants/${tenantId}/move-in/`, { unit: unitId, monthly_rent: "21000", move_in_date: iso });
    expect(again.id).not.toBe(tenantId);
    expect(again.status).toBe("active");
  });

  it("will not delete a building with tenancy history, but deletes an empty one", async () => {
    expect((await call("DELETE", `/buildings/${buildingId}/`)).status).toBe(400);
    const empty = await ok<{ id: number }>("POST", "/buildings/", { name: "Vitest Empty" });
    expect((await call("DELETE", `/buildings/${empty.id}/`)).status).toBe(204);
    expect((await call("GET", `/buildings/${empty.id}/`)).status).toBe(404);
  });

  it("exports files in every format", async () => {
    for (const format of ["csv", "xlsx", "pdf"]) {
      const res = await call<Blob>("POST", "/reports/export/", {
        format, title: "Test", filename: "test", columns: [{ key: "c0", label: "A", kind: "text" }, { key: "c1", label: "B", kind: "money" }],
        rows: [{ c0: "x", c1: 1200.5 }],
      });
      expect(res.status).toBe(200);
      expect(res.headers?.["content-disposition"]).toContain(`test.${format}`);
      expect((res.data as Blob).size).toBeGreaterThan(10);
    }
    const pdf = await call<Blob>("GET", "/tenants/1/statement-pdf/");
    expect(pdf.headers?.["content-type"]).toBe("application/pdf");
  });
});

describe("persistence", () => {
  it("keeps every change across a restart on the same storage", async () => {
    await ok("POST", "/buildings/", { name: "Survives Restart" });
    shutdown();
    await bootDatabase(driver);
    const login = await call<{ access: string }>("POST", "/auth/login/", { email: "owner@mawingu.test", password: "demo1234" }, "");
    token = login.data.access;
    const buildings = await ok<{ name: string }[]>("GET", "/buildings/");
    expect(buildings.some((b) => b.name === "Survives Restart")).toBe(true);
    expect(buildings.some((b) => b.name === "Vitest Villas")).toBe(true);
  });

  it("restores the seed on reset", async () => {
    await ok("POST", "/demo/reset/");
    const buildings = await ok<{ name: string }[]>("GET", "/buildings/");
    expect(buildings.some((b) => b.name === "Vitest Villas")).toBe(false);
  });
});
