/**
 * Tenant credits (CN-/CR- documents) and refunds (RF-). Owner only, as in the
 * real system. Balances are always derived: a credit lowers the rent roll in
 * the month it is dated, a sent refund puts back what was paid out.
 */
import { database, repos } from "../context";
import { badRequest, created, fieldError, fileResponse, notFound, type LocalRequest, type Router } from "../http";
import type { CreditReason, CreditRow, RefundRow } from "../schema";
import { logEvent } from "../services/audit";
import { currentBalance, isCommercial } from "../services/billing";
import { readFile, saveFile } from "../services/files";
import { creditRemaining, fullName, serializeCredit, serializeRefund } from "../services/serializers";
import {
  bodyObject, bool, dateField, decStr, idParam, intField, money, monthLabel, nowIso, requiredStr,
  round2, str, todayIso, VAT_RATE,
} from "../util";
import { getTenant } from "./tenants";

const REASONS: { value: CreditReason; label: string; document: CreditRow["credit_type"]; needs_charge: boolean; rent_only: boolean; needs_category: boolean }[] = [
  { value: "billing_correction", label: "Billing correction", document: "credit_note", needs_charge: true, rent_only: false, needs_category: false },
  { value: "rent_concession", label: "Rent concession", document: "credit_note", needs_charge: true, rent_only: true, needs_category: false },
  { value: "tenant_paid_cost", label: "Tenant paid a landlord cost", document: "account_credit", needs_charge: false, rent_only: false, needs_category: true },
  { value: "opening_credit", label: "Opening credit", document: "account_credit", needs_charge: false, rent_only: false, needs_category: false },
];

function creditedAgainst(field: "charge" | "utility_charge", id: number) {
  return round2(repos().credits
    .filter((c) => c[field] === id && !c.voided_at)
    .reduce((s, c) => s + c.net_amount, 0));
}

function creditableCharges(tenantId: number) {
  const r = repos();
  const tenant = getTenant(tenantId);
  const rate = isCommercial(tenant) ? VAT_RATE : 0;
  const rent = r.charges
    .filter((c) => c.tenant === tenantId && !c.is_opening)
    .sort((a, b) => b.period_year - a.period_year || b.period_month - a.period_month)
    .slice(0, 12)
    .map((c) => ({
      id: c.id,
      label: `Rent ${monthLabel(c.period_year, c.period_month)}`,
      charged: decStr(c.expected_rent + c.expected_vat),
      vat: decStr(c.expected_vat),
      creditable: decStr(Math.max(0, c.expected_rent - creditedAgainst("charge", c.id))),
      vat_rate: rate.toFixed(4),
    }));
  const water = r.utilityCharges
    .filter((u) => u.tenant === tenantId)
    .sort((a, b) => b.period_year - a.period_year || b.period_month - a.period_month)
    .slice(0, 12)
    .map((u) => ({
      id: u.id,
      label: u.label,
      charged: decStr(u.amount),
      vat: "0.00",
      creditable: decStr(Math.max(0, u.amount - creditedAgainst("utility_charge", u.id))),
      vat_rate: "0.0000",
    }));
  return { rent, water };
}

export function creditPosition(tenantId: number) {
  const r = repos();
  const tenant = getTenant(tenantId);
  const balance = currentBalance(tenantId);
  const inCredit = round2(Math.max(0, -balance));
  const credits = r.credits.filter((c) => c.tenant === tenantId && !c.voided_at);
  const available = round2(credits.filter((c) => !c.on_hold).reduce((s, c) => s + creditRemaining(c), 0));
  const held = round2(credits.filter((c) => c.on_hold).reduce((s, c) => s + c.amount, 0));
  const onAccount = round2(Math.min(inCredit, available));
  const toSend = round2(r.refunds.filter((f) => f.tenant === tenantId && f.status === "scheduled").reduce((s, f) => s + f.amount, 0));
  const charges = creditableCharges(tenantId);
  return {
    balance: decStr(balance),
    credit_on_account: decStr(onAccount),
    overpayment_credit: decStr(Math.max(0, inCredit - onAccount)),
    credits_available: decStr(available),
    credits_held: decStr(held),
    refunds_to_send: decStr(toSend),
    refundable: decStr(Math.max(0, inCredit - toSend)),
    reasons: REASONS,
    rent_charges: charges.rent,
    water_charges: charges.water,
    expense_categories: r.expenseCategories.all().map((c) => ({ id: c.id, name: c.name })),
    tenant_phone: tenant.phone,
  };
}

function getCredit(req: LocalRequest) {
  const c = repos().credits.get(idParam(req.params.id));
  if (!c) throw notFound("Credit not found.");
  return c;
}

function getRefund(req: LocalRequest): RefundRow {
  const f = repos().refunds.get(idParam(req.params.id));
  if (!f) throw notFound("Refund not found.");
  return f;
}

function voidPreview(c: CreditRow) {
  const r = repos();
  const refunds = r.refunds.filter((f) => f.credit === c.id);
  const kept = refunds.filter((f) => f.status === "sent").reduce((s, f) => s + f.amount, 0);
  const cancelled = refunds.filter((f) => f.status === "scheduled").reduce((s, f) => s + f.amount, 0);
  const reopened = c.amount_applied > 0
    ? [{ label: c.charge ? `Rent ${(() => { const ch = r.charges.get(c.charge!); return ch ? monthLabel(ch.period_year, ch.period_month) : ""; })()}` : "Balance owed", amount: decStr(c.amount_applied) }]
    : [];
  return {
    reopened,
    reopened_total: decStr(c.amount_applied),
    refunded_kept: decStr(kept),
    refunds_cancelled: decStr(cancelled),
    tenant_will_owe_more_by: decStr(c.on_hold ? 0 : c.amount),
  };
}

export function registerCredits(router: Router) {
  router.get("/tenant-credits/position/", (req) => creditPosition(Number(req.query.get("tenant"))));

  router.get("/tenant-credits/", (req) => {
    const tenant = Number(req.query.get("tenant"));
    return repos().credits
      .filter((c) => !tenant || c.tenant === tenant)
      .sort((a, b) => b.credit_date.localeCompare(a.credit_date) || b.id - a.id)
      .map(serializeCredit);
  });

  router.post("/tenant-credits/", async (req) => {
    const body = bodyObject(req.body);
    const tenant = getTenant(intField(body.tenant, "tenant", { min: 1 }));
    const reason = REASONS.find((x) => x.value === str(body.reason));
    if (!reason) throw fieldError("reason", "Choose why the credit is being given.");
    const net = money(body.amount, "amount", { allowZero: false });
    const r = repos();
    let charge: number | null = null;
    let utility: number | null = null;
    let vat = 0;
    if (reason.needs_charge) {
      const position = creditableCharges(tenant.id);
      if (str(body.arrears)) {
        charge = intField(body.arrears, "arrears");
        const row = position.rent.find((c) => c.id === charge);
        if (!row) throw fieldError("arrears", "Choose a rent charge of this tenant's.");
        if (net > Number(row.creditable)) throw fieldError("amount", `At most KES ${Number(row.creditable).toLocaleString()} of this charge can still be credited.`);
        vat = round2(net * Number(row.vat_rate));
      } else if (str(body.utility_charge) && !reason.rent_only) {
        utility = intField(body.utility_charge, "utility_charge");
        const row = position.water.find((c) => c.id === utility);
        if (!row) throw fieldError("utility_charge", "Choose a charge of this tenant's.");
        if (net > Number(row.creditable)) throw fieldError("amount", `At most KES ${Number(row.creditable).toLocaleString()} of this charge can still be credited.`);
      } else {
        throw fieldError("arrears", "Choose the charge this credit corrects.");
      }
    }
    let category: number | null = null;
    if (reason.needs_category) {
      category = intField(body.expense_category, "expense_category", { min: 1 });
      if (!r.expenseCategories.get(category)) throw fieldError("expense_category", "Choose what the tenant paid for.");
    }
    const evidence = body.evidence instanceof Blob ? body.evidence : null;
    const amount = round2(net + vat);
    const hold = bool(body.hold);
    const owed = Math.max(0, currentBalance(tenant.id));
    const prefix = reason.document === "credit_note" ? "CN" : "CR";
    const number = `${prefix}-${String(database().nextSequence(prefix)).padStart(4, "0")}`;
    const credit = r.credits.insert({
      number, tenant: tenant.id, credit_type: reason.document, reason: reason.value,
      credit_date: dateField(body.credit_date || todayIso(), "credit_date")!,
      net_amount: net, vat_amount: vat, amount,
      amount_applied: hold ? 0 : round2(Math.min(amount, owed)),
      on_hold: hold,
      description: requiredStr(body.description, "description"),
      internal_notes: str(body.internal_notes), reference: str(body.reference),
      evidence_file: evidence ? await saveFile(evidence) : null,
      evidence_name: evidence instanceof File ? evidence.name : evidence ? "evidence" : "",
      charge, utility_charge: utility, expense_category: category,
      created_by: req.user!.id, created_at: nowIso(), voided_at: null, voided_by: null, void_reason: "",
    });
    logEvent(req, { action: "credit_issue", summary: `Issued ${number} for KES ${amount.toLocaleString()} to ${fullName(tenant)}`, objectType: "tenant_credit", objectId: credit.id, objectLabel: number, financial: true });
    return created(serializeCredit(credit));
  });

  router.get("/tenant-credits/:id/evidence/", async (req) => {
    const c = getCredit(req);
    const blob = await readFile(c.evidence_file);
    if (!blob) throw notFound("No evidence was attached.");
    return fileResponse(blob, c.evidence_name || "evidence");
  });

  router.post("/tenant-credits/:id/hold/", (req) => {
    const c = getCredit(req);
    if (c.voided_at) throw badRequest("A void credit cannot be held or released.");
    const hold = bool(bodyObject(req.body).hold);
    const owed = Math.max(0, currentBalance(c.tenant));
    const updated = repos().credits.update(c.id, { on_hold: hold, amount_applied: hold ? 0 : round2(Math.min(c.amount, owed)) });
    logEvent(req, { action: hold ? "credit_hold" : "credit_release", summary: `${hold ? "Held" : "Released"} ${c.number}`, objectType: "tenant_credit", objectId: c.id, objectLabel: c.number, financial: true });
    return serializeCredit(updated);
  });

  router.get("/tenant-credits/:id/void-preview/", (req) => voidPreview(getCredit(req)));

  router.post("/tenant-credits/:id/void/", (req) => {
    const c = getCredit(req);
    if (c.voided_at) throw badRequest("This credit is already void.");
    const reason = requiredStr(bodyObject(req.body).reason, "reason");
    const r = repos();
    for (const f of r.refunds.filter((f) => f.credit === c.id && f.status === "scheduled")) {
      r.refunds.update(f.id, { status: "cancelled", closed_by: req.user!.id, close_reason: `Credit ${c.number} voided` });
    }
    const updated = r.credits.update(c.id, { voided_at: nowIso(), voided_by: req.user!.id, void_reason: reason });
    logEvent(req, { action: "credit_void", summary: `Voided ${c.number}: ${reason}`, objectType: "tenant_credit", objectId: c.id, objectLabel: c.number, financial: true });
    return serializeCredit(updated);
  });

  // ── refunds ──
  router.get("/refunds/", (req) => {
    const tenant = Number(req.query.get("tenant"));
    return repos().refunds
      .filter((f) => !tenant || f.tenant === tenant)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(serializeRefund);
  });

  router.post("/refunds/", (req) => {
    const body = bodyObject(req.body);
    const tenant = getTenant(intField(body.tenant, "tenant", { min: 1 }));
    const amount = money(body.amount, "amount", { allowZero: false });
    const refundable = Number(creditPosition(tenant.id).refundable);
    if (amount > refundable + 0.001) {
      throw fieldError("amount", `Only KES ${refundable.toLocaleString()} can be refunded — the tenant's credit, less refunds already scheduled.`);
    }
    const method = (str(body.method) || "mpesa") as RefundRow["method"];
    if (!["mpesa", "bank", "cash", "cheque"].includes(method)) throw fieldError("method", `"${method}" is not a valid choice.`);
    const sent = bool(body.already_sent);
    const creditId = body.credit === null || body.credit === undefined || str(body.credit) === "" ? null : Number(body.credit);
    const number = `RF-${String(database().nextSequence("RF")).padStart(4, "0")}`;
    const refund = repos().refunds.insert({
      number, tenant: tenant.id, amount, method,
      paid_to: requiredStr(body.paid_to, "paid_to"),
      reference: str(body.reference), notes: str(body.notes),
      status: sent ? "sent" : "scheduled",
      sent_on: sent ? dateField(body.sent_on || todayIso(), "sent_on") : null,
      credit: creditId, created_by: req.user!.id, created_at: nowIso(),
      sent_recorded_by: sent ? req.user!.id : null, closed_by: null, close_reason: "",
    });
    logEvent(req, { action: "refund_create", summary: `${sent ? "Recorded" : "Scheduled"} refund ${number} of KES ${amount.toLocaleString()} to ${fullName(tenant)}`, objectType: "refund", objectId: refund.id, objectLabel: number, financial: true });
    return created(serializeRefund(refund));
  });

  router.post("/refunds/:id/mark-sent/", (req) => {
    const f = getRefund(req);
    if (f.status !== "scheduled") throw badRequest("Only a scheduled refund can be marked as sent.");
    const body = bodyObject(req.body);
    const updated = repos().refunds.update(f.id, {
      status: "sent",
      sent_on: dateField(body.sent_on, "sent_on"),
      reference: str(body.reference) || f.reference,
      method: (str(body.method) as RefundRow["method"]) || f.method,
      paid_to: str(body.paid_to) || f.paid_to,
      sent_recorded_by: req.user!.id,
    });
    logEvent(req, { action: "refund_sent", summary: `Marked ${f.number} as sent`, objectType: "refund", objectId: f.id, objectLabel: f.number, financial: true });
    return serializeRefund(updated);
  });

  for (const action of ["cancel", "void"] as const) {
    router.post(`/refunds/:id/${action}/`, (req) => {
      const f = getRefund(req);
      if (action === "cancel" && f.status !== "scheduled") throw badRequest("Only a scheduled refund can be cancelled.");
      if (action === "void" && f.status !== "sent") throw badRequest("Only a sent refund can be voided.");
      const reason = requiredStr(bodyObject(req.body).reason, "reason");
      const updated = repos().refunds.update(f.id, {
        status: action === "cancel" ? "cancelled" : "void", closed_by: req.user!.id, close_reason: reason,
      });
      logEvent(req, { action: `refund_${action}`, summary: `${action === "cancel" ? "Cancelled" : "Voided"} ${f.number}: ${reason}`, objectType: "refund", objectId: f.id, objectLabel: f.number, financial: true });
      return serializeRefund(updated);
    });
  }
}
