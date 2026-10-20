/** Tenants: roster, registration, edits, notice, move-out/in, KYC, statements. */
import type { DocumentType } from "@/lib/types";

import { repos } from "../context";
import { badRequest, created, fieldError, fileResponse, notFound, type LocalRequest, type Router } from "../http";
import type { PaymentSource, TenantRow } from "../schema";
import { logChange, logEvent } from "../services/audit";
import {
  buildLedger, currentBalance, ensureBilling, isCurrent, occupantOf, unitOf,
} from "../services/billing";
import { csvBlob } from "../services/documents";
import { saveFile } from "../services/files";
import { deliver } from "../services/notify";
import { recordPayment } from "../services/payments";
import {
  byLabel, fullName, serializePayment, serializeTenant, serializeTenantDetail, tenantLabels,
} from "../services/serializers";
import { statementPdf } from "../services/statements";
import {
  bodyObject, bool, contains, dateField, decStr, idParam, intField, keyOfIso, money, monthKey,
  nowIso, requiredStr, round2, str, todayIso,
} from "../util";

const SOURCES: PaymentSource[] = ["cash", "mpesa", "bank", "cheque"];
const DOC_TYPES: DocumentType[] = ["id_front", "id_back", "passport", "kra_pin_certificate", "lease", "other"];

export function getTenant(id: number): TenantRow {
  const t = repos().tenants.get(id);
  if (!t) throw notFound("Tenant not found.");
  return t;
}

const tenantOf = (req: LocalRequest) => getTenant(idParam(req.params.id));

function validateKraPin(value: unknown) {
  const pin = str(value).toUpperCase();
  if (pin && !/^[AP]\d{9}[A-Z]$/.test(pin)) throw fieldError("kra_pin", "Format: A007523148T");
  return pin;
}

function validateEmail(value: unknown) {
  const email = str(value);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw fieldError("email", "Enter a valid email address.");
  return email;
}

function vacantUnit(unitId: number) {
  const unit = repos().units.get(unitId);
  if (!unit) throw fieldError("unit", "Select a unit.");
  if (unit.combined_into || occupantOf(unit)) throw fieldError("unit", `${unit.label} is already let.`);
  return unit;
}

/** Book a deposit received as a DEPOSIT payment (DR 1030 / CR 2100). */
function bookDeposit(req: LocalRequest, tenant: TenantRow, amount: number, body: Record<string, unknown>, fallbackDate: string) {
  if (amount === 0) return;
  const source = (str(body.deposit_source) || "cash") as PaymentSource;
  if (!SOURCES.includes(source)) throw fieldError("deposit_source", `"${source}" is not a valid choice.`);
  const date = dateField(body.deposit_date || fallbackDate, "deposit_date")!;
  recordPayment(req, {
    tenant, amount, payment_date: date, period_month: Number(date.slice(5, 7)), period_year: Number(date.slice(0, 4)),
    source, payment_type: "deposit", reference: str(body.deposit_reference), notes: amount < 0 ? "Deposit correction" : "Security deposit",
  });
}

function filterTenants(q: URLSearchParams) {
  const r = repos();
  let list = [...r.tenants.all()];
  const status = q.get("status");
  const kyc = q.get("kyc_status");
  const building = q.get("building");
  const unit = q.get("unit");
  const search = (q.get("search") ?? q.get("q") ?? "").trim();
  const payment = q.get("payment_status");
  if (status) list = list.filter((t) => t.status === status);
  if (kyc) list = list.filter((t) => t.kyc_status === kyc);
  if (building) list = list.filter((t) => unitOf(t)?.building === Number(building));
  if (unit) list = list.filter((t) => t.unit === Number(unit));
  if (search) {
    list = list.filter((t) => {
      const l = tenantLabels(t.id);
      return [fullName(t), t.phone, t.email, t.id_number, l.unit_label, l.building_name].some((v) => contains(v, search));
    });
  }
  let rows = list.map(serializeTenant);
  if (payment) rows = rows.filter((t) => t.payment_status === payment);
  const order = { active: 0, notice_given: 1, moved_out: 2, archived: 3 } as const;
  return rows.sort((a, b) => order[a.status] - order[b.status] || byLabel({ label: a.unit_label }, { label: b.unit_label }));
}

/** Pay each charge oldest-first from everything received — the arrears subledger. */
function fifoArrears(tenantId: number) {
  const r = repos();
  const charges = r.charges
    .filter((c) => c.tenant === tenantId)
    .sort((a, b) => monthKey(a.period_year, a.period_month) - monthKey(b.period_year, b.period_month));
  const other = r.utilityCharges.filter((u) => u.tenant === tenantId);
  let pool = round2(
    r.payments.filter((p) => p.tenant === tenantId && !p.voided_at && p.payment_type !== "deposit").reduce((s, p) => s + p.amount, 0)
    + r.credits.filter((c) => c.tenant === tenantId && !c.voided_at && !c.on_hold).reduce((s, c) => s + c.amount, 0)
    - r.refunds.filter((f) => f.tenant === tenantId && f.status === "sent").reduce((s, f) => s + f.amount, 0),
  );
  return charges.map((c) => {
    const water = other
      .filter((u) => u.period_month === c.period_month && u.period_year === c.period_year)
      .reduce((s, u) => s + u.amount, 0);
    const expected = round2(c.expected_rent + c.expected_vat + water - c.waived_amount);
    const paid = round2(Math.max(0, Math.min(expected, pool)));
    pool = round2(pool - paid);
    return {
      period: `${c.period_month}/${c.period_year}`,
      expected: decStr(expected),
      expected_rent: decStr(c.expected_rent),
      expected_vat: decStr(c.expected_vat),
      paid: decStr(paid),
      balance: decStr(expected - paid),
    };
  });
}

function statementEmails(req: LocalRequest, ids: number[]) {
  const notifications = ids.map((id) => {
    const tenant = getTenant(id);
    const l = tenantLabels(id);
    const n = deliver({
      tenant,
      channel: "email",
      subject: `Your rent statement — ${l.unit_label}`,
      body: `Dear ${tenant.first_name}, please find attached your rent statement for ${l.unit_label}. Balance as at today: KES ${currentBalance(id).toLocaleString()}. (Demo — not actually emailed.)`,
      templateKey: "statement",
    });
    return {
      id: n.id, tenant: id, tenant_name: l.tenant_name, unit_label: l.unit_label,
      subject: n.subject, status: n.status, error: n.error,
    };
  });
  const sent = notifications.filter((n) => n.status === "sent").length;
  logEvent(req, { action: "statements_email", summary: `Emailed ${sent} statement(s) (simulated)`, objectType: "tenant", objectLabel: `${ids.length} tenant(s)` });
  return { sent, failed: notifications.length - sent, total: notifications.length, notifications };
}

export function registerTenants(router: Router) {
  router.get("/tenants/", (req) => filterTenants(req.query));

  router.get("/tenants/export/", (req) => {
    const rows = filterTenants(req.query);
    const blob = csvBlob(
      ["Name", "Phone", "Email", "Building", "Unit", "Monthly rent", "Deposit", "Balance", "Status", "KYC", "Moved in", "Moved out"],
      rows.map((t) => [t.full_name, t.phone, t.email, t.building_name, t.unit_label, t.monthly_rent, t.deposit_paid, t.balance, t.status_display, t.kyc_status_display, t.move_in_date, t.move_out_date ?? ""]),
    );
    return fileResponse(blob, "tenants.csv");
  });

  router.post("/tenants/", (req) => {
    const body = bodyObject(req.body);
    const unit = vacantUnit(intField(body.unit, "unit", { min: 1 }));
    const isBillable = bool(body.is_billable, true);
    const rent = money(body.monthly_rent, "monthly_rent");
    if (isBillable && rent <= 0) throw fieldError("monthly_rent", "Enter an amount greater than 0, or untick 'charge rent'.");
    const idNumber = requiredStr(body.id_number, "id_number");
    if (repos().tenants.find((t) => t.id_number === idNumber && isCurrent(t))) {
      throw fieldError("id_number", "A current tenant already has this ID number.");
    }
    const moveIn = dateField(body.move_in_date, "move_in_date")!;
    const deposit = money(body.deposit_paid || "0", "deposit_paid");
    if (body.deposit_date && str(body.deposit_date) < moveIn) throw fieldError("deposit_date", "Cannot be before the move-in date.");
    const dueDay = str(body.due_day) ? intField(body.due_day, "due_day", { min: 1, max: 31 }) : 5;
    const now = nowIso();
    const tenant = repos().tenants.insert({
      first_name: requiredStr(body.first_name, "first_name"),
      last_name: requiredStr(body.last_name, "last_name"),
      id_number: idNumber,
      kra_pin: validateKraPin(body.kra_pin),
      phone: requiredStr(body.phone, "phone"),
      email: validateEmail(body.email),
      care_of: str(body.care_of),
      emergency_contact: str(body.emergency_contact),
      emergency_phone: str(body.emergency_phone),
      unit: unit.id,
      monthly_rent: rent,
      deposit_paid: 0,
      agreed_deposit: null,
      deposit_refund_percentage: 100,
      deposit_refund_amount: 0,
      due_day: dueDay,
      is_billable: isBillable,
      billing_frequency: "monthly",
      status: "active",
      move_in_date: moveIn,
      move_out_date: null,
      notice_date: null,
      intended_move_out_date: null,
      move_out_notes: "",
      notes: str(body.notes),
      kyc_status: "not_started",
      kyc_verified_at: null,
      kyc_verified_by: null,
      kyc_notes: "",
      created_at: now,
      updated_at: now,
    });
    repos().units.update(unit.id, { vacant_since: null });
    bookDeposit(req, tenant, deposit, body, moveIn);
    ensureBilling(tenant);
    logEvent(req, { action: "tenant_create", summary: `Registered ${fullName(tenant)} in ${unit.label}`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant), financial: deposit > 0 });
    return created(serializeTenantDetail(tenant));
  });

  router.get("/tenants/:id/", (req) => serializeTenantDetail(tenantOf(req)));

  router.patch("/tenants/:id/", (req) => {
    const tenant = tenantOf(req);
    const body = bodyObject(req.body);
    const before = { ...tenant } as Record<string, unknown>;
    const patch: Partial<TenantRow> = {};
    const text = ["first_name", "last_name", "phone", "care_of", "emergency_contact", "emergency_phone", "notes"] as const;
    for (const key of text) {
      if (body[key] !== undefined) patch[key] = key === "first_name" || key === "last_name" || key === "phone" ? requiredStr(body[key], key) : str(body[key]);
    }
    if (body.id_number !== undefined) patch.id_number = requiredStr(body.id_number, "id_number");
    if (body.kra_pin !== undefined) patch.kra_pin = validateKraPin(body.kra_pin);
    if (body.email !== undefined) patch.email = validateEmail(body.email);
    if (body.monthly_rent !== undefined) patch.monthly_rent = money(body.monthly_rent, "monthly_rent");
    if (body.is_billable !== undefined) patch.is_billable = bool(body.is_billable, true);
    const billable = patch.is_billable ?? tenant.is_billable;
    if (billable && (patch.monthly_rent ?? tenant.monthly_rent) <= 0) {
      throw fieldError("monthly_rent", "Enter an amount greater than 0, or untick 'charge rent'.");
    }
    if (body.due_day !== undefined && str(body.due_day) !== "") patch.due_day = intField(body.due_day, "due_day", { min: 1, max: 31 });
    if (body.deposit_refund_percentage !== undefined) {
      patch.deposit_refund_percentage = intField(body.deposit_refund_percentage, "deposit_refund_percentage", { min: 0, max: 100 });
    }
    if (body.agreed_deposit !== undefined) {
      patch.agreed_deposit = body.agreed_deposit === null || str(body.agreed_deposit) === "" ? null : money(body.agreed_deposit, "agreed_deposit");
    }
    if (body.billing_frequency !== undefined) {
      const f = str(body.billing_frequency);
      if (f !== "monthly" && f !== "quarterly") throw fieldError("billing_frequency", `"${f}" is not a valid choice.`);
      patch.billing_frequency = f;
    }
    // A deposit edit moves money: the difference is booked as a deposit payment
    // so the statement and account 2100 follow it.
    let depositDelta = 0;
    if (body.deposit_paid !== undefined) {
      const next = money(body.deposit_paid || "0", "deposit_paid");
      depositDelta = round2(next - tenant.deposit_paid);
    }
    const updated = repos().tenants.update(tenant.id, { ...patch, updated_at: nowIso() });
    if (depositDelta !== 0) bookDeposit(req, updated, depositDelta, { deposit_source: "cash" }, todayIso());
    if (patch.is_billable !== undefined || patch.billing_frequency !== undefined) ensureBilling(updated);
    logChange(req, "tenant", tenant.id, fullName(updated), before, { ...patch, ...(depositDelta ? { deposit_paid: updated.deposit_paid } : {}) }, Boolean(depositDelta || patch.monthly_rent !== undefined));
    return serializeTenantDetail(repos().tenants.get(tenant.id)!);
  });

  router.post("/tenants/:id/move-out-notice/", (req) => {
    const tenant = tenantOf(req);
    if (tenant.status !== "active" && tenant.status !== "notice_given") throw badRequest("Only a current tenant can give notice.");
    const body = bodyObject(req.body);
    const notice = dateField(body.notice_date, "notice_date")!;
    const leaving = dateField(body.intended_move_out_date, "intended_move_out_date")!;
    if (leaving < notice) throw fieldError("intended_move_out_date", "Cannot be before the notice date.");
    const updated = repos().tenants.update(tenant.id, {
      status: "notice_given", notice_date: notice, intended_move_out_date: leaving,
      move_out_notes: str(body.notes), updated_at: nowIso(),
    });
    logEvent(req, { action: "notice", summary: `${fullName(tenant)} gave notice to leave on ${leaving}`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant) });
    return serializeTenantDetail(updated);
  });

  router.post("/tenants/:id/move-out/", (req) => {
    const tenant = tenantOf(req);
    if (!isCurrent(tenant)) throw badRequest("This tenant has already moved out.");
    const body = bodyObject(req.body);
    const date = dateField(body.move_out_date || todayIso(), "move_out_date")!;
    if (date < tenant.move_in_date) throw fieldError("move_out_date", "Cannot be before the move-in date.");
    const pct = body.deposit_refund_percentage === undefined ? tenant.deposit_refund_percentage
      : intField(body.deposit_refund_percentage, "deposit_refund_percentage", { min: 0, max: 100 });
    const r = repos();
    const updated = r.tenants.update(tenant.id, {
      status: "moved_out", move_out_date: date, deposit_refund_percentage: pct,
      deposit_refund_amount: round2((tenant.deposit_paid * pct) / 100),
      move_out_notes: str(body.notes) || tenant.move_out_notes, updated_at: nowIso(),
    });
    // Nothing is billed after the month they left; their units are free again.
    const lastKey = keyOfIso(date);
    for (const c of r.charges.filter((c) => c.tenant === tenant.id && monthKey(c.period_year, c.period_month) > lastKey)) r.charges.remove(c.id);
    r.units.update(tenant.unit, { vacant_since: date });
    for (const u of r.units.filter((u) => u.combined_into === tenant.unit)) r.units.update(u.id, { combined_into: null, vacant_since: date });
    logEvent(req, { action: "move_out", summary: `${fullName(tenant)} moved out (${pct}% of deposit refunded)`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant), financial: true });
    return serializeTenantDetail(updated);
  });

  router.post("/tenants/:id/move-in/", (req) => {
    const former = tenantOf(req);
    if (former.status !== "moved_out") throw badRequest("Only a tenant who has moved out can move in again.");
    const body = bodyObject(req.body);
    const unit = vacantUnit(intField(body.unit, "unit", { min: 1 }));
    const rent = money(body.monthly_rent, "monthly_rent", { allowZero: false });
    const moveIn = dateField(body.move_in_date, "move_in_date")!;
    if (former.move_out_date && moveIn < former.move_out_date) throw fieldError("move_in_date", "Cannot be before they last moved out.");
    const deposit = money(body.deposit_paid || "0", "deposit_paid");
    const now = nowIso();
    const identity: Partial<TenantRow> = { ...former };
    delete identity.id;
    const tenant = repos().tenants.insert({
      ...(identity as Omit<TenantRow, "id">),
      unit: unit.id, monthly_rent: rent, deposit_paid: 0, agreed_deposit: null,
      deposit_refund_percentage: 100, deposit_refund_amount: 0, status: "active",
      move_in_date: moveIn, move_out_date: null, notice_date: null, intended_move_out_date: null,
      move_out_notes: "", billing_frequency: "monthly", is_billable: true, created_at: now, updated_at: now,
    });
    repos().units.update(unit.id, { vacant_since: null });
    bookDeposit(req, tenant, deposit, body, moveIn);
    ensureBilling(tenant);
    logEvent(req, { action: "move_in_again", summary: `${fullName(tenant)} moved into ${unit.label} (new tenancy)`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant) });
    return created(serializeTenantDetail(tenant));
  });

  router.get("/tenants/:id/payment-history/", (req) => {
    const tenant = tenantOf(req);
    const payments = repos().payments
      .filter((p) => p.tenant === tenant.id && p.payment_type !== "deposit")
      .sort((a, b) => b.payment_date.localeCompare(a.payment_date) || b.id - a.id);
    const balance = currentBalance(tenant.id);
    return {
      total_paid: decStr(payments.filter((p) => !p.voided_at).reduce((s, p) => s + p.amount, 0)),
      total_arrears: decStr(Math.max(0, balance)),
      security_deposit: decStr(tenant.deposit_paid),
      monthly_ledger: buildLedger(tenant.id).slice(-24).map((r) => ({
        period: r.period, period_month: r.period_month, period_year: r.period_year, label: r.label,
        brought_forward: decStr(r.brought_forward), rent: decStr(r.rent), vat: decStr(r.vat),
        other_charges: decStr(r.other_charges), waived: decStr(r.waived), credits: decStr(r.credits),
        refunds: decStr(r.refunds), total_due: decStr(r.total_due), paid: decStr(r.paid),
        balance: decStr(r.balance), is_opening: r.is_opening,
      })),
      payments: payments.map((p) => {
        const s = serializePayment(p);
        return {
          id: s.id, amount: s.amount, payment_date: s.payment_date, period_month: s.period_month,
          period_year: s.period_year, source: s.source, reference: s.reference, is_void: s.is_void,
          voided_at: s.voided_at, void_reason: s.void_reason,
        };
      }),
      arrears: fifoArrears(tenant.id),
    };
  });

  router.get("/tenants/:id/statement-pdf/", (req) => {
    const tenant = tenantOf(req);
    return fileResponse(statementPdf(tenant), `Statement-${fullName(tenant).replace(/\s+/g, "-")}.pdf`);
  });

  router.post("/tenants/:id/email-statement/", (req) => created(statementEmails(req, [tenantOf(req).id])));

  router.post("/tenants/email-statements/", (req) => {
    const ids = bodyObject(req.body).tenant_ids;
    if (!Array.isArray(ids) || ids.length === 0) throw badRequest({ tenant_ids: ["Choose at least one tenant."] });
    return created(statementEmails(req, ids.map(Number)));
  });

  // ── KYC ──
  router.post("/tenants/:id/documents/", async (req) => {
    const tenant = tenantOf(req);
    const body = bodyObject(req.body);
    const file = body.file;
    if (!(file instanceof Blob)) throw badRequest({ file: ["No file was submitted."] });
    if (file.size > 10 * 1024 * 1024) throw badRequest({ file: ["Files must be under 10 MB."] });
    const docType = str(body.doc_type) as DocumentType;
    if (!DOC_TYPES.includes(docType)) throw fieldError("doc_type", `"${docType}" is not a valid choice.`);
    const fileId = await saveFile(file);
    const doc = repos().documents.insert({
      tenant: tenant.id, doc_type: docType, file_id: fileId,
      original_name: file instanceof File ? file.name : "document", uploaded_at: nowIso(),
    });
    if (tenant.kyc_status === "not_started" || tenant.kyc_status === "rejected") {
      repos().tenants.update(tenant.id, { kyc_status: "pending", updated_at: nowIso() });
    }
    logEvent(req, { action: "kyc_upload", summary: `Uploaded a KYC document for ${fullName(tenant)}`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant) });
    return created({ id: doc.id, tenant: tenant.id, doc_type: doc.doc_type, original_name: doc.original_name, uploaded_at: doc.uploaded_at });
  });

  router.post("/tenants/:id/verify-kyc/", (req) => {
    const tenant = tenantOf(req);
    const detail = serializeTenantDetail(tenant);
    if (detail.kyc_missing_items.length) {
      throw badRequest(`Cannot verify yet — still needed: ${detail.kyc_missing_items.join(", ")}.`);
    }
    const updated = repos().tenants.update(tenant.id, {
      kyc_status: "verified", kyc_verified_at: nowIso(), kyc_verified_by: req.user!.id, kyc_notes: "", updated_at: nowIso(),
    });
    logEvent(req, { action: "kyc_verify", summary: `Verified KYC for ${fullName(tenant)}`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant) });
    return serializeTenantDetail(updated);
  });

  router.post("/tenants/:id/reject-kyc/", (req) => {
    const tenant = tenantOf(req);
    const reason = requiredStr(bodyObject(req.body).reason, "reason");
    const updated = repos().tenants.update(tenant.id, { kyc_status: "rejected", kyc_notes: reason, updated_at: nowIso() });
    logEvent(req, { action: "kyc_reject", summary: `Rejected KYC for ${fullName(tenant)}: ${reason}`, objectType: "tenant", objectId: tenant.id, objectLabel: fullName(tenant) });
    return serializeTenantDetail(updated);
  });
}

