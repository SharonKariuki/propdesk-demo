/** Payments, receipts (transactions), voids and the reconciliation queue. */
import { repos } from "../context";
import { badRequest, created, fieldError, fileResponse, notFound, type LocalRequest, type Router } from "../http";
import type { PaymentRow, PaymentSource, PaymentType } from "../schema";
import { logEvent } from "../services/audit";
import { currentBalance, isCurrent } from "../services/billing";
import { deliver } from "../services/notify";
import { recordPayment } from "../services/payments";
import {
  fullName, serializeBankCredit, serializePayment, serializeTransaction, tenantLabels,
} from "../services/serializers";
import { receiptPdf } from "../services/statements";
import {
  bodyObject, bool, dateField, decStr, idParam, intField, keyOfIso, money, monthKey, nowIso,
  randomId, requiredStr, round2, str, todayIso,
} from "../util";
import { getTenant } from "./tenants";

const SOURCES: PaymentSource[] = ["mpesa", "bank", "cash", "cheque"];
const TYPES: PaymentType[] = ["rent", "late_fee", "deposit", "other"];

function getPayment(req: LocalRequest): PaymentRow {
  const p = repos().payments.get(idParam(req.params.id));
  if (!p) throw notFound("Payment not found.");
  return p;
}

/** Rows that came from the same money: one bank credit, or one reference. */
function siblingsOf(p: PaymentRow) {
  return repos().payments.filter((o) =>
    !o.voided_at && o.tenant === p.tenant && o.id !== p.id
    && ((p.bank_credit && o.bank_credit === p.bank_credit) || (!!p.reference && o.reference === p.reference)));
}

function receiptData(txnId: number) {
  const r = repos();
  const txn = r.transactions.get(txnId);
  if (!txn) throw notFound("Receipt not found.");
  const payment = r.payments.get(txn.payment);
  const l = tenantLabels(txn.tenant);
  const taxed = txn.tax_amount > 0;
  const balance = currentBalance(txn.tenant);
  return {
    transaction_id: txn.transaction_id,
    reference_code: txn.reference_code,
    payment_mode: txn.payment_mode,
    tenant_name: l.tenant_name,
    unit_label: l.unit_label,
    building_name: l.building_name,
    period_month: payment?.period_month ?? 0,
    period_year: payment?.period_year ?? 0,
    payment_date: payment?.payment_date ?? null,
    unit_classification: l.classification,
    base_amount: decStr(txn.base_amount),
    tax_amount: decStr(txn.tax_amount),
    total_amount: decStr(txn.total_amount),
    show_tax_line: taxed,
    show_total_only: !taxed,
    outstanding_balance: balance > 0 ? decStr(balance) : null,
  };
}

export function registerPayments(router: Router) {
  router.get("/payments/", (req) => {
    const q = req.query;
    let rows = [...repos().payments.all()];
    if (q.get("include_void") !== "true") rows = rows.filter((p) => !p.voided_at);
    if (q.get("tenant")) rows = rows.filter((p) => p.tenant === Number(q.get("tenant")));
    if (q.get("source")) rows = rows.filter((p) => p.source === q.get("source"));
    if (q.get("period_month")) rows = rows.filter((p) => p.period_month === Number(q.get("period_month")));
    if (q.get("period_year")) rows = rows.filter((p) => p.period_year === Number(q.get("period_year")));
    rows.sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id - a.id);
    return rows.map(serializePayment);
  });

  router.get("/payments/recent/", () =>
    repos().payments
      .filter((p) => !p.voided_at)
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id - a.id)
      .slice(0, 10)
      .map(serializePayment));

  router.get("/payments/collection-progress/", (req) => {
    const now = new Date();
    const month = Number(req.query.get("month") ?? now.getMonth() + 1);
    const year = Number(req.query.get("year") ?? now.getFullYear());
    const r = repos();
    const key = monthKey(year, month);
    const expected = round2(
      r.charges.filter((c) => c.period_month === month && c.period_year === year && !c.is_opening)
        .reduce((s, c) => s + c.expected_rent + c.expected_vat - c.waived_amount, 0)
      + r.utilityCharges.filter((u) => u.period_month === month && u.period_year === year).reduce((s, u) => s + u.amount, 0),
    );
    const collected = round2(
      r.payments.filter((p) => !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === key)
        .reduce((s, p) => s + p.amount, 0),
    );
    return {
      expected: decStr(expected),
      collected: decStr(collected),
      percentage: expected > 0 ? (Math.min(100, (collected / expected) * 100)).toFixed(1) : "0.0",
      period_month: month,
      period_year: year,
    };
  });

  router.post("/payments/", (req) => {
    const body = bodyObject(req.body);
    const tenant = getTenant(intField(body.tenant, "tenant", { min: 1 }));
    const amount = money(body.amount, "amount", { allowZero: false });
    const source = requiredStr(body.source, "source") as PaymentSource;
    if (!SOURCES.includes(source)) throw fieldError("source", `"${source}" is not a valid choice.`);
    const type = (str(body.payment_type) || "rent") as PaymentType;
    if (!TYPES.includes(type)) throw fieldError("payment_type", `"${type}" is not a valid choice.`);
    const date = dateField(body.payment_date, "payment_date")!;
    if (date > todayIso()) throw fieldError("payment_date", "A payment cannot be dated in the future.");
    const reference = str(body.reference);
    if (reference && source !== "cash" && repos().payments.find((p) => p.reference === reference && !p.voided_at)) {
      throw fieldError("reference", "A payment with this reference is already recorded.");
    }
    const payment = recordPayment(req, {
      tenant, amount, payment_date: date,
      period_month: intField(body.period_month, "period_month", { min: 1, max: 12 }),
      period_year: intField(body.period_year, "period_year", { min: 2000, max: 2100 }),
      source, payment_type: type, reference, notes: str(body.notes),
    });
    return created(serializePayment(payment));
  });

  router.post("/payments/:id/resend-receipt/", (req) => {
    const payment = getPayment(req);
    const tenant = getTenant(payment.tenant);
    const txn = payment.transaction ? repos().transactions.get(payment.transaction) : null;
    const n = deliver({
      tenant, channel: "sms", subject: "Payment receipt",
      body: `Dear ${tenant.first_name}, receipt ${txn?.transaction_id ?? ""}: KES ${payment.amount.toLocaleString()} received on ${payment.payment_date}. Thank you. (Demo — not actually sent.)`,
      templateKey: "payment_received",
    });
    if (n.status === "failed") throw badRequest(n.error);
    logEvent(req, { action: "receipt_resend", summary: `Re-sent receipt to ${fullName(tenant)} (simulated)`, objectType: "payment", objectId: payment.id, objectLabel: payment.reference });
    return { detail: "Receipt resent (simulated — no SMS left the browser)." };
  });

  router.get("/payments/:id/void-preview/", (req) => {
    const payment = getPayment(req);
    const siblings = siblingsOf(payment);
    const credit = payment.bank_credit ? repos().bankCredits.get(payment.bank_credit) : null;
    return {
      payment: serializePayment(payment),
      siblings: siblings.map(serializePayment),
      total: decStr(payment.amount + siblings.reduce((s, p) => s + p.amount, 0)),
      requeueable: Boolean(credit),
      requeue_blocker: credit ? "" : "Only bank-feed credits can go back to Reconciliation; this payment was recorded by hand.",
    };
  });

  router.post("/payments/:id/void/", (req) => {
    const payment = getPayment(req);
    if (payment.voided_at) throw badRequest("This payment is already void.");
    const body = bodyObject(req.body);
    const reason = requiredStr(body.reason, "reason");
    const scope = str(body.scope) || "single";
    const rows = scope === "reference" ? [payment, ...siblingsOf(payment)] : [payment];
    const r = repos();
    const now = nowIso();
    for (const row of rows) {
      r.payments.update(row.id, { voided_at: now, void_reason: reason });
      if (row.payment_type === "deposit") {
        const t = r.tenants.get(row.tenant)!;
        r.tenants.update(t.id, { deposit_paid: round2(t.deposit_paid - row.amount) });
      }
    }
    let requeued: number | undefined;
    if (bool(body.requeue) && payment.bank_credit) {
      const credit = r.bankCredits.get(payment.bank_credit);
      if (credit) {
        r.bankCredits.update(credit.id, { status: "unmatched", assigned_payment: null, void_requeue_count: credit.void_requeue_count + 1 });
        requeued = credit.id;
      }
    }
    const total = rows.reduce((s, p) => s + p.amount, 0);
    logEvent(req, {
      action: "payment_void", summary: `Voided KES ${total.toLocaleString()} from ${fullName(getTenant(payment.tenant))}: ${reason}${requeued ? " — sent back to Reconciliation" : ""}`,
      objectType: "payment", objectId: payment.id, objectLabel: payment.reference || `Payment #${payment.id}`, financial: true,
    });
    return { voided_count: rows.length, ...(requeued ? { requeued_credit: requeued } : {}) };
  });

  // "Simulate a payment": the demo stand-in for an M-Pesa/bank notification.
  router.post("/payments/mock/", (req) => {
    const body = bodyObject(req.body);
    const tenant = getTenant(intField(body.tenant, "tenant", { min: 1 }));
    const amount = money(body.amount, "amount", { allowZero: false });
    const source = (str(body.source) || "mpesa") as PaymentSource;
    const today = todayIso();
    const payment = recordPayment(req, {
      tenant, amount, payment_date: today, period_month: Number(today.slice(5, 7)), period_year: Number(today.slice(0, 4)),
      source, payment_type: "rent", reference: `SIM${randomId().toUpperCase().slice(0, 8)}`, notes: "Simulated notification (demo)",
    });
    return created(serializePayment(payment));
  });

  // ── transactions & receipts ──
  router.get("/transactions/", (req) => {
    const tenant = req.query.get("tenant");
    const classification = req.query.get("classification");
    return repos().transactions
      .filter((t) => (!tenant || t.tenant === Number(tenant)) && !repos().payments.get(t.payment)?.voided_at)
      .map(serializeTransaction)
      .filter((t) => !classification || t.unit_classification === classification)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  });

  router.get("/transactions/:id/", (req) => {
    const t = repos().transactions.get(idParam(req.params.id));
    if (!t) throw notFound();
    return serializeTransaction(t);
  });

  router.get("/transactions/:id/receipt/", (req) => receiptData(idParam(req.params.id)));

  router.get("/transactions/:id/receipt-pdf/", (req) => {
    const t = repos().transactions.get(idParam(req.params.id));
    if (!t) throw notFound();
    return fileResponse(receiptPdf(t), `receipt-${t.transaction_id}.pdf`);
  });

  // ── reconciliation queue ──
  router.get("/unmatched-credits/", () =>
    repos().bankCredits
      .filter((b) => b.status === "unmatched")
      .sort((a, b) => b.received_at.localeCompare(a.received_at))
      .map(serializeBankCredit));

  router.post("/unmatched-credits/:id/assign/", (req) => {
    const credit = repos().bankCredits.get(idParam(req.params.id));
    if (!credit || credit.status !== "unmatched") throw notFound("This credit is no longer waiting to be matched.");
    const tenant = getTenant(intField(bodyObject(req.body).tenant, "tenant", { min: 1 }));
    if (!isCurrent(tenant) && tenant.status !== "moved_out") throw badRequest("Choose a tenant.");
    const date = credit.received_at.slice(0, 10);
    const payment = recordPayment(req, {
      tenant, amount: credit.amount, payment_date: date,
      period_month: Number(date.slice(5, 7)), period_year: Number(date.slice(0, 4)),
      source: credit.channel.toLowerCase().includes("mpesa") ? "mpesa" : "bank",
      payment_type: "rent", reference: credit.transaction_id, notes: `Matched from Reconciliation: ${credit.narration}`,
      bank_credit: credit.id,
    });
    repos().bankCredits.update(credit.id, { status: "assigned", assigned_payment: payment.id });
    return { detail: `KES ${credit.amount.toLocaleString()} booked to ${fullName(tenant)}.`, payment_id: payment.id };
  });
}
