/**
 * Reports and the Accounting suite. Every figure is computed on request from
 * the same records the rest of the app reads — the rent roll for balances,
 * the derived general ledger for income, expenses and the statements — so a
 * payment recorded a moment ago is in the next refresh, everywhere.
 */
import { repos } from "../context";
import { badRequest, fileResponse, notFound, type LocalRequest, type Router } from "../http";
import type { AccountRow, TenantRow } from "../schema";
import {
  balanceAtMonth, buildLedger, currentBalance, isCurrent, occupantOf, unitOf,
} from "../services/billing";
import { logEvent } from "../services/audit";
import { reconciliationChecks } from "../services/checks";
import { etimsInvoices, etimsSummary, retryEtims } from "../services/etims";
import { exportTable, pdfBlob, xlsxBlob, type ExportColumn, type ExportSpec } from "../services/documents";
import {
  buildJournal, chart, inScope, isDebitNormal, monthRange, profitAndLoss, signed, SOURCE_LABELS,
  totalsByAccount, type JournalEntry,
} from "../services/ledger";
import { fullName, tenantLabels } from "../services/serializers";
import {
  bodyObject, contains, currentKey, daysBetween, fromMonthKey, idParam, isoDate, keyOfIso,
  monthKey, monthShort, round2, str, todayIso,
} from "../util";
import { nextAnniversary } from "./notifications";

const UNIT_TYPE_DISPLAY: Record<string, string> = {
  single: "Single room", double: "Double room", bedsitter: "Bedsitter", "1br": "1 Bedroom",
  "2br": "2 Bedroom", "3br": "3 Bedroom", shop: "Shop / office",
};
const STATUS_DISPLAY: Record<TenantRow["status"], string> = {
  active: "Active", notice_given: "Notice given", moved_out: "Moved out", archived: "Archived",
};
const SOURCE_DISPLAY: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank Transfer", cash: "Cash", cheque: "Cheque" };
const TYPE_DISPLAY: Record<string, string> = { rent: "Rent", late_fee: "Late fee", deposit: "Deposit", other: "Other income" };

// ─── Monthly management report ───────────────────────────────────────────────
/**
 * One page for directors: what was billed and collected, what is overdue and
 * how old it is, occupancy, deposits, income against expenses, by property,
 * each compared with the month before. A few sentences say what moved.
 */
function monthlyReport(year: number, month: number) {
  const r = repos();
  const key = monthKey(year, month);
  const isCurrentMonth = key === currentKey();
  const end = isCurrentMonth ? todayIso() : monthRange(year, month).end;
  const rental = r.buildings.filter((b) => b.property_type === "rental");
  const lettable = r.units.filter((u) => !u.combined_into && rental.some((b) => b.id === u.building));
  const buildingOf = (tenantId: number) => {
    const t = r.tenants.get(tenantId);
    const u = t ? r.units.get(t.unit) : undefined;
    return u?.building ?? 0;
  };
  const endOf = (k: number) => { const { year: y, month: m } = fromMonthKey(k); return k === currentKey() ? todayIso() : monthRange(y, m).end; };
  const occupiedAt = (k: number, buildingId?: number) => {
    const at = endOf(k);
    const ids = new Set(r.tenants
      .filter((t) => t.move_in_date <= at && (!t.move_out_date || t.move_out_date > at))
      .map((t) => t.unit));
    return lettable.filter((u) => ids.has(u.id) && (!buildingId || u.building === buildingId)).length;
  };
  const expectedIn = (k: number, buildingId?: number) => {
    const { year: y, month: m } = fromMonthKey(k);
    const inB = (tid: number) => !buildingId || buildingOf(tid) === buildingId;
    return round2(
      r.charges.filter((c) => c.period_year === y && c.period_month === m && !c.is_opening && inB(c.tenant))
        .reduce((s, c) => s + c.expected_rent + c.expected_vat - c.waived_amount, 0)
      + r.utilityCharges.filter((u) => u.period_year === y && u.period_month === m && inB(u.tenant)).reduce((s, u) => s + u.amount, 0),
    );
  };
  const collectedIn = (k: number, buildingId?: number, upToDay?: number) => round2(r.payments
    .filter((p) => !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === k
      && (!buildingId || buildingOf(p.tenant) === buildingId)
      && (!upToDay || Number(p.payment_date.slice(8, 10)) <= upToDay))
    .reduce((s, p) => s + p.amount, 0));
  const depositsAt = (k: number) => {
    const at = endOf(k);
    return round2(r.tenants.filter((t) => t.move_in_date <= at && (!t.move_out_date || t.move_out_date > at)).reduce((s, t) => s + t.deposit_paid, 0));
  };

  // Arrears and their age, as at the end of the month (or today).
  const buckets = ["0_30", "31_60", "61_90", "90_plus"] as const;
  const aging = new Map<number, Record<(typeof buckets)[number], number>>();
  const overdueTenants: { tenant_id: number; tenant: string; unit: string; building: string; total: number; oldest: string }[] = [];
  for (const t of r.tenants.all()) {
    const owing = owingByPeriod(t.id).filter((o) => o.key <= key);
    if (!owing.length) continue;
    const b = buildingOf(t.id);
    const row = aging.get(b) ?? { "0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };
    for (const o of owing) {
      const { year: y, month: m } = fromMonthKey(o.key);
      const age = daysBetween(isoDate(y, m, 1), end);
      const k = age <= 30 ? "0_30" : age <= 60 ? "31_60" : age <= 90 ? "61_90" : "90_plus";
      row[k] = round2(row[k] + o.owing);
    }
    aging.set(b, row);
    const total = round2(owing.reduce((s, o) => s + o.owing, 0));
    // Early in a running month, rent for this month alone is not late yet.
    const onlyThisMonth = owing.every((o) => o.key === key);
    if (isCurrentMonth && onlyThisMonth && Number(end.slice(8, 10)) <= t.due_day) continue;
    if (total > 0) overdueTenants.push({ tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label, building: r.buildings.get(b)?.name.split(" - ")[0] ?? "", total, oldest: owing[0].label });
  }
  overdueTenants.sort((a, z) => z.total - a.total);
  const arrearsTotal = round2(overdueTenants.reduce((s, x) => s + x.total, 0));
  const arrearsPrev = round2(r.tenants.all().reduce((s, t) => s + Math.max(0, balanceAtMonth(t.id, key - 1)), 0));

  const pl = profitAndLoss(monthRange(year, month));
  const plPrev = (() => { const p = fromMonthKey(key - 1); return profitAndLoss(monthRange(p.year, p.month)); })();
  const expected = expectedIn(key);
  const collected = collectedIn(key);
  const dayCut = isCurrentMonth ? Number(todayIso().slice(8, 10)) : undefined;
  const prevExpected = expectedIn(key - 1);
  const prevCollected = collectedIn(key - 1, undefined, dayCut);
  const occupied = occupiedAt(key);
  const prevOccupied = occupiedAt(key - 1);
  const rate = expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0;
  const prevRate = prevExpected > 0 ? Math.round((prevCollected / prevExpected) * 1000) / 10 : 0;

  const properties = rental.map((b) => {
    const units = lettable.filter((u) => u.building === b.id).length;
    const bp = profitAndLoss({ ...monthRange(year, month), building: b.id });
    const ag = aging.get(b.id);
    const arrears = ag ? round2(buckets.reduce((s, k) => s + ag[k], 0)) : 0;
    const exp = expectedIn(key, b.id);
    const col = collectedIn(key, b.id);
    return {
      id: b.id, name: b.name.split(" - ")[0], units, occupied: occupiedAt(key, b.id),
      expected: exp, collected: col, collection_rate: exp > 0 ? Math.round((col / exp) * 100) : 0,
      arrears, income: bp.totalIncome, expenses: bp.totalExpenses, net: bp.net,
    };
  });
  const agingRows = rental.map((b) => ({ building: b.name.split(" - ")[0], ...(aging.get(b.id) ?? { "0_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 }) }));

  const trend = [];
  for (let k = key - 11; k <= key; k++) {
    const { year: y, month: m } = fromMonthKey(k);
    trend.push({ label: `${monthShort(m)} ${String(y).slice(2)}`, expected: expectedIn(k), collected: collectedIn(k), current: k === key });
  }

  // What moved, in plain words.
  const notes: string[] = [];
  const monthName = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1]}`;
  if (isCurrentMonth) notes.push(`${monthName} is in progress: figures run to ${end.slice(8, 10).replace(/^0/, "")} ${monthName}, and comparisons are with the same day last month.`);
  const diff = Math.round((rate - prevRate) * 10) / 10;
  notes.push(`KES ${collected.toLocaleString()} collected of KES ${expected.toLocaleString()} billed (${rate}%), ${diff === 0 ? "level with" : `${Math.abs(diff)} points ${diff > 0 ? "ahead of" : "behind"}`} last month.`);
  const worst = [...properties].filter((p) => p.expected > 0).sort((a, z) => a.collection_rate - z.collection_rate)[0];
  if (worst && properties.length > 1) notes.push(`${worst.name} has the lowest collection rate at ${worst.collection_rate}%.`);
  const old = agingRows.reduce((s, x) => s + x["61_90"] + x["90_plus"], 0);
  if (arrearsTotal > 0) notes.push(`Arrears stand at KES ${arrearsTotal.toLocaleString()}; KES ${round2(old).toLocaleString()} of it is over 60 days old.`);
  if (occupied !== prevOccupied) notes.push(`Occupancy ${occupied > prevOccupied ? "rose" : "fell"} from ${prevOccupied} to ${occupied} of ${lettable.length} units.`);

  return {
    year, month, as_of: end, is_current_month: isCurrentMonth,
    headline: {
      expected, collected, collection_rate: rate,
      prev_expected: prevExpected, prev_collected: prevCollected, prev_collection_rate: prevRate,
      arrears: arrearsTotal, prev_arrears: arrearsPrev,
      occupied, prev_occupied: prevOccupied, units: lettable.length,
      vacant: lettable.length - occupied,
      deposits_held: depositsAt(key), prev_deposits_held: depositsAt(key - 1),
      income: pl.totalIncome, expenses: pl.totalExpenses, net: pl.net,
      prev_income: plPrev.totalIncome, prev_expenses: plPrev.totalExpenses, prev_net: plPrev.net,
    },
    trend, aging: agingRows, properties, top_overdue: overdueTenants.slice(0, 10), notes,
  };
}

function monthlyReportFile(report: ReturnType<typeof monthlyReport>, format: string) {
  const h = report.headline;
  const label = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][report.month - 1]} ${report.year}`;
  const kes = (n: number) => round2(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const headRows: [string, number | string, number | string][] = [
    ["Rent and charges billed", h.expected, h.prev_expected],
    ["Collected", h.collected, h.prev_collected],
    ["Collection rate (%)", h.collection_rate, h.prev_collection_rate],
    ["Arrears", h.arrears, h.prev_arrears],
    ["Units let", `${h.occupied} of ${h.units}`, `${h.prev_occupied} of ${h.units}`],
    ["Deposits held", h.deposits_held, h.prev_deposits_held],
    ["Income", h.income, h.prev_income],
    ["Expenses", h.expenses, h.prev_expenses],
    ["Net income", h.net, h.prev_net],
  ];
  const propRows = report.properties.map((p) => [p.name, `${p.occupied}/${p.units}`, p.expected, p.collected, `${p.collection_rate}%`, p.arrears, p.expenses, p.net]);
  const ageRows = report.aging.map((a) => [a.building, a["0_30"], a["31_60"], a["61_90"], a["90_plus"], round2(a["0_30"] + a["31_60"] + a["61_90"] + a["90_plus"])]);
  const topRows = report.top_overdue.map((t) => [t.tenant, `${t.unit} · ${t.building}`, t.oldest, t.total]);
  if (format === "xlsx") {
    const rows: unknown[][] = [
      [`Monthly management report, ${label}`], [`As at ${report.as_of}. Mawingu Properties (demo data).`], [],
      ["Summary"], ...report.notes.map((n) => [n]), [],
      ["Measure", label, "Previous month"], ...headRows, [],
      ["By property"], ["Property", "Units let", "Billed", "Collected", "Rate", "Arrears", "Expenses", "Net income"], ...propRows, [],
      ["Arrears by age"], ["Property", "0-30 days", "31-60 days", "61-90 days", "Over 90 days", "Total"], ...ageRows, [],
      ["Largest arrears"], ["Tenant", "Unit", "Owing since", "Total"], ...topRows,
    ];
    return fileResponse(xlsxBlob("Monthly report", rows), `Monthly-report-${report.year}-${String(report.month).padStart(2, "0")}.xlsx`);
  }
  const blob = pdfBlob({
    title: `Monthly management report: ${label}`,
    subtitle: [`Mawingu Properties (demo data)`, `As at ${report.as_of}`],
    sections: [
      { heading: "Summary", pairs: report.notes.map((n, i) => [String(i + 1), n] as [string, string]) },
      { heading: "Headline figures (KES)", table: { columns: [{ label: "Measure" }, { label: label, align: "right" }, { label: "Previous month", align: "right" }], rows: headRows.map(([a, b, c]) => [a, typeof b === "number" ? kes(b) : b, typeof c === "number" ? kes(c) : c]) } },
      { heading: "By property (KES)", table: { columns: [{ label: "Property" }, { label: "Let", align: "right" }, { label: "Billed", align: "right" }, { label: "Collected", align: "right" }, { label: "Rate", align: "right" }, { label: "Arrears", align: "right" }, { label: "Expenses", align: "right" }, { label: "Net", align: "right" }], rows: propRows.map((r) => r.map((v) => typeof v === "number" ? kes(v) : String(v))) } },
      { heading: "Arrears by age (KES)", table: { columns: [{ label: "Property" }, { label: "0-30", align: "right" }, { label: "31-60", align: "right" }, { label: "61-90", align: "right" }, { label: "90+", align: "right" }, { label: "Total", align: "right" }], rows: ageRows.map((r) => r.map((v) => typeof v === "number" ? kes(v) : String(v))) } },
      { heading: "Largest arrears", table: { columns: [{ label: "Tenant" }, { label: "Unit" }, { label: "Owing since" }, { label: "KES", align: "right" }], rows: topRows.map((r) => r.map((v) => typeof v === "number" ? kes(v) : String(v))) } },
    ],
    footnote: "Generated from synthetic demo data. Collections compare with the same day of the previous month while a month is in progress.",
  });
  return fileResponse(blob, `Monthly-report-${report.year}-${String(report.month).padStart(2, "0")}.pdf`);
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function buildingParam(req: LocalRequest) {
  const id = Number(req.query.get("building") || 0);
  const b = id ? repos().buildings.get(id) : undefined;
  return { id: b?.id ?? null, ref: b ? { id: b.id, name: b.name } : null };
}

function monthParams(req: LocalRequest) {
  const now = new Date();
  return {
    month: Number(req.query.get("month") || now.getMonth() + 1),
    year: Number(req.query.get("year") || now.getFullYear()),
  };
}

const tenantBuilding = (t: TenantRow) => unitOf(t)?.building ?? null;

function tenantsFor(req: LocalRequest) {
  const { id } = buildingParam(req);
  const status = req.query.get("status") || "all";
  return repos().tenants
    .filter((t) => !id || tenantBuilding(t) === id)
    .filter((t) => status === "all" || (status === "current" ? isCurrent(t) : status === "former" ? !isCurrent(t) : true));
}

/** Each charge paid oldest-first; what is left owing, per period. */
function owingByPeriod(tenantId: number) {
  const rows = buildLedger(tenantId).filter((r) => r.key <= currentKey());
  // Everything that reduced the balance, spent on the oldest charge first.
  let pool = rows.reduce((s, r) => s + r.paid + r.credits + r.waived, 0);
  const out: { key: number; label: string; owing: number }[] = [];
  let previousBalance = 0;
  for (const r of rows) {
    // An opening row carries its figure in b/f; a refund re-opens what it paid out.
    const opening = r.is_opening ? r.brought_forward - previousBalance : 0;
    previousBalance = r.balance;
    const charged = round2(opening + r.rent + r.vat + r.other_charges + r.refunds);
    if (charged <= 0) {
      pool -= charged;
      continue;
    }
    const paid = Math.min(charged, Math.max(0, pool));
    pool -= paid;
    const owing = round2(charged - paid);
    if (owing > 0) out.push({ key: r.key, label: r.label, owing });
  }
  return out;
}

const statusOf = (balance: number, paid: number) =>
  balance > 0.004 ? (paid > 0 ? "Partial" : "Unpaid") : balance < -0.004 ? "In credit" : "Paid";

function parseMonth(value: string | null) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const [y, m] = value.split("-").map(Number);
  return monthKey(y, m);
}

function statementRows(tenantId: number, fromKey: number | null, toKey: number | null) {
  return buildLedger(tenantId)
    .filter((r) => (fromKey === null || r.key >= fromKey) && (toKey === null || r.key <= toKey))
    .map((r) => ({
      key: r.key,
      period: r.label,
      brought_forward: r.brought_forward,
      rent: round2(r.rent + r.vat),
      other_charges: r.other_charges,
      expected: round2(r.rent + r.vat + r.other_charges),
      paid: r.paid,
      credits: r.credits,
      balance: r.balance,
      status: statusOf(r.balance, r.paid),
    }));
}

function accountLabel(a: AccountRow) {
  return `${a.code} ${a.name}`;
}

// ─── Accounting suite ────────────────────────────────────────────────────────
function accounting(req: LocalRequest) {
  const q = req.query;
  const tab = q.get("tab") || "balance_sheet";
  const start = q.get("start") || isoDate(new Date().getFullYear(), 1, 1);
  const end = q.get("end") || todayIso();
  if (start > end) throw badRequest({ start: ["The start date must be on or before the end date."] });
  const building = Number(q.get("building") || 0) || null;
  const journal = buildJournal();
  const accounts = chart();
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const leaf = accounts.filter((a) => !a.is_header);
  const scoped = (s?: string, e?: string) => journal.filter((x) => inScope(x, { start: s, end: e, building }));

  const sectionGroups = (type: AccountRow["account_type"], totals: Map<string, { debit: number; credit: number }>, extra: { code: string; name: string; amount: number }[] = []) => {
    const headers = accounts.filter((a) => a.is_header && a.account_type === type);
    const groups = headers.map((h) => {
      const items = leaf
        .filter((a) => a.parent_code === h.code)
        .map((a) => ({ code: a.code, name: a.name, amount: signed(a.account_type, totals.get(a.code)?.debit ?? 0, totals.get(a.code)?.credit ?? 0) }))
        .filter((x) => x.amount !== 0);
      const all = h.account_type === "equity" ? [...items, ...extra] : items;
      return { code: h.code, name: h.name, accounts: all, total: round2(all.reduce((s, x) => s + x.amount, 0)) };
    }).filter((g) => g.accounts.length > 0);
    return { groups, total: round2(groups.reduce((s, g) => s + g.total, 0)) };
  };

  if (tab === "balance_sheet") {
    const totals = totalsByAccount(scoped(undefined, end));
    let earnings = 0;
    for (const a of leaf.filter((a) => a.account_type === "income" || a.account_type === "expense")) {
      const t = totals.get(a.code);
      if (!t) continue;
      earnings += a.account_type === "income" ? t.credit - t.debit : -(t.debit - t.credit);
    }
    const assets = sectionGroups("asset", totals);
    const liabilities = sectionGroups("liability", totals);
    const equity = sectionGroups("equity", totals, [{ code: "—", name: "Current earnings (profit to date)", amount: round2(earnings) }]);
    const totalLE = round2(liabilities.total + equity.total);
    return {
      tab, end, start,
      assets: assets.groups, liabilities: liabilities.groups, equity: equity.groups,
      total_assets: assets.total, total_liabilities: liabilities.total, total_equity: equity.total,
      total_liabilities_and_equity: totalLE,
      balanced: Math.abs(assets.total - totalLE) < 0.01,
      difference: round2(assets.total - totalLE),
    };
  }

  if (tab === "pnl") {
    const totals = totalsByAccount(scoped(start, end));
    const income = sectionGroups("income", totals);
    const expenses = sectionGroups("expense", totals);
    return {
      tab, start, end,
      income: income.groups, expenses: expenses.groups,
      total_income: income.total, total_expenses: expenses.total,
      net_profit: round2(income.total - expenses.total),
    };
  }

  if (tab === "trial_balance") {
    const mode = q.get("mode") === "movements" ? "movements" : "balances";
    const yearStart = isoDate(Number(end.slice(0, 4)), 1, 1);
    const balanceTotals = totalsByAccount(scoped(undefined, end));
    const pnlTotals = totalsByAccount(scoped(yearStart, end));
    const movementTotals = totalsByAccount(scoped(start, end));
    const rows = leaf.map((a) => {
      if (mode === "movements") {
        const t = movementTotals.get(a.code) ?? { debit: 0, credit: 0 };
        return { code: a.code, name: a.name, type: a.account_type, debit: t.debit, credit: t.credit };
      }
      const src = a.account_type === "income" || a.account_type === "expense" ? pnlTotals : balanceTotals;
      const t = src.get(a.code) ?? { debit: 0, credit: 0 };
      const net = round2(t.debit - t.credit);
      return { code: a.code, name: a.name, type: a.account_type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    }).filter((r) => r.debit || r.credit);
    // In closing-balance mode the year's profit sits in earnings until closed.
    if (mode === "balances") {
      const prior = totalsByAccount(scoped(undefined, addDaysIso(yearStart, -1)));
      let retained = 0;
      for (const a of leaf.filter((a) => a.account_type === "income" || a.account_type === "expense")) {
        const t = prior.get(a.code);
        if (t) retained += t.credit - t.debit;
      }
      retained = round2(retained);
      if (retained) rows.push({ code: "3300*", name: "Earnings from prior years (unclosed)", type: "equity", debit: retained < 0 ? -retained : 0, credit: retained > 0 ? retained : 0 });
    }
    const totalDebit = round2(rows.reduce((s, r) => s + r.debit, 0));
    const totalCredit = round2(rows.reduce((s, r) => s + r.credit, 0));
    return { tab, mode, start, end, rows, total_debit: totalDebit, total_credit: totalCredit, balanced: Math.abs(totalDebit - totalCredit) < 0.01 };
  }

  if (tab === "ledger") {
    const view = q.get("view") === "journal" ? "journal" : "account";
    const account = q.get("account") || "";
    const sources = (q.get("source") || "").split(",").filter(Boolean);
    const text = (q.get("q") || "").trim();
    const matches = (e: JournalEntry) =>
      (!sources.length || sources.includes(e.source))
      && (!text || contains(e.memo, text) || contains(e.reference, text) || e.lines.some((l) => contains(l.description, text)));
    const inPeriod = scoped(start, end);
    const buildingName = (id: number | null) => (id ? repos().buildings.get(id)?.name ?? "" : "");
    if (view === "journal") {
      const entries = inPeriod.filter(matches).map((e) => ({
        id: e.id, date: e.date, reference: e.reference, memo: e.memo, source: SOURCE_LABELS[e.source] ?? e.source,
        kind: e.kind, building: buildingName(e.building),
        amount: round2(e.lines.reduce((s, l) => s + l.debit, 0)),
        lines: e.lines.map((l) => ({ account_code: l.code, account_name: byCode.get(l.code)?.name ?? l.code, description: l.description, debit: l.debit, credit: l.credit })),
      }));
      return { tab, view, start, end, entries: entries.slice(-500), total: round2(entries.reduce((s, e) => s + e.amount, 0)), filtered: Boolean(sources.length || text) };
    }
    const openingTotals = totalsByAccount(journal.filter((e) => e.date < start && (!building || e.building === building)));
    const codes = account ? [account] : leaf.map((a) => a.code);
    const out = codes.map((code) => {
      const a = byCode.get(code);
      if (!a) return null;
      const debitNormal = isDebitNormal(a.account_type);
      const o = openingTotals.get(code) ?? { debit: 0, credit: 0 };
      const opening = a.account_type === "income" || a.account_type === "expense" ? 0 : signed(a.account_type, o.debit, o.credit);
      let running = opening;
      let debit = 0;
      let credit = 0;
      const lines = [];
      for (const e of inPeriod) {
        for (const l of e.lines.filter((l) => l.code === code)) {
          running = round2(running + (debitNormal ? l.debit - l.credit : l.credit - l.debit));
          if (!matches(e)) continue;
          debit = round2(debit + l.debit);
          credit = round2(credit + l.credit);
          lines.push({
            date: e.date, entry_id: e.id, reference: e.reference, description: e.memo, detail: l.description,
            source: SOURCE_LABELS[e.source] ?? e.source, kind: e.kind, building: buildingName(e.building),
            debit: l.debit, credit: l.credit, balance: running,
          });
        }
      }
      return {
        code, name: a.name, type: a.account_type, normal_side: debitNormal ? "Debit" : "Credit",
        opening, debit, credit, closing: running, lines: lines.slice(-400),
      };
    }).filter((x): x is NonNullable<typeof x> => Boolean(x) && (account !== "" || x!.lines.length > 0));
    return {
      tab, view, start, end, accounts: out,
      total_debit: round2(out.reduce((s, a) => s + a.debit, 0)),
      total_credit: round2(out.reduce((s, a) => s + a.credit, 0)),
      filtered: Boolean(sources.length || text),
    };
  }

  if (tab === "coa") {
    const before = totalsByAccount(journal.filter((e) => e.date < start && (!building || e.building === building)));
    const during = totalsByAccount(scoped(start, end));
    const rows = accounts.map((a) => {
      if (a.is_header) return { code: a.code, name: a.name, type: a.account_type, is_header: true, closing: 0 };
      const o = before.get(a.code) ?? { debit: 0, credit: 0 };
      const d = during.get(a.code) ?? { debit: 0, credit: 0 };
      const opening = a.account_type === "income" || a.account_type === "expense" ? 0 : signed(a.account_type, o.debit, o.credit);
      return {
        code: a.code, name: a.name, type: a.account_type, is_header: false,
        opening, debit: d.debit, credit: d.credit,
        closing: round2(opening + signed(a.account_type, d.debit, d.credit)),
      };
    });
    for (const h of rows.filter((r) => r.is_header)) {
      h.closing = round2(rows.filter((r) => !r.is_header && byCode.get(r.code)?.parent_code === h.code).reduce((s, r) => s + r.closing, 0));
    }
    return { tab, start, end, accounts: rows };
  }

  if (tab === "petty_cash") {
    const opening = (() => {
      const t = totalsByAccount(journal.filter((e) => e.date < start)).get("1010");
      return t ? round2(t.debit - t.credit) : 0;
    })();
    let running = opening;
    let cashIn = 0;
    let cashOut = 0;
    const entries = [];
    for (const e of scoped(start, end)) {
      for (const l of e.lines.filter((l) => l.code === "1010")) {
        running = round2(running + l.debit - l.credit);
        cashIn = round2(cashIn + l.debit);
        cashOut = round2(cashOut + l.credit);
        entries.push({ date: e.date, description: e.memo, debit: l.debit, credit: l.credit, balance: running });
      }
    }
    return { tab, start, end, opening, cash_in: cashIn, cash_out: cashOut, closing_balance: running, entries };
  }

  if (tab === "budgeting") {
    const months = Math.max(1, keyOfIso(end) - keyOfIso(start) + 1);
    const r = repos();
    const rows = r.buildings
      .filter((b) => b.property_type === "rental" && (!building || b.id === building))
      .map((b) => {
        const tenants = r.tenants.filter((t) => isCurrent(t) && tenantBuilding(t) === b.id && t.is_billable);
        const budgeted = round2(tenants.reduce((s, t) => s + t.monthly_rent, 0) * months);
        const actual = round2(r.payments
          .filter((p) => !p.voided_at && p.payment_type === "rent" && p.payment_date >= start && p.payment_date <= end)
          .filter((p) => tenantBuilding(r.tenants.get(p.tenant)!) === b.id)
          .reduce((s, p) => s + p.amount, 0));
        return { category: b.name, budgeted, actual, variance: round2(actual - budgeted) };
      });
    const tb = round2(rows.reduce((s, x) => s + x.budgeted, 0));
    const ta = round2(rows.reduce((s, x) => s + x.actual, 0));
    return { tab, start, end, basis: "rent_roll", rows, total_budgeted: tb, total_actual: ta, total_variance: round2(ta - tb) };
  }

  throw badRequest({ tab: [`Unknown tab "${tab}".`] });
}

function addDaysIso(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return isoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** The Accounting tab on screen as a flat table, for CSV / Excel / PDF. */
function accountingExport(data: ReturnType<typeof accounting>, format: ExportSpec["format"]) {
  const money = (key: string, label: string): ExportColumn => ({ key, label, kind: "money" });
  const text = (key: string, label: string): ExportColumn => ({ key, label, kind: "text" });
  const d = data as Record<string, unknown> & { tab: string };
  let columns: ExportColumn[] = [];
  let rows: Record<string, unknown>[] = [];
  const groupsRows = (groups: { name: string; accounts: { code: string; name: string; amount: number }[] }[], section: string) =>
    groups.flatMap((g) => g.accounts.map((a) => ({ section, group: g.name, account: `${a.code} ${a.name}`, amount: a.amount })));
  switch (d.tab) {
    case "balance_sheet":
    case "pnl": {
      columns = [text("section", "Section"), text("group", "Group"), text("account", "Account"), money("amount", "Amount")];
      const parts = d.tab === "pnl" ? [["income", "Income"], ["expenses", "Expenses"]] : [["assets", "Assets"], ["liabilities", "Liabilities"], ["equity", "Equity"]];
      rows = parts.flatMap(([key, label]) => groupsRows(d[key] as never, label));
      break;
    }
    case "trial_balance":
      columns = [text("code", "Code"), text("name", "Account"), text("type", "Type"), money("debit", "Debit"), money("credit", "Credit")];
      rows = d.rows as Record<string, unknown>[];
      break;
    case "ledger":
      if (d.view === "journal") {
        columns = [text("date", "Date"), text("entry", "Entry"), text("account", "Account"), text("description", "Description"), money("debit", "Debit"), money("credit", "Credit")];
        rows = (d.entries as { id: number; date: string; reference: string; lines: { account_code: string; account_name: string; description: string; debit: number; credit: number }[] }[])
          .flatMap((e) => e.lines.map((l) => ({ date: e.date, entry: `#${e.id} ${e.reference}`, account: `${l.account_code} ${l.account_name}`, description: l.description, debit: l.debit, credit: l.credit })));
      } else {
        columns = [text("account", "Account"), text("date", "Date"), text("reference", "Reference"), text("description", "Description"), money("debit", "Debit"), money("credit", "Credit"), money("balance", "Balance")];
        rows = (d.accounts as { code: string; name: string; lines: Record<string, unknown>[] }[])
          .flatMap((a) => a.lines.map((l) => ({ ...l, account: `${a.code} ${a.name}` })));
      }
      break;
    case "coa":
      columns = [text("code", "Code"), text("name", "Account"), text("type", "Type"), money("opening", "Opening"), money("debit", "Debits"), money("credit", "Credits"), money("closing", "Closing")];
      rows = d.accounts as Record<string, unknown>[];
      break;
    case "petty_cash":
      columns = [text("date", "Date"), text("description", "Description"), money("debit", "Cash in"), money("credit", "Cash out"), money("balance", "Balance")];
      rows = d.entries as Record<string, unknown>[];
      break;
    default:
      columns = [text("category", "Line"), money("budgeted", "Budgeted"), money("actual", "Actual"), money("variance", "Variance")];
      rows = (d.rows as Record<string, unknown>[]) ?? [];
  }
  const titles: Record<string, string> = {
    balance_sheet: "Balance Sheet", pnl: "Profit & Loss", trial_balance: "Trial Balance", ledger: "General Ledger",
    coa: "Chart of Accounts", petty_cash: "Petty Cash", budgeting: "Budget vs Actual",
  };
  return exportTable({
    format,
    title: titles[d.tab] ?? "Accounting",
    filename: `${d.tab}-${d.start}-${d.end}`,
    subtitle: [`${d.start} to ${d.end}`, "Mawingu Properties (demo data)"],
    columns,
    rows,
  });
}

// ─── registration ────────────────────────────────────────────────────────────
export function registerReports(router: Router) {
  router.get("/reports/monthly-collection/", (req) => {
    const { month, year } = monthParams(req);
    const b = buildingParam(req);
    const type = req.query.get("type") || "";
    const key = monthKey(year, month);
    const all = repos().payments
      .filter((p) => !p.voided_at && keyOfIso(p.payment_date) === key)
      .filter((p) => !b.id || tenantBuilding(repos().tenants.get(p.tenant)!) === b.id);
    const deposits = round2(all.filter((p) => p.payment_type === "deposit").reduce((s, p) => s + p.amount, 0));
    const rows = all
      .filter((p) => (type ? p.payment_type === type : p.payment_type !== "deposit"))
      .sort((a, b2) => b2.payment_date.localeCompare(a.payment_date))
      .map((p) => {
        const l = tenantLabels(p.tenant);
        return {
          id: p.id, tenant: l.tenant_name, unit: l.unit_label, amount: p.amount, type: TYPE_DISPLAY[p.payment_type],
          period: `${monthShort(p.period_month)} ${p.period_year}`, source: SOURCE_DISPLAY[p.source], date: p.payment_date, reference: p.reference,
        };
      });
    const bySource = new Map<string, number>();
    for (const r of rows) bySource.set(r.source, round2((bySource.get(r.source) ?? 0) + r.amount));
    return {
      building: b.ref, month, year, count: rows.length, total: round2(rows.reduce((s, r) => s + r.amount, 0)),
      deposits_received: deposits, by_source: [...bySource].map(([source, total]) => ({ source, total })), payments: rows,
    };
  });

  router.get("/reports/annual-income/", (req) => {
    const year = Number(req.query.get("year") || new Date().getFullYear());
    const b = buildingParam(req);
    const monthly = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1;
      const pl = profitAndLoss({ ...monthRange(year, month), building: b.id });
      const rent = round2(pl.income.filter((x) => x.account.code === "4110" || x.account.code === "4120").reduce((s, x) => s + x.amount, 0));
      const manual = round2(repos().manualIncome
        .filter((m) => m.period_year === year && m.period_month === month && (!b.id || m.building === b.id))
        .reduce((s, m) => s + m.amount, 0));
      return { month, rent, manual, other: round2(pl.totalIncome - rent - manual), total: pl.totalIncome };
    });
    return { building: b.ref, year, monthly, grand_total: round2(monthly.reduce((s, m) => s + m.total, 0)) };
  });

  router.get("/reports/arrears/", (req) => {
    const b = buildingParam(req);
    const rows = tenantsFor(req)
      .map((t) => {
        const ledger = buildLedger(t.id).filter((r) => r.key <= currentKey());
        const balance = currentBalance(t.id);
        const owing = owingByPeriod(t.id);
        return {
          tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label, status: STATUS_DISPLAY[t.status],
          phone: t.phone, period: owing[0]?.label ?? "",
          expected: round2(ledger.reduce((s, r) => s + r.rent + r.vat + r.other_charges + (r.is_opening ? r.brought_forward : 0), 0)),
          paid: round2(ledger.reduce((s, r) => s + r.paid, 0)),
          balance,
        };
      })
      .filter((r) => r.balance > 0)
      .sort((a, z) => z.balance - a.balance);
    return { building: b.ref, count: rows.length, total_balance: round2(rows.reduce((s, r) => s + r.balance, 0)), arrears: rows };
  });

  router.get("/reports/rent-balances/", (req) => {
    const { month, year } = monthParams(req);
    const b = buildingParam(req);
    const filter = req.query.get("status") || "all";
    const key = monthKey(year, month);
    const rows = repos().tenants
      .filter((t) => !b.id || tenantBuilding(t) === b.id)
      .map((t) => {
        const row = buildLedger(t.id).find((r) => r.key === key);
        if (!row) return null;
        const rent = round2(row.rent + row.vat);
        return {
          tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label,
          brought_forward: row.brought_forward, rent, other_charges: row.other_charges,
          charged: round2(rent + row.other_charges), paid: row.paid, credits: row.credits, balance: row.balance,
          status: statusOf(row.balance, row.paid),
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .filter((r) => filter === "all" || (filter === "owing" ? r.balance > 0 : filter === "credit" ? r.balance < 0 : r.balance === 0));
    const sum = (k: keyof (typeof rows)[number]) => round2(rows.reduce((s, r) => s + Number(r[k]), 0));
    return {
      building: b.ref, month, year, count: rows.length, balances: rows,
      totals: { brought_forward: sum("brought_forward"), rent: sum("rent"), other_charges: sum("other_charges"), paid: sum("paid"), credits: sum("credits"), balance: sum("balance") },
      total_outstanding: round2(rows.filter((r) => r.balance > 0).reduce((s, r) => s + r.balance, 0)),
      total_in_credit: round2(-rows.filter((r) => r.balance < 0).reduce((s, r) => s + r.balance, 0)),
    };
  });

  router.get("/reports/rent-overpayments/", (req) => {
    const { month, year } = monthParams(req);
    const b = buildingParam(req);
    const key = monthKey(year, month);
    const rows = repos().tenants
      .filter((t) => !b.id || tenantBuilding(t) === b.id)
      .map((t) => {
        const row = buildLedger(t.id).find((r) => r.key === key);
        if (!row || row.balance >= 0) return null;
        return {
          tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label, status: STATUS_DISPLAY[t.status],
          expected: round2(row.rent + row.vat + row.other_charges), paid: row.paid, overpaid: round2(-row.balance),
        };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r));
    return { building: b.ref, month, year, overpayments: rows, total_overpaid: round2(rows.reduce((s, r) => s + r.overpaid, 0)) };
  });

  router.get("/reports/aging-arrears/", (req) => {
    const b = buildingParam(req);
    const today = todayIso();
    const rows = tenantsFor(req)
      .map((t) => {
        const owing = owingByPeriod(t.id);
        if (!owing.length) return null;
        const buckets = { bucket_0_30: 0, bucket_31_60: 0, bucket_61_90: 0, bucket_90_plus: 0 };
        for (const o of owing) {
          const { year, month } = fromMonthKey(o.key);
          const age = daysBetween(isoDate(year, month, 1), today);
          const k = age <= 30 ? "bucket_0_30" : age <= 60 ? "bucket_31_60" : age <= 90 ? "bucket_61_90" : "bucket_90_plus";
          buckets[k] = round2(buckets[k] + o.owing);
        }
        const total = round2(owing.reduce((s, o) => s + o.owing, 0));
        return { tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label, oldest_period: owing[0].label, ...buckets, total };
      })
      .filter((r): r is NonNullable<typeof r> => Boolean(r) && r!.total > 0)
      .sort((a, z) => z.total - a.total);
    return { building: b.ref, aging: rows, grand_total: round2(rows.reduce((s, r) => s + r.total, 0)) };
  });

  router.get("/reports/expiring-leases/", (req) => {
    const b = buildingParam(req);
    const days = Number(req.query.get("days") || 60);
    const today = todayIso();
    const rows = repos().tenants
      .filter((t) => isCurrent(t) && (!b.id || tenantBuilding(t) === b.id))
      .map((t) => {
        const renewal = nextAnniversary(t.move_in_date, today);
        return {
          tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label, phone: t.phone,
          move_in_date: t.move_in_date, months_active: Math.max(0, keyOfIso(today) - keyOfIso(t.move_in_date)),
          renewal_date: renewal, days_to_renewal: daysBetween(today, renewal),
          leaving_on: t.intended_move_out_date, status: t.status === "notice_given" ? "Notice given" : "Active",
        };
      })
      .filter((r) => r.status === "Notice given" || r.days_to_renewal <= days)
      .sort((a, z) => a.days_to_renewal - z.days_to_renewal);
    return { building: b.ref, days, leases: rows };
  });

  router.get("/reports/tenant-history/:id/", (req) => {
    const t = repos().tenants.get(idParam(req.params.id));
    if (!t) throw notFound();
    const months = Number(req.query.get("months") || 12);
    let rows = buildLedger(t.id).filter((r) => r.key <= currentKey() && !r.is_opening);
    if (months > 0) rows = rows.slice(-months);
    return {
      tenant: { id: t.id, name: fullName(t), unit: tenantLabels(t.id).unit_label, status: STATUS_DISPLAY[t.status] },
      period_paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
      balance: currentBalance(t.id),
      chart_data: rows.map((r) => ({
        month: `${monthShort(r.period_month)} ${String(r.period_year).slice(2)}`,
        expected: round2(r.rent + r.vat + r.other_charges), paid: r.paid,
      })),
    };
  });

  router.get("/reports/tenant-statement/:id/", (req) => {
    const t = repos().tenants.get(idParam(req.params.id));
    if (!t) throw notFound();
    const rows = statementRows(t.id, parseMonth(req.query.get("from")), parseMonth(req.query.get("to")));
    return {
      tenant: { id: t.id, name: fullName(t), unit: tenantLabels(t.id).unit_label, status: STATUS_DISPLAY[t.status] },
      opening_balance: rows[0]?.brought_forward ?? 0,
      total_expected: round2(rows.reduce((s, r) => s + r.expected, 0)),
      total_paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
      total_credits: round2(rows.reduce((s, r) => s + r.credits, 0)),
      closing_balance: rows.length ? rows[rows.length - 1].balance : 0,
      rows,
    };
  });

  router.get("/reports/unit-statement/:id/", (req) => {
    const unit = repos().units.get(idParam(req.params.id));
    if (!unit) throw notFound();
    const from = parseMonth(req.query.get("from"));
    const to = parseMonth(req.query.get("to"));
    const tenants = repos().tenants.filter((t) => t.unit === unit.id).sort((a, b) => a.move_in_date.localeCompare(b.move_in_date));
    const occupant = occupantOf(unit);
    return {
      unit: {
        id: unit.id, label: unit.label, building: repos().buildings.get(unit.building)?.name ?? "",
        classification: unit.classification === "BUSINESS" ? "Commercial" : "Residential",
        status: occupant ? "Let" : unit.under_maintenance ? "Under maintenance" : "Vacant",
      },
      tenancies: tenants.map((t) => ({
        tenant_id: t.id, tenant: fullName(t), status: STATUS_DISPLAY[t.status], move_in_date: t.move_in_date,
        move_out_date: t.move_out_date,
        total_paid: round2(repos().payments.filter((p) => p.tenant === t.id && !p.voided_at && p.payment_type !== "deposit").reduce((s, p) => s + p.amount, 0)),
        closing_balance: currentBalance(t.id),
      })),
      rows: tenants.flatMap((t) => statementRows(t.id, from, to).map((r) => ({ ...r, tenant: fullName(t) }))),
    };
  });

  router.get("/reports/landlord-statement/", (req) => {
    const { month, year } = monthParams(req);
    const b = buildingParam(req);
    const pl = profitAndLoss({ ...monthRange(year, month), building: b.id });
    const key = monthKey(year, month);
    const r = repos();
    const inMonth = (p: { payment_date: string; tenant: number }) =>
      keyOfIso(p.payment_date) === key && (!b.id || tenantBuilding(r.tenants.get(p.tenant)!) === b.id);
    const deposits = round2(r.payments.filter((p) => !p.voided_at && p.payment_type === "deposit" && inMonth(p)).reduce((s, p) => s + p.amount, 0));
    const vat = round2(r.charges
      .filter((c) => c.period_month === month && c.period_year === year && (!b.id || tenantBuilding(r.tenants.get(c.tenant)!) === b.id))
      .reduce((s, c) => s + c.expected_vat, 0));
    const rows = [
      ...pl.income.map((x) => ({ section: "income" as const, description: x.account.name, amount: x.amount })),
      ...pl.expenses.map((x) => ({ section: "expense" as const, description: x.account.name, amount: x.amount })),
      ...(deposits ? [{ section: "memo" as const, description: "Security deposits received (held for tenants)", amount: deposits }] : []),
      ...(vat ? [{ section: "memo" as const, description: "VAT billed on commercial rent (owed to KRA)", amount: vat }] : []),
    ];
    const lettable = r.units.filter((u) => r.buildings.get(u.building)?.property_type === "rental" && !u.combined_into && (!b.id || u.building === b.id));
    return {
      building: b.ref, month, year, rows,
      total_income: pl.totalIncome, total_expenses: pl.totalExpenses, net: pl.net,
      units_occupied: lettable.filter((u) => occupantOf(u)).length, units_total: lettable.length,
    };
  });

  router.get("/reports/occupancy/", (req) => {
    const b = buildingParam(req);
    const r = repos();
    const rows = r.buildings
      .filter((x) => x.property_type === "rental" && (!b.id || x.id === b.id))
      .map((x) => {
        const units = r.units.filter((u) => u.building === x.id && !u.combined_into);
        const occupied = units.filter((u) => occupantOf(u)).length;
        const maintenance = units.filter((u) => !occupantOf(u) && u.under_maintenance).length;
        return {
          id: x.id, name: x.name, property_type: "Rental", total: units.length, occupied,
          vacant: units.length - occupied - maintenance, under_maintenance: maintenance,
          rate: units.length ? Math.round((occupied / units.length) * 1000) / 10 : 0,
        };
      });
    const total = rows.reduce((s, x) => s + x.total, 0);
    const occupied = rows.reduce((s, x) => s + x.occupied, 0);
    return {
      building: b.ref, buildings: rows,
      totals: {
        total, occupied, vacant: rows.reduce((s, x) => s + x.vacant, 0),
        under_maintenance: rows.reduce((s, x) => s + x.under_maintenance, 0),
        rate: total ? Math.round((occupied / total) * 1000) / 10 : 0,
      },
    };
  });

  router.get("/reports/vacant-units/", (req) => {
    const b = buildingParam(req);
    const status = req.query.get("status") || "all";
    const today = todayIso();
    const r = repos();
    const rows = r.units
      .filter((u) => r.buildings.get(u.building)?.property_type === "rental" && !u.combined_into && !occupantOf(u))
      .filter((u) => !b.id || u.building === b.id)
      .filter((u) => status === "all" || (status === "under_maintenance" ? u.under_maintenance : !u.under_maintenance))
      .map((u) => ({
        id: u.id, building: r.buildings.get(u.building)?.name ?? "", label: u.label, floor: u.floor,
        unit_type: UNIT_TYPE_DISPLAY[u.unit_type] ?? u.unit_type, classification: u.classification === "BUSINESS" ? "Commercial" : "Residential",
        monthly_rent: u.monthly_rent, status: u.under_maintenance ? "Under maintenance" : "Vacant",
        vacant_since: u.vacant_since, days_vacant: u.vacant_since ? daysBetween(u.vacant_since, today) : null,
      }));
    return { building: b.ref, count: rows.length, potential_rent: round2(rows.reduce((s, x) => s + x.monthly_rent, 0)), units: rows };
  });

  router.get("/reports/move-log/", (req) => {
    const b = buildingParam(req);
    const from = req.query.get("from") || "";
    const to = req.query.get("to") || "";
    const within = (d: string | null) => Boolean(d) && (!from || d! >= from) && (!to || d! <= to);
    let rows = tenantsFor(req).map((t) => ({
      tenant_id: t.id, tenant: fullName(t), unit: tenantLabels(t.id).unit_label,
      move_in: t.move_in_date, move_out: t.move_out_date, status: STATUS_DISPLAY[t.status],
    }));
    if (from || to) rows = rows.filter((x) => within(x.move_in) || within(x.move_out));
    rows.sort((a, z) => (z.move_out ?? z.move_in).localeCompare(a.move_out ?? a.move_in));
    return {
      building: b.ref, count: rows.length, entries: rows,
      moved_in: rows.filter((x) => within(x.move_in)).length,
      moved_out: rows.filter((x) => within(x.move_out)).length,
    };
  });

  router.get("/reports/profit-loss/", (req) => {
    const b = buildingParam(req);
    const { month, year } = monthParams(req);
    if (req.query.get("mode") === "annual") {
      const monthly = Array.from({ length: 12 }, (_, i) => {
        const pl = profitAndLoss({ ...monthRange(year, i + 1), building: b.id });
        return { month: i + 1, income: pl.totalIncome, expenses: pl.totalExpenses, net: pl.net };
      });
      return {
        building_name: b.ref?.name ?? null, year, monthly,
        grand_income: round2(monthly.reduce((s, m) => s + m.income, 0)),
        grand_expenses: round2(monthly.reduce((s, m) => s + m.expenses, 0)),
        grand_net: round2(monthly.reduce((s, m) => s + m.net, 0)),
      };
    }
    const pl = profitAndLoss({ ...monthRange(year, month), building: b.id });
    return {
      building_name: b.ref?.name ?? null, month, year,
      income: pl.totalIncome,
      income_breakdown: pl.income.map((x) => ({ label: x.account.name, amount: x.amount })),
      total_expenses: pl.totalExpenses,
      expense_breakdown: pl.expenses.map((x) => ({ category: x.account.name, amount: x.amount })),
      net_profit: pl.net,
    };
  });

  router.get("/accounting/checks/", () => reconciliationChecks());

  router.get("/reports/monthly/", (req) => {
    const { month, year } = monthParams(req);
    const report = monthlyReport(year, month);
    const format = req.query.get("format") ?? "";
    return format === "pdf" || format === "xlsx" ? monthlyReportFile(report, format) : report;
  });

  router.get("/tax/etims/", () => ({ summary: etimsSummary(), invoices: etimsInvoices() }));

  router.post("/tax/etims/:id/retry/", (req) => {
    const result = retryEtims(String(req.params.id));
    if (!result) throw notFound("Invoice not found.");
    if (result.status === "failed") throw badRequest(result.error);
    logEvent(req, {
      action: "etims_retry", summary: `Resent ${result.description} for ${result.tenant_name} to eTIMS (simulated): ${result.kra_invoice_no}`,
      objectType: "etims", objectLabel: result.id, financial: true,
    });
    return result;
  });

  router.get("/reports/trial-balance/", (req) => {
    const b = buildingParam(req);
    const { month, year } = monthParams(req);
    const totals = totalsByAccount(buildJournal().filter((e) => inScope(e, { ...monthRange(year, month), building: b.id })));
    const rows = chart()
      .filter((a) => !a.is_header && totals.has(a.code))
      .map((a) => ({ account: accountLabel(a), debit: totals.get(a.code)!.debit, credit: totals.get(a.code)!.credit }))
      .filter((r) => r.debit || r.credit);
    const td = round2(rows.reduce((s, r) => s + r.debit, 0));
    const tc = round2(rows.reduce((s, r) => s + r.credit, 0));
    return { building: b.ref, month, year, accounts: rows, total_debit: td, total_credit: tc, is_balanced: Math.abs(td - tc) < 0.01 };
  });

  router.get("/reports/expense-breakdown/", (req) => {
    const b = buildingParam(req);
    const { month, year } = monthParams(req);
    const r = repos();
    const expenses = r.expenses.filter((e) => e.period_month === month && e.period_year === year && (!b.id || e.building === b.id));
    const total = round2(expenses.reduce((s, e) => s + e.amount, 0));
    const byCategory = new Map<number, { total: number; count: number }>();
    for (const e of expenses) {
      const x = byCategory.get(e.category) ?? { total: 0, count: 0 };
      x.total = round2(x.total + e.amount);
      x.count += 1;
      byCategory.set(e.category, x);
    }
    const categories = [...byCategory].map(([id, x]) => ({
      category: r.expenseCategories.get(id)?.name ?? "Other", total: x.total,
      percentage: total ? Math.round((x.total / total) * 1000) / 10 : 0, count: x.count,
    })).sort((a, z) => z.total - a.total);
    const income = profitAndLoss({ ...monthRange(year, month), building: b.id }).totalIncome;
    return {
      building: b.ref, month, year, categories, total_expenses: total, total_income: income,
      expense_ratio: income ? Math.round((total / income) * 1000) / 10 : 0,
    };
  });

  // The Income overview: collected against billed, month by month, with the
  // collection rate, what is still owed, and each property's share.
  router.get("/reports/income-overview/", (req) => {
    const months = Number(req.query.get("months")) === 6 ? 6 : 12;
    const r = repos();
    const now = currentKey();
    const keys = Array.from({ length: months }, (_, i) => now - months + 1 + i);
    const cashIn = (key: number, tenantIds?: Set<number>) => round2(r.payments
      .filter((p) => !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === key && (!tenantIds || tenantIds.has(p.tenant)))
      .reduce((s, p) => s + p.amount, 0));
    const billed = (key: number, tenantIds?: Set<number>) => {
      const { year, month } = fromMonthKey(key);
      return round2(
        r.charges.filter((c) => c.period_month === month && c.period_year === year && !c.is_opening && (!tenantIds || tenantIds.has(c.tenant)))
          .reduce((s, c) => s + c.expected_rent + c.expected_vat - c.waived_amount, 0)
        + r.utilityCharges.filter((u) => u.period_month === month && u.period_year === year && (!tenantIds || tenantIds.has(u.tenant)))
          .reduce((s, u) => s + u.amount, 0),
      );
    };
    const monthly = keys.map((k) => {
      const { year, month } = fromMonthKey(k);
      return { month: monthShort(month), year, actual: cashIn(k), expected: billed(k), current: k === now };
    });
    const collected = round2(monthly.reduce((s, m) => s + m.actual, 0));
    const expected = round2(monthly.reduce((s, m) => s + m.expected, 0));
    const previous = round2(keys.reduce((s, k) => s + cashIn(k - months), 0));
    const owing = r.tenants.filter(isCurrent).map((t) => currentBalance(t.id)).filter((b) => b > 0);
    const rentals = r.buildings.filter((b) => b.property_type === "rental");
    return {
      months,
      monthly,
      collected,
      expected,
      collection_rate: expected > 0 ? Math.round((collected / expected) * 1000) / 10 : 0,
      growth: previous > 0 ? Math.round(((collected - previous) / previous) * 1000) / 10 : null,
      outstanding: round2(owing.reduce((s, b) => s + b, 0)),
      outstanding_count: owing.length,
      properties: rentals.length,
      by_property: rentals.map((b) => {
        const ids = new Set(r.tenants.filter((t) => tenantBuilding(t) === b.id).map((t) => t.id));
        return {
          id: b.id,
          name: b.name,
          collected: round2(keys.reduce((s, k) => s + cashIn(k, ids), 0)),
          expected: round2(keys.reduce((s, k) => s + billed(k, ids), 0)),
        };
      }).sort((a, z) => z.collected - a.collected),
    };
  });

  router.post("/reports/export/", (req) => {
    const spec = bodyObject(req.body) as unknown as ExportSpec;
    if (!spec || !Array.isArray(spec.columns) || !Array.isArray(spec.rows)) throw badRequest("Nothing to export.");
    if (!["csv", "xlsx", "pdf"].includes(spec.format)) throw badRequest({ format: ["Choose CSV, Excel or PDF."] });
    const { blob, filename } = exportTable({ ...spec, subtitle: [...(spec.subtitle ?? []), "Mawingu Properties (demo data)"] });
    return fileResponse(blob, filename);
  });

  router.get("/reports/accounting/", (req) => {
    const data = accounting(req);
    const format = str(req.query.get("export"));
    if (format === "csv" || format === "xlsx" || format === "pdf") {
      const { blob, filename } = accountingExport(data, format);
      return fileResponse(blob, filename);
    }
    return data;
  });
}

