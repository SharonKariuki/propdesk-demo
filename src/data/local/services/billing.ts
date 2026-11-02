/**
 * Billing and balances — a TypeScript port of the backend's monthly rent run
 * and rent roll (payments/monthly_ledger.py).
 *
 * Roll-forward, per month:
 *
 *   balance = b/f + rent + VAT + other charges + refunds − payments − waivers − credits
 *
 * and that balance is the next month's b/f. Cash is keyed by the month it was
 * received; deposits are a liability, never rent paid; voided payments never
 * arrived. `currentBalance` is the one balance the whole product reports.
 */
import type { UnitStatus } from "@/lib/types";

import { database, repos } from "../context";
import { settlementOf } from "./deposits";
import type { ChargeRow, TenantRow, UnitRow } from "../schema";
import {
  currentKey, fromMonthKey, keyOfIso, monthKey, monthLabel, round2, VAT_RATE,
} from "../util";

export function unitOf(tenant: TenantRow): UnitRow | undefined {
  return repos().units.get(tenant.unit);
}

export function isCommercial(tenant: TenantRow) {
  return unitOf(tenant)?.classification === "BUSINESS";
}

export function vatOn(tenant: TenantRow, rent: number) {
  return isCommercial(tenant) ? round2(rent * VAT_RATE) : 0;
}

/** Tenancies that occupy their unit today. */
export const isCurrent = (t: TenantRow) => t.status === "active" || t.status === "notice_given";

/** Last month this tenancy can be billed for, or null if never. */
function lastBillableKey(tenant: TenantRow): number {
  const now = currentKey();
  let end = now;
  if (tenant.billing_frequency === "quarterly") {
    const { year, month } = fromMonthKey(now);
    end = monthKey(year, Math.floor((month - 1) / 3) * 3 + 3);
  }
  if (tenant.move_out_date) end = Math.min(end, keyOfIso(tenant.move_out_date));
  return end;
}

/**
 * The rent run. Raises any month a billable tenancy should have been charged
 * for but has not — from move-in (or the start of the books) to this month, or
 * to the end of this quarter for a quarterly letting. Idempotent.
 */
export function ensureBilling(only?: TenantRow) {
  const db = database();
  const { tenants, charges } = repos();
  const booksStart = keyOfIso(db.meta.books_start);
  const list = only ? [only] : tenants.all();
  const existing = new Set(charges.all().map((c) => `${c.tenant}:${monthKey(c.period_year, c.period_month)}`));
  for (const tenant of list) {
    if (!tenant.is_billable || tenant.status === "archived") continue;
    const start = Math.max(keyOfIso(tenant.move_in_date), booksStart);
    const end = lastBillableKey(tenant);
    for (let k = start; k <= end; k++) {
      if (existing.has(`${tenant.id}:${k}`)) continue;
      const { year, month } = fromMonthKey(k);
      charges.insert({
        tenant: tenant.id,
        period_month: month,
        period_year: year,
        expected_rent: tenant.monthly_rent,
        expected_vat: vatOn(tenant, tenant.monthly_rent),
        waived_amount: 0,
        is_opening: false,
      });
      existing.add(`${tenant.id}:${k}`);
    }
  }
}

// ─── Per-tenant sums ─────────────────────────────────────────────────────────
export interface TenantMoney {
  charges: ChargeRow[];
  /** Other charges (water, fees) by month key. */
  other: Map<number, number>;
  /** Cash received by month key (payment date). */
  paid: Map<number, number>;
  /** Effective credits by month key (credit date). */
  credited: Map<number, number>;
  /** Refunds sent by month key (sent date). */
  refunded: Map<number, number>;
}

const add = (map: Map<number, number>, key: number, amount: number) =>
  map.set(key, round2((map.get(key) ?? 0) + amount));

/** A credit counts against the balance once issued, unless voided or held back. */
export const creditCounts = (c: { voided_at: string | null; on_hold: boolean }) => !c.voided_at && !c.on_hold;

export function tenantMoney(tenantId: number, asOf?: string): TenantMoney {
  const r = repos();
  const other = new Map<number, number>();
  for (const u of r.utilityCharges.filter((u) => u.tenant === tenantId)) {
    if (asOf && u.posting_date > asOf) continue;
    add(other, monthKey(u.period_year, u.period_month), u.amount);
  }
  const paid = new Map<number, number>();
  for (const p of r.payments.filter((p) => p.tenant === tenantId && !p.voided_at && p.payment_type !== "deposit")) {
    if (asOf && p.payment_date > asOf) continue;
    add(paid, keyOfIso(p.payment_date), p.amount);
  }
  const credited = new Map<number, number>();
  for (const c of r.credits.filter((c) => c.tenant === tenantId && creditCounts(c))) {
    if (asOf && c.credit_date > asOf) continue;
    add(credited, keyOfIso(c.credit_date), c.amount);
  }
  // Unpaid rent settled out of the deposit counts as a credit on the move-out month.
  const tenant = r.tenants.get(tenantId);
  if (tenant?.status === "moved_out" && tenant.move_out_date && (!asOf || tenant.move_out_date <= asOf)) {
    const applied = settlementOf(tenant).appliedToRent;
    if (applied > 0) add(credited, keyOfIso(tenant.move_out_date), applied);
  }
  const refunded = new Map<number, number>();
  for (const f of r.refunds.filter((f) => f.tenant === tenantId && f.status === "sent" && Boolean(f.sent_on))) {
    if (asOf && f.sent_on! > asOf) continue;
    add(refunded, keyOfIso(f.sent_on!), f.amount);
  }
  return {
    charges: r.charges.filter((c) => c.tenant === tenantId),
    other, paid, credited, refunded,
  };
}

export interface LedgerRow {
  key: number;
  period: string;
  period_month: number;
  period_year: number;
  label: string;
  brought_forward: number;
  rent: number;
  vat: number;
  other_charges: number;
  waived: number;
  credits: number;
  refunds: number;
  total_due: number;
  paid: number;
  balance: number;
  is_opening: boolean;
}

/** The tenant's rent roll, oldest month first (every month, unsliced). */
export function buildLedger(tenantId: number, asOf?: string): LedgerRow[] {
  const money = tenantMoney(tenantId, asOf);
  const byKey = new Map(money.charges.map((c) => [monthKey(c.period_year, c.period_month), c]));
  const keys = [
    ...byKey.keys(), ...money.other.keys(), ...money.paid.keys(),
    ...money.credited.keys(), ...money.refunded.keys(),
  ];
  if (keys.length === 0) return [];
  const start = Math.min(...keys);
  const end = Math.max(Math.max(...keys), currentKey());
  const rows: LedgerRow[] = [];
  let balance = 0;
  for (let k = start; k <= end; k++) {
    const { year, month } = fromMonthKey(k);
    const charge = byKey.get(k);
    let brought = balance;
    let rent = charge?.expected_rent ?? 0;
    const vat = charge?.expected_vat ?? 0;
    const waived = charge?.waived_amount ?? 0;
    const isOpening = Boolean(charge?.is_opening);
    if (isOpening) {
      brought = round2(brought + rent);
      rent = 0;
    }
    const other = money.other.get(k) ?? 0;
    const paid = money.paid.get(k) ?? 0;
    const credits = money.credited.get(k) ?? 0;
    const refunds = money.refunded.get(k) ?? 0;
    const totalDue = round2(brought + rent + vat + other + refunds);
    balance = round2(totalDue - paid - waived - credits);
    rows.push({
      key: k,
      period: `${month}/${year}`,
      period_month: month,
      period_year: year,
      label: monthLabel(year, month),
      brought_forward: brought,
      rent, vat, other_charges: other, waived, credits, refunds,
      total_due: totalDue, paid, balance, is_opening: isOpening,
    });
  }
  return rows;
}

/** Balance as the rent roll closes the current month — the product's one balance. */
export function currentBalance(tenantId: number): number {
  const rows = buildLedger(tenantId);
  if (rows.length === 0) return 0;
  const now = currentKey();
  const row = rows.find((r) => r.key === now) ?? rows.filter((r) => r.key <= now).pop();
  return row ? row.balance : 0;
}

/** Balance at the end of a given month (for month-scoped reports). */
export function balanceAtMonth(tenantId: number, key: number): number {
  const rows = buildLedger(tenantId);
  const row = rows.filter((r) => r.key <= key).pop();
  return row ? row.balance : 0;
}

/** What this month asked of the tenant: rent + VAT + other charges raised for it. */
export function monthDue(tenantId: number, key: number) {
  const row = buildLedger(tenantId).find((r) => r.key === key);
  if (!row) return 0;
  return round2(row.rent + row.vat + row.other_charges - row.waived);
}

export function paidInMonth(tenantId: number, key: number) {
  return round2(
    repos().payments
      .filter((p) => p.tenant === tenantId && !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === key)
      .reduce((s, p) => s + p.amount, 0),
  );
}

/** The current tenancy on a unit (or on the head of the space it belongs to). */
export function occupantOf(unit: UnitRow): TenantRow | undefined {
  const { tenants } = repos();
  const head = unit.combined_into ?? unit.id;
  return tenants.find((t) => t.unit === head && isCurrent(t));
}

/** Colour-coded unit status, from its occupant's balance this month. */
export function unitStatus(unit: UnitRow): UnitStatus {
  const tenant = occupantOf(unit);
  if (!tenant) return "vacant";
  if (!tenant.is_billable) return "occupied_paid";
  const balance = currentBalance(tenant.id);
  if (balance <= 0) return "occupied_paid";
  const now = currentKey();
  if (balance > monthDue(tenant.id, now) + 0.009) return "arrears";
  return paidInMonth(tenant.id, now) > 0 ? "occupied_partial" : "occupied_unpaid";
}

export const UNIT_STATUS_DISPLAY: Record<UnitStatus, string> = {
  vacant: "Vacant",
  occupied_paid: "Paid",
  occupied_partial: "Partial",
  occupied_unpaid: "Unpaid",
  arrears: "Arrears",
};

/** Deposit rule: one month's rent, three for a commercial letting. */
export function depositMonths(tenant: TenantRow) {
  return isCommercial(tenant) ? 3 : 1;
}

export function expectedDeposit(tenant: TenantRow) {
  if (tenant.agreed_deposit !== null) return tenant.agreed_deposit;
  return round2(tenant.monthly_rent * depositMonths(tenant));
}
