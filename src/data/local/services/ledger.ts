/**
 * The general ledger, derived. Every journal entry is built from the records
 * that cause it — a port of the backend's ledger/posting.py rules — so the
 * books can never drift from the payments, charges and expenses behind them.
 *
 *   rent billed       DR 1040 Receivable        CR 4110/4120 Rent, 2600 VAT
 *   water / fees      DR 1040                   CR 4150 / 4200 / 4250 (damage: CR expense)
 *   payment received  DR 1020 Bank              CR 1040
 *   deposit received  DR 1030 Deposit bank      CR 2100 Deposits held
 *   expense paid      DR 5xxx/6xxx              CR 1020 (or 1010 petty cash)
 *   manual income     DR 1020                   CR 4xxx
 *   tenant credit     DR income (+2600 VAT)     CR 1040
 *   refund sent       DR 1040                   CR 1020
 *   deposit refunded  DR 2100                   CR 1030
 *
 * A voided payment or credit keeps its entry and gains a mirrored reversal on
 * the day it was voided, exactly as the real ledger records it.
 */
import { database, repos } from "../context";
import type { AccountRow } from "../schema";
import { fromMonthKey, isoDate, keyOfIso, monthKey, round2, todayIso } from "../util";
import { fullName } from "./serializers";

export interface JournalLine {
  code: string;
  debit: number;
  credit: number;
  description: string;
}

export interface JournalEntry {
  id: number;
  date: string;
  reference: string;
  memo: string;
  /** Machine key, matching the Accounting page's Source filter. */
  source: string;
  kind: "normal" | "reversal";
  building: number | null;
  lines: JournalLine[];
}

export const SOURCE_LABELS: Record<string, string> = {
  payment: "Payment",
  expense: "Expense",
  utility_charge: "Water / utility charge",
  manual_income: "Manual income",
  tenant_credit: "Tenant credit",
  credit_application: "Credit applied",
  tenant_refund: "Refund",
  opening_ar: "Opening balance",
  opening_deposit: "Opening deposit",
  opening_capital: "Opening capital",
  rent_charge: "Rent billed",
  deposit_refund: "Deposit refund",
  petty_cash_topup: "Petty cash top-up",
};

const dr = (code: string, amount: number, description: string): JournalLine => ({ code, debit: round2(amount), credit: 0, description });
const cr = (code: string, amount: number, description: string): JournalLine => ({ code, debit: 0, credit: round2(amount), description });
const mirror = (lines: JournalLine[]) =>
  lines.map((l) => ({ code: l.code, debit: l.credit, credit: l.debit, description: `REVERSAL — ${l.description}` }));

const CHARGE_ACCOUNTS = { utility: "4150", late_fee: "4200", parking: "4250" } as const;

/** Every journal entry in the books, oldest first. */
export function buildJournal(): JournalEntry[] {
  const r = repos();
  const meta = database().meta;
  const raw: Omit<JournalEntry, "id">[] = [];
  const push = (e: Omit<JournalEntry, "id">) => {
    if (e.lines.some((l) => l.debit || l.credit)) raw.push(e);
  };
  const tenantBuilding = (tenantId: number) => {
    const t = r.tenants.get(tenantId);
    const u = t ? r.units.get(t.unit) : undefined;
    return u?.building ?? null;
  };
  const tenantLabel = (tenantId: number) => {
    const t = r.tenants.get(tenantId);
    return t ? fullName(t) : `Tenant #${tenantId}`;
  };
  const rentCode = (tenantId: number) => {
    const t = r.tenants.get(tenantId);
    const u = t ? r.units.get(t.unit) : undefined;
    return u?.classification === "BUSINESS" ? "4120" : "4110";
  };
  const categoryCode = (id: number | null) => (id ? r.expenseCategories.get(id)?.account_code ?? "5200" : "5200");

  // Opening capital: the owner's bank balance, land and buildings brought in.
  const start = meta.books_start;
  if (start) {
    push({
      date: start, reference: "OPEN-CAP", memo: "Opening capital introduced", source: "opening_capital",
      kind: "normal", building: null,
      lines: [
        dr("1020", meta.opening.bank, "Operating bank — opening balance"),
        dr("1010", meta.opening.petty_cash_float, "Petty cash float"),
        dr("1060", meta.opening.land, "Investment property / land"),
        dr("1350", meta.opening.buildings, "Buildings & improvements"),
        cr("3100", meta.opening.bank + meta.opening.petty_cash_float + meta.opening.land + meta.opening.buildings, "Owner's capital"),
      ],
    });
    // Petty cash topped up from the bank on the first of every month.
    const startKey = keyOfIso(start);
    const nowKey = keyOfIso(todayIso());
    for (let k = startKey + 1; k <= nowKey; k++) {
      const { year, month } = fromMonthKey(k);
      push({
        date: isoDate(year, month, 1), reference: `PC-TOPUP-${year}${String(month).padStart(2, "0")}`,
        memo: "Petty cash top-up", source: "petty_cash_topup", kind: "normal", building: null,
        lines: [dr("1010", 15000, "Petty cash top-up"), cr("1020", 15000, "Transfer from operating bank")],
      });
    }
  }

  // Deposits held from before the books began.
  for (const t of r.tenants.all()) {
    const booked = r.payments
      .filter((p) => p.tenant === t.id && p.payment_type === "deposit" && !p.voided_at)
      .reduce((s, p) => s + p.amount, 0);
    const opening = round2(t.deposit_paid - booked);
    if (opening > 0 && start) {
      const date = t.move_in_date > start ? t.move_in_date : start;
      push({
        date, reference: `OPEN-DEP-${t.id}`, memo: `Deposit held — ${tenantLabel(t.id)}`, source: "opening_deposit",
        kind: "normal", building: tenantBuilding(t.id),
        lines: [dr("1030", opening, "Deposit bank (opening balance)"), cr("2100", opening, `Deposit held — ${tenantLabel(t.id)}`)],
      });
    }
    if (t.status === "moved_out" && t.deposit_refund_amount > 0 && t.move_out_date) {
      push({
        date: t.move_out_date, reference: `DEP-REF-${t.id}`, memo: `Deposit refunded — ${tenantLabel(t.id)}`,
        source: "deposit_refund", kind: "normal", building: tenantBuilding(t.id),
        lines: [dr("2100", t.deposit_refund_amount, `Deposit refunded — ${tenantLabel(t.id)}`), cr("1030", t.deposit_refund_amount, "Tenant Security Deposit Bank")],
      });
    }
  }

  // Rent billed (accrual).
  for (const c of r.charges.all()) {
    const name = tenantLabel(c.tenant);
    const date = isoDate(c.period_year, c.period_month, 1);
    if (c.is_opening) {
      push({
        date, reference: `OPEN-AR-${c.tenant}`, memo: `Opening balance — ${name}`, source: "opening_ar",
        kind: "normal", building: tenantBuilding(c.tenant),
        lines: c.expected_rent >= 0
          ? [dr("1040", c.expected_rent, `Arrears brought forward — ${name}`), cr("3300", c.expected_rent, "Retained earnings (opening)")]
          : [dr("3300", -c.expected_rent, "Retained earnings (opening)"), cr("1040", -c.expected_rent, `Credit brought forward — ${name}`)],
      });
      continue;
    }
    const net = round2(c.expected_rent - c.waived_amount);
    push({
      date, reference: `RENT-${c.period_year}${String(c.period_month).padStart(2, "0")}-${c.tenant}`,
      memo: `Rent ${c.period_month}/${c.period_year} — ${name}`, source: "rent_charge", kind: "normal",
      building: tenantBuilding(c.tenant),
      lines: [
        dr("1040", net + c.expected_vat, `Rent receivable — ${name}`),
        cr(rentCode(c.tenant), net, `Rent ${c.period_month}/${c.period_year}`),
        cr("2600", c.expected_vat, "VAT on commercial rent"),
      ],
    });
  }

  // Water, late fees, parking, damage recharges.
  for (const u of r.utilityCharges.all()) {
    const name = tenantLabel(u.tenant);
    const income = u.charge_type === "damage" ? categoryCode(u.expense_category) : CHARGE_ACCOUNTS[u.charge_type];
    push({
      date: u.posting_date, reference: `CHG-${u.id}`, memo: `${u.label} — ${name}`, source: "utility_charge",
      kind: "normal", building: tenantBuilding(u.tenant),
      lines: [dr("1040", u.amount, `Charged to ${name}`), cr(income, u.amount, u.label)],
    });
  }

  // Cash received.
  for (const p of r.payments.all()) {
    const name = tenantLabel(p.tenant);
    const lines = p.payment_type === "deposit"
      ? [dr("1030", p.amount, `Deposit received — ${name}`), cr("2100", p.amount, "Tenant Security Deposits Held")]
      : [dr("1020", p.amount, `Received from ${name}`), cr("1040", p.amount, `Rent receivable — ${name}`)];
    const base = { reference: p.reference, source: "payment", building: tenantBuilding(p.tenant) };
    push({ ...base, date: p.payment_date, memo: `Payment — ${name}`, kind: "normal", lines });
    if (p.voided_at) {
      push({ ...base, date: p.voided_at.slice(0, 10), memo: `Payment voided — ${name}`, kind: "reversal", lines: mirror(lines) });
    }
  }

  // Expenses.
  for (const e of r.expenses.all()) {
    const category = r.expenseCategories.get(e.category);
    push({
      date: e.date, reference: e.reference, memo: e.description, source: "expense", kind: "normal", building: e.building,
      lines: [
        dr(category?.account_code ?? "5200", e.amount, category?.name ?? "Expense"),
        cr(e.petty_cash ? "1010" : "1020", e.amount, e.petty_cash ? "Paid from petty cash" : "Paid from operating bank"),
      ],
    });
  }

  // Manual income (farm produce, parking…).
  for (const m of r.manualIncome.all()) {
    const account = r.accounts.get(m.account);
    push({
      date: m.date, reference: m.reference, memo: m.description, source: "manual_income", kind: "normal", building: m.building,
      lines: [dr("1020", m.amount, `Income received — ${m.description}`), cr(account?.code ?? "4300", m.amount, account?.name ?? "Income")],
    });
  }

  // Tenant credits.
  for (const c of r.credits.all()) {
    // A held credit has not been released against the balance, so nothing posts.
    if (c.on_hold) continue;
    const name = tenantLabel(c.tenant);
    let debits: JournalLine[];
    if (c.reason === "opening_credit") debits = [dr("3300", c.amount, "Opening credit")];
    else if (c.reason === "tenant_paid_cost") debits = [dr(categoryCode(c.expense_category), c.amount, "Cost paid by tenant")];
    else if (c.utility_charge) {
      const u = r.utilityCharges.get(c.utility_charge);
      const code = u ? (u.charge_type === "damage" ? categoryCode(u.expense_category) : CHARGE_ACCOUNTS[u.charge_type]) : "4150";
      debits = [dr(code, c.amount, c.description)];
    } else {
      debits = [dr(rentCode(c.tenant), c.net_amount, c.description), dr("2600", c.vat_amount, "VAT credited")];
    }
    const lines = [...debits, cr("1040", c.amount, `Credit to ${name}`)];
    const base = { reference: c.number, source: "tenant_credit", building: tenantBuilding(c.tenant) };
    push({ ...base, date: c.credit_date, memo: `${c.number} — ${name}`, kind: "normal", lines });
    if (c.voided_at) {
      push({ ...base, date: c.voided_at.slice(0, 10), memo: `${c.number} voided — ${name}`, kind: "reversal", lines: mirror(lines) });
    }
  }

  // Refunds paid out.
  for (const f of r.refunds.filter((f) => f.status === "sent" && Boolean(f.sent_on))) {
    const name = tenantLabel(f.tenant);
    push({
      date: f.sent_on!, reference: f.number, memo: `Refund — ${name}`, source: "tenant_refund", kind: "normal",
      building: tenantBuilding(f.tenant),
      lines: [dr("1040", f.amount, `Refund to ${name}`), cr("1020", f.amount, "Paid from operating bank")],
    });
  }

  raw.sort((a, b) => a.date.localeCompare(b.date) || a.source.localeCompare(b.source));
  return raw.map((e, i) => ({ ...e, id: i + 1, lines: e.lines.filter((l) => l.debit || l.credit) }));
}

// ─── Account helpers ─────────────────────────────────────────────────────────
export function chart(): AccountRow[] {
  return [...repos().accounts.all()].sort((a, b) => a.code.localeCompare(b.code));
}

export const isDebitNormal = (type: AccountRow["account_type"]) => type === "asset" || type === "expense";

/** Signed balance on the account's normal side. */
export function signed(type: AccountRow["account_type"], debit: number, credit: number) {
  return round2(isDebitNormal(type) ? debit - credit : credit - debit);
}

export interface Totals {
  debit: number;
  credit: number;
}

export function totalsByAccount(entries: JournalEntry[]): Map<string, Totals> {
  const out = new Map<string, Totals>();
  for (const e of entries) {
    for (const l of e.lines) {
      const t = out.get(l.code) ?? { debit: 0, credit: 0 };
      t.debit = round2(t.debit + l.debit);
      t.credit = round2(t.credit + l.credit);
      out.set(l.code, t);
    }
  }
  return out;
}

export interface Scope {
  start?: string;
  end?: string;
  building?: number | null;
}

export function inScope(e: JournalEntry, { start, end, building }: Scope) {
  if (start && e.date < start) return false;
  if (end && e.date > end) return false;
  if (building && e.building !== building) return false;
  return true;
}

/** Income and expense totals for a period, per account — what the P&L reads. */
export function profitAndLoss(scope: Scope) {
  const entries = buildJournal().filter((e) => inScope(e, scope));
  const totals = totalsByAccount(entries);
  const accounts = chart().filter((a) => !a.is_header);
  const income = accounts
    .filter((a) => a.account_type === "income")
    .map((a) => ({ account: a, amount: signed("income", totals.get(a.code)?.debit ?? 0, totals.get(a.code)?.credit ?? 0) }))
    .filter((x) => x.amount !== 0);
  const expenses = accounts
    .filter((a) => a.account_type === "expense")
    .map((a) => ({ account: a, amount: signed("expense", totals.get(a.code)?.debit ?? 0, totals.get(a.code)?.credit ?? 0) }))
    .filter((x) => x.amount !== 0);
  const totalIncome = round2(income.reduce((s, x) => s + x.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, x) => s + x.amount, 0));
  return { income, expenses, totalIncome, totalExpenses, net: round2(totalIncome - totalExpenses) };
}

export function monthRange(year: number, month: number) {
  const k = monthKey(year, month);
  const { year: y, month: m } = fromMonthKey(k);
  const last = new Date(y, m, 0).getDate();
  return { start: isoDate(y, m, 1), end: isoDate(y, m, last) };
}
