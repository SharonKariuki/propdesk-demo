/** Notifications (simulated outbox), SMS wallet and the dashboard summary. */
import { database, repos } from "../context";
import { badRequest, created, type Router } from "../http";
import type { NotificationRow, TenantRow } from "../schema";
import { logEvent } from "../services/audit";
import {
  currentBalance, isCurrent, monthDue, occupantOf, paidInMonth, unitStatus, vatOn,
} from "../services/billing";
import { deliver, SMS_LOW_THRESHOLD, SMS_UNIT_COST, TEMPLATES } from "../services/notify";
import { fullName, serializeNotification, serializePayment, tenantLabels } from "../services/serializers";
import {
  bodyObject, currentKey, daysBetween, decStr, fromMonthKey, keyOfIso, monthShort, nowIso,
  round2, str, todayIso,
} from "../util";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 Nov 2026": the one date format people read in the product. */
export const friendlyDate = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT_MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function fill(text: string, t: TenantRow) {
  const l = tenantLabels(t.id);
  const now = new Date();
  const due = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(t.due_day || 5).padStart(2, "0")}`;
  return text
    .replaceAll("{tenant_name}", fullName(t))
    .replaceAll("{first_name}", t.first_name)
    .replaceAll("{unit_label}", l.unit_label)
    .replaceAll("{building_name}", l.building_name)
    .replaceAll("{month}", String(now.getMonth() + 1))
    .replaceAll("{year}", String(now.getFullYear()))
    .replaceAll("{amount}", t.monthly_rent.toLocaleString())
    .replaceAll("{balance}", currentBalance(t.id).toLocaleString())
    .replaceAll("{due_date}", due);
}

function smsBalance() {
  const wallet = database().meta.sms_wallet;
  return {
    configured: true,
    balance: decStr(wallet),
    currency: "KES",
    sms_remaining: Math.floor(wallet / SMS_UNIT_COST),
    unit_cost: SMS_UNIT_COST.toFixed(2),
    low: wallet < SMS_LOW_THRESHOLD,
    low_threshold: SMS_LOW_THRESHOLD.toFixed(2),
    checked_at: nowIso(),
    cached: false,
    error: null,
    topup: { paybill: "000000", account: "DEMO-WALLET", note: "Demo wallet — simulated. No real SMS provider is connected and no top-up is possible." },
  };
}

export function registerNotifications(router: Router) {
  router.get("/notifications/", () =>
    [...repos().notifications.all()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(0, 300)
      .map(serializeNotification));

  router.get("/notifications/templates/", () => TEMPLATES);

  router.get("/notifications/sms-balance/", () => smsBalance());

  router.post("/notifications/send/", (req) => {
    const body = bodyObject(req.body);
    const audience = str(body.audience);
    const channel = str(body.channel) as NotificationRow["channel"];
    if (!["sms", "email", "both"].includes(channel)) throw badRequest({ channel: ["Choose SMS, email or both."] });
    const text = str(body.body);
    if (!text) throw badRequest({ body: ["Write a message."] });
    if (channel !== "sms" && !str(body.subject)) throw badRequest({ subject: ["An email needs a subject."] });
    const r = repos();
    let recipients: TenantRow[];
    if (audience === "tenant") {
      const ids = Array.isArray(body.tenant_ids) ? body.tenant_ids.map(Number) : [];
      recipients = ids.map((id) => r.tenants.get(id)).filter((t): t is TenantRow => Boolean(t));
    } else if (audience === "all_active") {
      recipients = r.tenants.filter(isCurrent);
    } else if (audience === "with_arrears") {
      recipients = r.tenants.filter((t) => isCurrent(t) && currentBalance(t.id) > 0);
    } else {
      throw badRequest({ audience: ["Choose who to send to."] });
    }
    if (recipients.length === 0) throw badRequest("Nobody matches that audience.");
    const notifications = recipients.map((t) =>
      deliver({ tenant: t, channel, subject: fill(str(body.subject), t), body: fill(text, t), templateKey: str(body.template_key) }));
    const sent = notifications.filter((n) => n.status === "sent").length;
    logEvent(req, { action: "notify_send", summary: `Sent ${sent} ${channel} message(s) (simulated)`, objectType: "notification", objectLabel: `${recipients.length} recipient(s)` });
    return created({ sent, failed: notifications.length - sent, total: notifications.length, notifications: notifications.map(serializeNotification) });
  });

  router.get("/dashboard/summary/", () => dashboardSummary());
}

export function dashboardSummary() {
  const r = repos();
  const now = currentKey();
  const lettable = r.units.filter((u) => {
    const b = r.buildings.get(u.building);
    return b?.property_type === "rental" && !u.combined_into;
  });
  const occupancy = { vacant: 0, paid: 0, partial: 0, unpaid: 0, arrears: 0 };
  for (const u of lettable) {
    const s = unitStatus(u);
    if (s === "vacant") occupancy.vacant += 1;
    else if (s === "occupied_paid") occupancy.paid += 1;
    else if (s === "occupied_partial") occupancy.partial += 1;
    else if (s === "occupied_unpaid") occupancy.unpaid += 1;
    else occupancy.arrears += 1;
  }
  const current = r.tenants.filter(isCurrent);
  const balances = new Map(r.tenants.all().map((t) => [t.id, currentBalance(t.id)]));
  const totalArrears = round2([...balances.values()].filter((b) => b > 0).reduce((s, b) => s + b, 0));
  const { year, month } = fromMonthKey(now);
  const expected = round2(
    r.charges.filter((c) => c.period_month === month && c.period_year === year && !c.is_opening)
      .reduce((s, c) => s + c.expected_rent + c.expected_vat - c.waived_amount, 0)
    + r.utilityCharges.filter((u) => u.period_month === month && u.period_year === year).reduce((s, u) => s + u.amount, 0),
  );
  const cashIn = (key: number) => round2(r.payments
    .filter((p) => !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === key)
    .reduce((s, p) => s + p.amount, 0));
  const received = cashIn(now);
  // What each month asked for (rent + VAT + water), to draw "expected" ghost bars.
  const expectedIn = (key: number) => {
    const { year: y, month: m } = fromMonthKey(key);
    return round2(
      r.charges.filter((c) => c.period_month === m && c.period_year === y && !c.is_opening)
        .reduce((s2, c) => s2 + c.expected_rent + c.expected_vat - c.waived_amount, 0)
      + r.utilityCharges.filter((u) => u.period_month === m && u.period_year === y).reduce((s2, u) => s2 + u.amount, 0),
    );
  };
  const trend = [];
  for (let k = now - 11; k <= now; k++) {
    trend.push({ month: monthShort(fromMonthKey(k).month), amount: cashIn(k), expected: expectedIn(k), current: k === now });
  }

  const buildings = r.buildings
    .filter((b) => b.property_type === "rental")
    .map((b) => {
      const units = lettable.filter((u) => u.building === b.id);
      const occupied = units.filter((u) => occupantOf(u)).length;
      const tenantIds = new Set(r.tenants.filter((t) => units.some((u) => u.id === t.unit)).map((t) => t.id));
      const collected = round2(r.payments
        .filter((p) => tenantIds.has(p.tenant) && !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === now)
        .reduce((s2, p) => s2 + p.amount, 0));
      const due = round2(r.charges
        .filter((c) => tenantIds.has(c.tenant) && c.period_month === month && c.period_year === year && !c.is_opening)
        .reduce((s2, c) => s2 + c.expected_rent + c.expected_vat, 0));
      return { id: b.id, name: b.name, total: units.length, occupied, vacant: units.length - occupied, collected, expected: due };
    });

  const recent = r.payments
    .filter((p) => !p.voided_at)
    .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id - a.id)
    .slice(0, 8)
    .map((p) => {
      const s = serializePayment(p);
      return {
        id: s.id, tenant_name: s.tenant_name, unit_label: s.unit_label, building_name: s.building_name,
        amount: p.amount, source: s.source_display, payment_date: s.payment_date, reference: s.reference,
        // "matched": arrived through the M-Pesa / bank feed; "partial": less than the month asked for.
        status: (() => {
          const t = r.tenants.get(p.tenant);
          const monthly = t ? t.monthly_rent + vatOn(t, t.monthly_rent) : 0;
          if (p.payment_type === "rent" && monthly > 0 && p.amount < monthly - 0.5) return "partial";
          return p.bank_credit || p.source === "mpesa" || p.source === "bank" ? "matched" : "recorded";
        })(),
      };
    });

  const alerts: { type: "overdue" | "partial" | "move_out" | "expiring_lease" | "maintenance"; message: string; tenant_id?: number; unit_id?: number }[] = [];
  const today = todayIso();
  for (const t of current) {
    const l = tenantLabels(t.id);
    const bal = balances.get(t.id) ?? 0;
    const status = unitStatus(r.units.get(t.unit)!);
    if (status === "arrears") alerts.push({ type: "overdue", message: `${fullName(t)} (${l.unit_label}) owes KES ${bal.toLocaleString()}`, tenant_id: t.id });
    else if (status === "occupied_partial") alerts.push({ type: "partial", message: `${fullName(t)} (${l.unit_label}) has paid part of this month — KES ${bal.toLocaleString()} left`, tenant_id: t.id });
    if (t.status === "notice_given" && t.intended_move_out_date) {
      alerts.push({ type: "move_out", message: `${fullName(t)} leaves ${l.unit_label} on ${friendlyDate(t.intended_move_out_date)}`, tenant_id: t.id });
    }
    const anniversary = nextAnniversary(t.move_in_date, today);
    if (t.status === "active" && daysBetween(today, anniversary) <= 30) {
      alerts.push({ type: "expiring_lease", message: `${fullName(t)}'s lease on ${l.unit_label} renews on ${friendlyDate(anniversary)}`, tenant_id: t.id });
    }
  }
  for (const m of r.maintenance.filter((m) => m.status !== "resolved")) {
    const unit = r.units.get(m.unit);
    alerts.push({ type: "maintenance", message: `Maintenance open on ${unit?.label ?? "a unit"}: ${m.description}`, unit_id: m.unit });
  }

  // Honest arrears: rent for this month is not late until its due day has passed.
  const dayOfMonth = Number(today.slice(8, 10));
  let overdueTotal = 0;
  let overdueCount = 0;
  let notLateTotal = 0;
  let notLateCount = 0;
  for (const t of current) {
    const bal = balances.get(t.id) ?? 0;
    if (bal <= 0) continue;
    const notLate = dayOfMonth <= t.due_day
      ? Math.min(bal, Math.max(0, monthDue(t.id, now) - paidInMonth(t.id, now)))
      : 0;
    const overdue = round2(bal - notLate);
    if (overdue > 0.5) { overdueTotal += overdue; overdueCount += 1; }
    if (notLate > 0.5) { notLateTotal += notLate; notLateCount += 1; }
  }
  const credits = round2([...balances.values()].filter((b) => b < 0).reduce((s, b) => s - b, 0));
  // Cash in last month up to the same day, so a 1st-of-month view is not compared with a whole month.
  const prev = fromMonthKey(now - 1);
  const sameDayPrev = `${prev.year}-${String(prev.month).padStart(2, "0")}-${String(Math.min(dayOfMonth, new Date(prev.year, prev.month, 0).getDate())).padStart(2, "0")}`;
  const lastMonthToDate = round2(r.payments
    .filter((p) => !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === now - 1 && p.payment_date <= sameDayPrev)
    .reduce((s, p) => s + p.amount, 0));
  const dueDays = current.map((t) => t.due_day).sort((a, b) => a - b);
  const typicalDueDay = dueDays.length ? dueDays[Math.floor(dueDays.length / 2)] : 5;

  return {
    kpis: {
      overdue_total: round2(overdueTotal),
      overdue_count: overdueCount,
      due_not_late_total: round2(notLateTotal),
      due_not_late_count: notLateCount,
      tenant_credits_total: credits,
      last_month_to_date_received: lastMonthToDate,
      due_day: typicalDueDay,
      deposits_held: round2(current.reduce((s, t) => s + t.deposit_paid, 0)),
      total_units: lettable.length,
      occupied: lettable.length - occupancy.vacant,
      vacant: occupancy.vacant,
      active_tenants: current.length,
      total_arrears: totalArrears,
      arrears_count: [...balances.entries()].filter(([id, b]) => b > 0 && isCurrent(r.tenants.get(id)!)).length,
      collection_expected: expected,
      collection_received: received,
      collection_percentage: expected > 0 ? Math.min(100, Math.round((received / expected) * 100)) : 0,
      last_month_received: cashIn(now - 1),
    },
    income_trend: trend,
    occupancy,
    buildings,
    recent_payments: recent,
    alerts: alerts.slice(0, 40),
  };
}

/** The next yearly anniversary of a move-in date, on or after today. */
export function nextAnniversary(moveIn: string, today: string) {
  const [, m, d] = moveIn.split("-").map(Number);
  let year = Number(today.slice(0, 4));
  let candidate = `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
  if (candidate < today) {
    year += 1;
    candidate = `${year}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
  }
  return candidate;
}

