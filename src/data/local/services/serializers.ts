/**
 * Serializers: stored rows → the JSON the UI consumes. Each mirrors one DRF
 * serializer of the real backend, so the types in src/lib/types.ts and the
 * hook interfaces describe both providers' responses.
 */
import type { Building, BuildingDetail, TenantDetail, TenantListItem, Unit } from "@/lib/types";

import { repos } from "../context";
import type {
  BankCreditRow, BuildingRow, CreditRow, ExpenseRow, ManualIncomeRow, MaintenanceRow,
  NotificationRow, PaymentRow, RefundRow, TenantRow, TransactionRow, UnitRow, UtilityChargeRow,
  AuditRow,
} from "../schema";
import { dec, decStr, round2 } from "../util";
import {
  currentBalance, depositMonths, expectedDeposit, isCurrent, occupantOf, UNIT_STATUS_DISPLAY,
  unitStatus,
} from "./billing";
import { fileUrl } from "./files";

const PROPERTY_TYPE_DISPLAY = { rental: "Rental", farm: "Farm", expense_only: "Expenses only" } as const;
const CLASSIFICATION_DISPLAY = { RESIDENTIAL: "Residential", BUSINESS: "Commercial" } as const;

export const fullName = (t: Pick<TenantRow, "first_name" | "last_name">) => `${t.first_name} ${t.last_name}`.trim();

export function userName(id: number | null): string {
  if (!id) return "";
  const u = repos().users.get(id);
  return u ? `${u.first_name} ${u.last_name}`.trim() || u.email : "";
}

// ─── Buildings & units ───────────────────────────────────────────────────────
export function serializeUnit(unit: UnitRow): Unit {
  const r = repos();
  const building = r.buildings.get(unit.building);
  const tenant = occupantOf(unit);
  const head = unit.combined_into ? r.units.get(unit.combined_into) : null;
  const members = r.units.filter((u) => u.combined_into === unit.id);
  const status = unitStatus(unit);
  return {
    id: unit.id,
    building: unit.building,
    building_name: building?.name ?? "",
    label: unit.label,
    floor: unit.floor,
    unit_type: unit.unit_type,
    classification: unit.classification,
    classification_display: CLASSIFICATION_DISPLAY[unit.classification],
    monthly_rent: decStr(unit.monthly_rent),
    status,
    status_display: UNIT_STATUS_DISPLAY[status],
    notes: unit.notes,
    current_tenant_id: tenant?.id ?? null,
    current_tenant_name: tenant ? fullName(tenant) : null,
    combined_into: unit.combined_into,
    combined_into_label: head?.label ?? null,
    combined_units: members.map((m) => ({ id: m.id, label: m.label, monthly_rent: decStr(m.monthly_rent) })),
    space_label: members.length ? [unit.label, ...members.map((m) => m.label)].join(" + ") : unit.label,
    created_at: unit.created_at,
    updated_at: unit.updated_at,
    // Not in the shared type but returned by the API and read by the rent editor.
    ...({ statement_descriptor: unit.statement_descriptor, under_maintenance: unit.under_maintenance } as object),
  } as Unit;
}

export function serializeBuilding(b: BuildingRow): Building {
  const units = repos().units.filter((u) => u.building === b.id);
  return {
    id: b.id,
    name: b.name,
    address: b.address,
    total_floors: b.total_floors,
    property_type: b.property_type,
    property_type_display: PROPERTY_TYPE_DISPLAY[b.property_type],
    allows_income: b.property_type !== "expense_only",
    notes: b.notes,
    unit_count: units.length,
    occupied_count: units.filter((u) => occupantOf(u)).length,
    has_photo: Boolean(b.photo_file),
    photo_version: b.photo_version,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

export function serializeBuildingDetail(b: BuildingRow): BuildingDetail {
  const units = repos().units.filter((u) => u.building === b.id).sort(byLabel);
  return { ...serializeBuilding(b), units: units.map(serializeUnit) };
}

export const byLabel = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, undefined, { numeric: true });

// ─── Tenants ─────────────────────────────────────────────────────────────────
const STATUS_DISPLAY = {
  active: "Active", moved_out: "Moved Out", archived: "Archived", notice_given: "Notice Given",
} as const;
const KYC_DISPLAY = {
  not_started: "Not Started", pending: "Pending Review", verified: "Verified", rejected: "Rejected",
} as const;
const DOC_DISPLAY = {
  id_front: "ID — Front", id_back: "ID — Back", passport: "Passport",
  kra_pin_certificate: "KRA PIN Certificate", lease: "Lease", other: "Other",
} as const;

export function serializeTenant(t: TenantRow): TenantListItem {
  const r = repos();
  const unit = r.units.get(t.unit);
  const building = unit ? r.buildings.get(unit.building) : undefined;
  const balance = currentBalance(t.id);
  return {
    id: t.id,
    full_name: fullName(t),
    first_name: t.first_name,
    last_name: t.last_name,
    phone: t.phone,
    email: t.email,
    unit: t.unit,
    unit_label: unit?.label ?? "",
    building_name: building?.name ?? "",
    building_id: building?.id ?? 0,
    monthly_rent: decStr(t.monthly_rent),
    deposit_paid: decStr(t.deposit_paid),
    status: t.status,
    status_display: STATUS_DISPLAY[t.status],
    kyc_status: t.kyc_status,
    kyc_status_display: KYC_DISPLAY[t.kyc_status],
    balance: decStr(balance),
    payment_status: balance > 0 ? "in_arrears" : "paid",
    move_in_date: t.move_in_date,
    move_out_date: t.move_out_date,
    due_day: t.due_day,
    is_billable: t.is_billable,
  };
}

export function kycMissingItems(t: TenantRow): string[] {
  const docs = repos().documents.filter((d) => d.tenant === t.id).map((d) => d.doc_type);
  const missing: string[] = [];
  const hasPassport = docs.includes("passport");
  if (!hasPassport && !docs.includes("id_front")) missing.push("National ID — front");
  if (!hasPassport && !docs.includes("id_back")) missing.push("National ID — back");
  if (!t.kra_pin) missing.push("KRA PIN");
  return missing;
}

export function serializeTenantDetail(t: TenantRow): TenantDetail {
  const r = repos();
  const base = serializeTenant(t);
  const unit = r.units.get(t.unit);
  const members = unit ? r.units.filter((u) => u.combined_into === unit.id) : [];
  const space = unit ? [unit, ...members] : [];
  const expected = expectedDeposit(t);
  const totalPaid = r.payments
    .filter((p) => p.tenant === t.id && !p.voided_at && p.payment_type !== "deposit")
    .reduce((s, p) => s + p.amount, 0);
  const balance = Number(base.balance);
  const missing = kycMissingItems(t);
  const tenancies = r.tenants
    .filter((other) => other.id === t.id || (Boolean(t.id_number) && other.id_number === t.id_number))
    .sort((a, b) => a.move_in_date.localeCompare(b.move_in_date))
    .map((other) => {
      const u = r.units.get(other.unit);
      return {
        id: other.id,
        unit_label: u?.label ?? "",
        building_name: u ? r.buildings.get(u.building)?.name ?? "" : "",
        move_in_date: other.move_in_date,
        move_out_date: other.move_out_date,
        status: other.status,
        status_display: STATUS_DISPLAY[other.status],
      };
    });
  return {
    ...base,
    billing_frequency: t.billing_frequency,
    id_number: t.id_number,
    kra_pin: t.kra_pin,
    unit_classification: unit?.classification ?? "RESIDENTIAL",
    space_units: space.map((u) => ({ id: u.id, label: u.label, monthly_rent: decStr(u.monthly_rent) })),
    space_label: space.map((u) => u.label).join(" + "),
    care_of: t.care_of,
    emergency_contact: t.emergency_contact,
    emergency_phone: t.emergency_phone,
    deposit_months: depositMonths(t),
    expected_deposit: expected,
    deposit_shortfall: round2(Math.max(0, expected - t.deposit_paid)),
    agreed_deposit: t.agreed_deposit === null ? null : decStr(t.agreed_deposit),
    deposit_is_agreed: t.agreed_deposit !== null,
    deposit_refund_percentage: t.deposit_refund_percentage,
    deposit_refund_amount: decStr(t.deposit_refund_amount),
    notice_date: t.notice_date,
    intended_move_out_date: t.intended_move_out_date,
    move_out_notes: t.move_out_notes,
    notes: t.notes,
    total_paid: round2(totalPaid),
    total_arrears: round2(Math.max(0, balance)),
    kyc_complete: missing.length === 0,
    kyc_missing_items: t.kyc_status === "verified" ? [] : missing,
    kyc_verified_at: t.kyc_verified_at,
    kyc_verified_by: t.kyc_verified_by,
    kyc_verified_by_name: userName(t.kyc_verified_by) || null,
    kyc_notes: t.kyc_notes,
    tenancies,
    documents: r.documents.filter((d) => d.tenant === t.id).map((d) => ({
      id: d.id,
      tenant: d.tenant,
      doc_type: d.doc_type,
      doc_type_display: DOC_DISPLAY[d.doc_type],
      file: fileUrl(d.file_id),
      original_name: d.original_name,
      uploaded_at: d.uploaded_at,
    })),
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

/** Unit label and building name for anything keyed by tenant. */
export function tenantLabels(tenantId: number) {
  const r = repos();
  const t = r.tenants.get(tenantId);
  const unit = t ? r.units.get(t.unit) : undefined;
  return {
    tenant_name: t ? fullName(t) : "",
    unit_label: unit?.label ?? "",
    building_name: unit ? r.buildings.get(unit.building)?.name ?? "" : "",
    classification: unit?.classification ?? "RESIDENTIAL",
  };
}

// ─── Payments ────────────────────────────────────────────────────────────────
const SOURCE_DISPLAY = { mpesa: "M-Pesa", bank: "Bank Transfer", cash: "Cash", cheque: "Cheque" } as const;

export function serializePayment(p: PaymentRow) {
  const l = tenantLabels(p.tenant);
  return {
    id: p.id,
    tenant: p.tenant,
    tenant_name: l.tenant_name,
    unit_label: l.unit_label,
    building_name: l.building_name,
    amount: decStr(p.amount),
    payment_date: p.payment_date,
    period_month: p.period_month,
    period_year: p.period_year,
    source: p.source,
    source_display: SOURCE_DISPLAY[p.source],
    payment_type: p.payment_type,
    reference: p.reference,
    transaction_id: p.transaction ?? undefined,
    notes: p.notes,
    is_void: Boolean(p.voided_at),
    voided_at: p.voided_at,
    void_reason: p.void_reason,
    created_at: p.created_at,
  };
}

const MODE_DISPLAY = { MPESA: "M-Pesa", BANK: "Bank Transfer", CASH: "Cash", CHEQUE: "Cheque" } as const;

export function serializeTransaction(t: TransactionRow) {
  const l = tenantLabels(t.tenant);
  return {
    id: t.id,
    transaction_id: t.transaction_id,
    tenant: t.tenant,
    tenant_name: l.tenant_name,
    unit_label: l.unit_label,
    building_name: l.building_name,
    unit_classification: l.classification,
    unit_classification_display: CLASSIFICATION_DISPLAY[l.classification],
    base_amount: decStr(t.base_amount),
    tax_amount: decStr(t.tax_amount),
    total_amount: decStr(t.total_amount),
    payment_mode: t.payment_mode,
    payment_mode_display: MODE_DISPLAY[t.payment_mode],
    reference_code: t.reference_code,
    created_at: t.created_at,
  };
}

// ─── Charges ─────────────────────────────────────────────────────────────────
export const CHARGE_TYPE_DISPLAY = {
  utility: "Water / Utility", late_fee: "Late Payment Fee", parking: "Parking", damage: "Damage Recharge",
} as const;

export function serializeUtilityCharge(c: UtilityChargeRow) {
  const l = tenantLabels(c.tenant);
  const unit = repos().units.get(c.unit);
  return {
    id: c.id,
    tenant: c.tenant,
    tenant_name: l.tenant_name,
    unit_label: unit?.label ?? l.unit_label,
    building_name: l.building_name,
    posting_date: c.posting_date,
    period_month: c.period_month,
    period_year: c.period_year,
    label: c.label,
    opening_reading: dec(c.opening_reading),
    closing_reading: dec(c.closing_reading),
    units: dec(c.units),
    amount: decStr(c.amount),
    notes: c.notes,
    charge_type: c.charge_type,
    charge_type_display: CHARGE_TYPE_DISPLAY[c.charge_type],
    expense_category: c.expense_category,
    expense_category_name: c.expense_category ? repos().expenseCategories.get(c.expense_category)?.name ?? "" : "",
  };
}

// ─── Expenses & income ───────────────────────────────────────────────────────
export function serializeExpense(e: ExpenseRow) {
  const r = repos();
  return {
    id: e.id,
    date: e.date,
    building: e.building,
    building_name: e.building ? r.buildings.get(e.building)?.name ?? null : null,
    unit: e.unit,
    unit_label: e.unit ? r.units.get(e.unit)?.label ?? null : null,
    category: e.category,
    category_name: r.expenseCategories.get(e.category)?.name ?? "",
    amount: decStr(e.amount),
    description: e.description,
    reference: e.reference,
    period_month: e.period_month,
    period_year: e.period_year,
    notes: e.notes,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

export function serializeManualIncome(m: ManualIncomeRow) {
  const r = repos();
  const account = r.accounts.get(m.account);
  return {
    id: m.id,
    date: m.date,
    building: m.building,
    building_name: r.buildings.get(m.building)?.name ?? "",
    account: m.account,
    account_code: account?.code ?? "",
    account_name: account?.name ?? "",
    amount: decStr(m.amount),
    description: m.description,
    reference: m.reference,
    period_month: m.period_month,
    period_year: m.period_year,
    notes: m.notes,
  };
}

// ─── Credits & refunds ───────────────────────────────────────────────────────
const REASON_DISPLAY = {
  billing_correction: "Billing correction",
  rent_concession: "Rent concession",
  tenant_paid_cost: "Tenant paid a landlord cost",
  opening_credit: "Opening credit",
} as const;

export function refundedFromCredit(creditId: number) {
  return round2(
    repos().refunds
      .filter((f) => f.credit === creditId && (f.status === "sent" || f.status === "scheduled"))
      .reduce((s, f) => s + f.amount, 0),
  );
}

export function creditRemaining(c: CreditRow) {
  if (c.voided_at) return 0;
  return round2(Math.max(0, c.amount - c.amount_applied - refundedFromCredit(c.id)));
}

function creditStatusDisplay(c: CreditRow): "Available" | "Held" | "Partly used" | "Fully used" | "Void" {
  if (c.voided_at) return "Void";
  if (c.on_hold) return "Held";
  const remaining = creditRemaining(c);
  if (remaining <= 0) return "Fully used";
  return remaining < c.amount ? "Partly used" : "Available";
}

export function serializeCredit(c: CreditRow) {
  const r = repos();
  const refunded = refundedFromCredit(c.id);
  const history: { at: string; date: string; kind: "issued" | "applied" | "unapplied" | "refund" | "void"; text: string; amount: string }[] = [
    { at: c.created_at, date: c.credit_date, kind: "issued", text: `${c.number} issued — ${c.description}`, amount: decStr(c.amount) },
  ];
  if (c.amount_applied > 0) {
    history.push({ at: c.created_at, date: c.credit_date, kind: "applied", text: "Applied to what was owed", amount: decStr(c.amount_applied) });
  }
  for (const f of r.refunds.filter((f) => f.credit === c.id)) {
    history.push({ at: f.created_at, date: f.sent_on ?? f.created_at.slice(0, 10), kind: "refund", text: `${f.number} — refund ${f.status}`, amount: decStr(f.amount) });
  }
  if (c.voided_at) {
    history.push({ at: c.voided_at, date: c.voided_at.slice(0, 10), kind: "void", text: `Voided — ${c.void_reason}`, amount: decStr(c.amount) });
  }
  let corrects = "";
  if (c.charge) {
    const charge = r.charges.get(c.charge);
    if (charge) corrects = `Rent ${charge.period_month}/${charge.period_year}`;
  } else if (c.utility_charge) {
    corrects = r.utilityCharges.get(c.utility_charge)?.label ?? "";
  }
  return {
    id: c.id,
    number: c.number,
    tenant: c.tenant,
    credit_type: c.credit_type,
    credit_type_display: c.credit_type === "credit_note" ? "Credit note" : "Credit on account",
    reason: c.reason,
    reason_display: REASON_DISPLAY[c.reason],
    credit_date: c.credit_date,
    net_amount: decStr(c.net_amount),
    vat_amount: decStr(c.vat_amount),
    amount: decStr(c.amount),
    amount_applied: decStr(c.amount_applied),
    amount_refunded: decStr(refunded),
    remaining: decStr(creditRemaining(c)),
    status: c.voided_at ? "void" : "issued",
    status_display: creditStatusDisplay(c),
    is_void: Boolean(c.voided_at),
    on_hold: c.on_hold,
    description: c.description,
    internal_notes: c.internal_notes,
    reference: c.reference,
    has_evidence: Boolean(c.evidence_file),
    evidence_name: c.evidence_name,
    corrects,
    expense_category_name: c.expense_category ? r.expenseCategories.get(c.expense_category)?.name ?? "" : "",
    created_by_name: userName(c.created_by),
    created_at: c.created_at,
    approved_by_name: userName(c.created_by),
    approval_mode: "Owner",
    voided_at: c.voided_at,
    voided_by_name: userName(c.voided_by),
    void_reason: c.void_reason,
    history,
  };
}

const METHOD_DISPLAY = { mpesa: "M-Pesa", bank: "Bank Transfer", cash: "Cash", cheque: "Cheque" } as const;
const REFUND_STATUS_DISPLAY = { scheduled: "Scheduled", sent: "Sent", cancelled: "Cancelled", void: "Void" } as const;

export function serializeRefund(f: RefundRow) {
  const credit = f.credit ? repos().credits.get(f.credit) : null;
  return {
    id: f.id,
    number: f.number,
    tenant: f.tenant,
    amount: decStr(f.amount),
    method: f.method,
    method_display: METHOD_DISPLAY[f.method],
    paid_to: f.paid_to,
    reference: f.reference,
    notes: f.notes,
    status: f.status,
    status_display: REFUND_STATUS_DISPLAY[f.status],
    sent_on: f.sent_on,
    lines: [{ source: credit ? credit.number : "Overpayment", amount: decStr(f.amount) }],
    created_by_name: userName(f.created_by),
    created_at: f.created_at,
    sent_recorded_by_name: userName(f.sent_recorded_by),
    closed_by_name: userName(f.closed_by),
    close_reason: f.close_reason,
  };
}

// ─── Reconciliation, notifications, maintenance, audit ───────────────────────
export function serializeBankCredit(b: BankCreditRow) {
  return {
    id: b.id,
    transaction_id: b.transaction_id,
    payment_ref: b.payment_ref,
    account_number: b.account_number,
    amount: decStr(b.amount),
    channel: b.channel,
    narration: b.narration,
    detail: b.detail,
    status: b.status,
    received_at: b.received_at,
    payer_hint: { phone: b.payer_phone, name: b.payer_name },
    void_requeue_count: b.void_requeue_count,
  };
}

const CHANNEL_DISPLAY = { sms: "SMS (simulated)", email: "Email (simulated)", both: "SMS + Email (simulated)" } as const;

export function serializeNotification(n: NotificationRow) {
  const l = tenantLabels(n.tenant);
  return {
    id: n.id,
    tenant: n.tenant,
    tenant_name: l.tenant_name,
    unit_label: l.unit_label,
    channel: n.channel,
    channel_display: CHANNEL_DISPLAY[n.channel],
    subject: n.subject,
    body: n.body,
    status: n.status,
    sent_at: n.sent_at,
    error: n.error,
    template_key: n.template_key,
    created_at: n.created_at,
  };
}

export function serializeMaintenance(m: MaintenanceRow) {
  const unit = repos().units.get(m.unit);
  return {
    id: m.id,
    unit: m.unit,
    unit_label: unit?.label ?? "",
    description: m.description,
    cost: decStr(m.cost),
    reported_date: m.reported_date,
    status: m.status,
    status_display: { open: "Open", in_progress: "In Progress", resolved: "Resolved" }[m.status],
    notes: m.notes,
    created_at: m.created_at,
  };
}

export function serializeAudit(a: AuditRow) {
  const r = repos();
  const actor = a.actor ? r.users.get(a.actor) : undefined;
  return {
    ...a,
    actor_label: actor ? `${actor.first_name}`.trim() || actor.email : "",
    actor_role: actor?.role ?? "",
    ip_address: a.source === "web" ? "127.0.0.1" : null,
    user_agent: a.source === "web" ? navigatorAgent() : "",
    session_id: a.source === "web" ? "local-session" : "",
  };
}

function navigatorAgent() {
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}

export function isCurrentTenant(t: TenantRow) {
  return isCurrent(t);
}
