/** Recording money received: the payment row, its receipt transaction, the log. */
import { database, repos } from "../context";
import type { LocalRequest } from "../http";
import type { PaymentRow, PaymentSource, PaymentType, TenantRow } from "../schema";
import { nowIso, round2, VAT_RATE } from "../util";
import { logEvent } from "./audit";
import { isCommercial } from "./billing";
import { fullName } from "./serializers";

export interface PaymentInput {
  tenant: TenantRow;
  amount: number;
  payment_date: string;
  period_month: number;
  period_year: number;
  source: PaymentSource;
  payment_type: PaymentType;
  reference: string;
  notes: string;
  bank_credit?: number | null;
}

const MODES = { mpesa: "MPESA", bank: "BANK", cash: "CASH", cheque: "CHEQUE" } as const;

/** A receipt number in the backend's TXN-<year>-<6 digits> form. */
function nextTransactionId(year: number) {
  return `TXN-${year}-${String(database().nextSequence(`txn-${year}`)).padStart(6, "0")}`;
}

export function recordPayment(req: LocalRequest | null, input: PaymentInput): PaymentRow {
  const r = repos();
  const tenant = input.tenant;
  if (input.payment_type === "deposit") {
    r.tenants.update(tenant.id, { deposit_paid: round2(tenant.deposit_paid + input.amount) });
  }
  const payment = r.payments.insert({
    tenant: tenant.id,
    amount: round2(input.amount),
    payment_date: input.payment_date,
    period_month: input.period_month,
    period_year: input.period_year,
    source: input.source,
    payment_type: input.payment_type,
    reference: input.reference,
    notes: input.notes,
    voided_at: null,
    void_reason: "",
    bank_credit: input.bank_credit ?? null,
    transaction: null,
    created_at: nowIso(),
  });
  // Every receipt but a deposit gets a numbered transaction; on a commercial
  // letting the amount is VAT-inclusive, so the receipt splits it out.
  if (input.payment_type !== "deposit" && input.amount > 0) {
    const vat = isCommercial(tenant) && input.payment_type === "rent";
    const base = vat ? round2(input.amount / (1 + VAT_RATE)) : round2(input.amount);
    const txn = r.transactions.insert({
      transaction_id: nextTransactionId(Number(input.payment_date.slice(0, 4))),
      tenant: tenant.id,
      payment: payment.id,
      base_amount: base,
      tax_amount: round2(input.amount - base),
      total_amount: round2(input.amount),
      payment_mode: MODES[input.source],
      reference_code: input.reference,
      created_at: nowIso(),
    });
    r.payments.update(payment.id, { transaction: txn.id });
  }
  if (req) {
    logEvent(req, {
      action: input.payment_type === "deposit" ? "deposit_record" : "payment_record",
      summary: `Recorded KES ${input.amount.toLocaleString()} ${input.payment_type === "deposit" ? "deposit" : "payment"} from ${fullName(tenant)}`,
      objectType: "payment", objectId: payment.id, objectLabel: input.reference || `Payment #${payment.id}`, financial: true,
    });
  }
  return r.payments.get(payment.id)!;
}
