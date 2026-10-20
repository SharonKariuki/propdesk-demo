/** Other charges (Add Charge), water meter readings, expenses and manual income. */
import { repos } from "../context";
import { badRequest, created, fieldError, HttpError, noContent, notFound, type Router } from "../http";
import type { ChargeType } from "../schema";
import { logEvent } from "../services/audit";
import { unitOf } from "../services/billing";
import {
  CHARGE_TYPE_DISPLAY, fullName, serializeExpense, serializeManualIncome, serializeUtilityCharge,
} from "../services/serializers";
import {
  bodyObject, bool, dateField, decStr, idParam, intField, money, monthKey, monthLabel, nowIso,
  requiredStr, round2, str, todayIso,
} from "../util";
import { getTenant } from "./tenants";

const CHARGE_ACCOUNTS: Record<ChargeType, string> = {
  utility: "4150 Service Charge / Utilities Reimbursed by Tenants",
  late_fee: "4200 Late Payment Fees / Penalties",
  parking: "4250 Parking Fees",
  damage: "",
};

function categoryOptions() {
  return repos().expenseCategories.all().map((c) => {
    const account = repos().accounts.find((a) => a.code === c.account_code);
    return { id: c.id, name: c.name, account: account ? `${account.code} ${account.name}` : c.account_code };
  });
}

/** The latest reading on this unit's meter before the given period. */
function previousReading(unitId: number, month: number, year: number) {
  const target = monthKey(year, month);
  const readings = repos().utilityCharges
    .filter((u) => u.unit === unitId && u.charge_type === "utility" && u.closing_reading !== null
      && monthKey(u.period_year, u.period_month) < target)
    .sort((a, b) => monthKey(b.period_year, b.period_month) - monthKey(a.period_year, a.period_month));
  return readings[0]?.closing_reading ?? null;
}

export function registerCharges(router: Router) {
  router.get("/utility-charges/", (req) => {
    const tenant = req.query.get("tenant");
    return repos().utilityCharges
      .filter((u) => !tenant || u.tenant === Number(tenant))
      .sort((a, b) => monthKey(b.period_year, b.period_month) - monthKey(a.period_year, a.period_month) || b.id - a.id)
      .map(serializeUtilityCharge);
  });

  router.get("/utility-charges/options/", () => ({
    charge_types: (Object.keys(CHARGE_TYPE_DISPLAY) as ChargeType[]).map((value) => ({
      value, label: CHARGE_TYPE_DISPLAY[value], account: CHARGE_ACCOUNTS[value],
    })),
    expense_categories: categoryOptions(),
  }));

  router.post("/utility-charges/", (req) => {
    const body = bodyObject(req.body);
    const tenant = getTenant(intField(body.tenant, "tenant", { min: 1 }));
    const type = requiredStr(body.charge_type, "charge_type") as ChargeType;
    if (!(type in CHARGE_TYPE_DISPLAY)) throw fieldError("charge_type", `"${type}" is not a valid choice.`);
    let category: number | null = null;
    if (type === "damage") {
      category = intField(body.expense_category, "expense_category", { min: 1 });
      if (!repos().expenseCategories.get(category)) throw fieldError("expense_category", "Choose the cost being recharged.");
    }
    const amount = money(body.amount, "amount", { allowZero: false });
    const row = repos().utilityCharges.insert({
      tenant: tenant.id,
      unit: tenant.unit,
      posting_date: dateField(body.posting_date || todayIso(), "posting_date")!,
      period_month: intField(body.period_month, "period_month", { min: 1, max: 12 }),
      period_year: intField(body.period_year, "period_year", { min: 2000, max: 2100 }),
      label: requiredStr(body.label, "label"),
      opening_reading: null, closing_reading: null, units: null,
      amount,
      notes: str(body.notes),
      charge_type: type,
      expense_category: category,
    });
    logEvent(req, { action: "charge_add", summary: `Charged ${fullName(tenant)} KES ${amount.toLocaleString()} — ${row.label}`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant), financial: true });
    return created(serializeUtilityCharge(row));
  });

  router.get("/utility-charges/previous-reading/", (req) => {
    const tenant = getTenant(Number(req.query.get("tenant")));
    const now = new Date();
    const month = Number(req.query.get("month") || now.getMonth() + 1);
    const year = Number(req.query.get("year") || now.getFullYear());
    const building = repos().buildings.get(unitOf(tenant)?.building ?? 0);
    const prev = previousReading(tenant.unit, month, year);
    return {
      tenant: tenant.id,
      previous_reading: prev === null ? null : decStr(prev),
      water_rate_per_unit: decStr(building?.water_rate ?? 150),
    };
  });

  router.post("/utility-charges/reading/", (req) => {
    const body = bodyObject(req.body);
    const tenant = getTenant(intField(body.tenant, "tenant", { min: 1 }));
    const month = intField(body.period_month, "period_month", { min: 1, max: 12 });
    const year = intField(body.period_year, "period_year", { min: 2000, max: 2100 });
    if (repos().utilityCharges.find((u) => u.unit === tenant.unit && u.charge_type === "utility" && u.period_month === month && u.period_year === year)) {
      throw badRequest(`A reading for ${monthLabel(year, month)} is already recorded on this unit.`);
    }
    const closing = money(body.closing_reading, "closing_reading");
    const given = str(body.opening_reading);
    const opening = given ? money(given, "opening_reading") : previousReading(tenant.unit, month, year) ?? 0;
    const replaced = bool(body.meter_replaced);
    if (closing < opening && !replaced) {
      throw fieldError("closing_reading", `The current reading (${closing}) is below the previous one (${opening}). Tick "meter replaced" if the meter was changed.`);
    }
    const units = round2(replaced && closing < opening ? closing : closing - opening);
    const rate = repos().buildings.get(unitOf(tenant)?.building ?? 0)?.water_rate ?? 150;
    const row = repos().utilityCharges.insert({
      tenant: tenant.id, unit: tenant.unit, posting_date: todayIso(), period_month: month, period_year: year,
      label: `Water — ${monthLabel(year, month)} (${units} units)`,
      opening_reading: replaced && closing < opening ? 0 : opening, closing_reading: closing, units,
      amount: round2(units * rate), notes: replaced ? "Meter replaced" : "", charge_type: "utility", expense_category: null,
    });
    logEvent(req, { action: "water_reading", summary: `Water reading for ${fullName(tenant)}: ${units} units`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant), financial: true });
    return created(serializeUtilityCharge(row));
  });

  // ── expenses ──
  router.get("/expenses/categories/", () =>
    repos().expenseCategories.all().map((c) => {
      const account = repos().accounts.find((a) => a.code === c.account_code);
      return {
        id: c.id, name: c.name, description: c.description, account_code: c.account_code,
        account_name: account?.name ?? null, created_at: c.created_at,
      };
    }));

  router.post("/expenses/categories/", () => {
    throw new HttpError(405, { detail: "Expense categories are locked to the chart of accounts." });
  });

  router.get("/expenses/", (req) => {
    const q = req.query;
    const month = Number(q.get("month") || 0);
    const year = Number(q.get("year") || 0);
    const building = q.get("building");
    const unit = q.get("unit");
    return repos().expenses
      .filter((e) => (!month || e.period_month === month) && (!year || e.period_year === year))
      .filter((e) => !building || (building === "none" ? e.building === null : e.building === Number(building)))
      .filter((e) => !unit || (unit === "none" ? e.unit === null : e.unit === Number(unit)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map(serializeExpense);
  });

  router.post("/expenses/", (req) => {
    const body = bodyObject(req.body);
    const category = intField(body.category, "category", { min: 1 });
    if (!repos().expenseCategories.get(category)) throw fieldError("category", "Choose a category.");
    const building = str(body.building) ? intField(body.building, "building") : null;
    if (building !== null && !repos().buildings.get(building)) throw fieldError("building", "Unknown property.");
    const unit = str(body.unit) ? intField(body.unit, "unit") : null;
    if (unit !== null && repos().units.get(unit)?.building !== building) throw fieldError("unit", "That unit is not in the chosen property.");
    const amount = money(body.amount, "amount", { allowZero: false });
    const now = nowIso();
    const row = repos().expenses.insert({
      date: dateField(body.date, "date")!,
      building, unit, category, amount,
      description: requiredStr(body.description, "description"),
      reference: str(body.reference),
      period_month: intField(body.period_month, "period_month", { min: 1, max: 12 }),
      period_year: intField(body.period_year, "period_year", { min: 2000, max: 2100 }),
      notes: str(body.notes),
      petty_cash: bool(body.petty_cash),
      created_at: now, updated_at: now,
    });
    logEvent(req, { action: "expense_create", summary: `Recorded expense KES ${amount.toLocaleString()} — ${row.description}`, objectType: "expense", objectId: row.id, objectLabel: row.description, financial: true });
    return created(serializeExpense(row));
  });

  router.delete("/expenses/:id/", (req) => {
    const row = repos().expenses.get(idParam(req.params.id));
    if (!row) throw notFound();
    for (const m of repos().maintenance.filter((m) => m.expense === row.id)) repos().maintenance.update(m.id, { expense: null });
    repos().expenses.remove(row.id);
    logEvent(req, { action: "expense_delete", summary: `Deleted expense KES ${row.amount.toLocaleString()} — ${row.description}`, objectType: "expense", objectId: row.id, objectLabel: row.description, financial: true });
    return noContent();
  });

  // ── manual income ──
  router.get("/manual-income/", (req) => {
    const q = req.query;
    const month = Number(q.get("month") || 0);
    const year = Number(q.get("year") || 0);
    const building = Number(q.get("building") || 0);
    return repos().manualIncome
      .filter((m) => (!month || m.period_month === month) && (!year || m.period_year === year))
      .filter((m) => !building || m.building === building)
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map(serializeManualIncome);
  });

  router.post("/manual-income/", (req) => {
    const body = bodyObject(req.body);
    const building = repos().buildings.get(intField(body.building, "building", { min: 1 }));
    if (!building) throw fieldError("building", "Choose a property.");
    if (building.property_type === "expense_only") throw fieldError("building", `${building.name} is an expenses-only property; it takes no income.`);
    const account = repos().accounts.get(intField(body.account, "account", { min: 1 }));
    if (!account || account.account_type !== "income" || account.is_header) throw fieldError("account", "Choose an income account.");
    const amount = money(body.amount, "amount", { allowZero: false });
    const row = repos().manualIncome.insert({
      date: dateField(body.date, "date")!,
      building: building.id, account: account.id, amount,
      description: requiredStr(body.description, "description"),
      reference: str(body.reference),
      period_month: intField(body.period_month, "period_month", { min: 1, max: 12 }),
      period_year: intField(body.period_year, "period_year", { min: 2000, max: 2100 }),
      notes: str(body.notes),
      created_at: nowIso(),
    });
    logEvent(req, { action: "income_create", summary: `Recorded income KES ${amount.toLocaleString()} — ${row.description}`, objectType: "manual_income", objectId: row.id, objectLabel: row.description, financial: true });
    return created(serializeManualIncome(row));
  });

  router.delete("/manual-income/:id/", (req) => {
    const row = repos().manualIncome.get(idParam(req.params.id));
    if (!row) throw notFound();
    repos().manualIncome.remove(row.id);
    logEvent(req, { action: "income_delete", summary: `Deleted income KES ${row.amount.toLocaleString()} — ${row.description}`, objectType: "manual_income", objectId: row.id, objectLabel: row.description, financial: true });
    return noContent();
  });

  router.get("/accounting/accounts/", (req) => {
    const type = req.query.get("type");
    return [...repos().accounts.all()]
      .filter((a) => !type || (a.account_type === type && !a.is_header))
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((a) => ({ id: a.id, code: a.code, name: a.name, account_type: a.account_type, is_header: a.is_header }));
  });
}
