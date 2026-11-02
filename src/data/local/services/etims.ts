/**
 * eTIMS, simulated. Every VAT-able rent charge and credit note becomes an
 * invoice "sent" to KRA, with the control-unit number, a KRA invoice number
 * and a QR payload a real OSCU/VSCU integration would return. Nothing leaves
 * the browser.
 *
 * Failures are realistic: a business tenant with no KRA PIN cannot be named as
 * the buyer, so its invoice fails until the PIN is added; one other invoice
 * fails with a transient KRA timeout and succeeds on retry.
 */
import { database, repos } from "../context";
import type { TenantRow } from "../schema";
import { currentKey, isoDate, keyOfIso, monthKey, round2 } from "../util";
import { fullName, tenantLabels } from "./serializers";

export type EtimsStatus = "sent" | "failed";

export interface EtimsInvoice {
  id: string;
  kind: "invoice" | "credit_note";
  date: string;
  tenant_id: number;
  tenant_name: string;
  buyer_pin: string;
  unit_label: string;
  description: string;
  taxable: number;
  vat: number;
  total: number;
  status: EtimsStatus;
  error: string;
  kra_invoice_no: string;
  cu_serial: string;
  qr: string;
}

const CU_SERIAL = "KRACU0100004581";
const sellerPin = "P051234567X";

function kraNumber(seed: number) {
  return `${CU_SERIAL.slice(-4)}${String(1000000 + seed).slice(-7)}`;
}

export function etimsInvoices(months = 3): EtimsInvoice[] {
  const r = repos();
  const resubmitted = new Set(database().meta.etims_resubmitted ?? []);
  const now = currentKey();
  const out: EtimsInvoice[] = [];
  const pinOf = (t: TenantRow | undefined) => (t?.kra_pin ?? "").trim();
  let n = 0;
  for (const c of r.charges.all()) {
    if (c.is_opening || c.expected_vat <= 0) continue;
    const key = monthKey(c.period_year, c.period_month);
    if (key < now - months + 1 || key > now) continue;
    const t = r.tenants.get(c.tenant);
    const labels = tenantLabels(c.tenant);
    const taxable = round2(c.expected_rent - c.waived_amount);
    out.push(build(`INV-${c.id}`, "invoice", isoDate(c.period_year, c.period_month, 1), t, labels.unit_label,
      `Rent ${c.period_month}/${c.period_year}`, taxable, c.expected_vat, ++n));
  }
  for (const cr of r.credits.all()) {
    if (cr.voided_at || cr.on_hold || cr.vat_amount <= 0) continue;
    if (cr.credit_date < isoDate(Math.floor((now - months + 1) / 12), ((now - months + 1) % 12) + 1, 1)) continue;
    const t = r.tenants.get(cr.tenant);
    out.push(build(`CN-${cr.id}`, "credit_note", cr.credit_date, t, tenantLabels(cr.tenant).unit_label,
      `Credit note ${cr.number}`, -cr.net_amount, -cr.vat_amount, ++n));
  }
  out.sort((a, b) => b.date.localeCompare(a.date) || a.tenant_name.localeCompare(b.tenant_name));

  // One transient failure, so the retry path can be shown: the newest invoice
  // of the third business tenant that has a PIN.
  const withPin = [...new Set(out.filter((i) => i.buyer_pin && i.kind === "invoice").map((i) => i.tenant_id))];
  const flaky = withPin[2];
  const flakyInvoice = out.find((i) => i.tenant_id === flaky && i.kind === "invoice");
  if (flakyInvoice && !resubmitted.has(flakyInvoice.id)) {
    flakyInvoice.status = "failed";
    flakyInvoice.error = "KRA did not answer in time (simulated timeout). Retry to send it again.";
  }
  return out;

  function build(id: string, kind: EtimsInvoice["kind"], date: string, t: TenantRow | undefined, unit: string,
    description: string, taxable: number, vat: number, seq: number): EtimsInvoice {
    const pin = pinOf(t);
    const failed = !pin;
    const total = round2(taxable + vat);
    const kraNo = failed ? "" : kraNumber(seq + (resubmitted.has(id) ? 5000 : 0));
    return {
      id, kind, date, tenant_id: t?.id ?? 0, tenant_name: t ? fullName(t) : "Unknown", buyer_pin: pin, unit_label: unit,
      description, taxable: round2(taxable), vat: round2(vat), total, status: failed ? "failed" : "sent",
      error: failed ? "The tenant has no KRA PIN on file, so KRA cannot record them as the buyer. Add the PIN on the tenant's page, then retry." : "",
      kra_invoice_no: kraNo, cu_serial: CU_SERIAL,
      qr: failed ? "" : `https://itax.kra.go.ke/KRA-Portal/invoiceChk.htm?actionCode=loadPage&invoiceNo=${kraNo}`,
    };
  }
}

export function etimsSummary() {
  const list = etimsInvoices();
  const now = currentKey();
  const thisMonth = list.filter((i) => monthKey(Number(i.date.slice(0, 4)), Number(i.date.slice(5, 7))) === now);
  return {
    seller_pin: sellerPin,
    cu_serial: CU_SERIAL,
    environment: "sandbox (simulated)",
    sent_this_month: thisMonth.filter((i) => i.status === "sent").length,
    failed: list.filter((i) => i.status === "failed").length,
    vat_this_month: round2(thisMonth.filter((i) => i.status === "sent").reduce((s, i) => s + i.vat, 0)),
    ...monthlyRentalIncome(now),
  };
}

/** Retry one failed submission. A missing buyer PIN still fails until it is added. */
export function retryEtims(id: string): EtimsInvoice | null {
  const meta = database().meta;
  const before = etimsInvoices().find((i) => i.id === id);
  if (!before) return null;
  if (before.status === "sent") return before;
  if (!before.buyer_pin) return before;
  meta.etims_resubmitted = [...(meta.etims_resubmitted ?? []), id];
  database().markDirty("meta");
  return etimsInvoices().find((i) => i.id === id) ?? null;
}

/** Residential rent received in the month, the base for Monthly Rental Income tax (7.5%). An estimate only. */
function monthlyRentalIncome(key: number) {
  const r = repos();
  const residential = (tenantId: number) => {
    const t = r.tenants.get(tenantId);
    const u = t ? r.units.get(t.unit) : undefined;
    return u?.classification === "RESIDENTIAL";
  };
  const base = round2(r.payments
    .filter((p) => !p.voided_at && p.payment_type !== "deposit" && keyOfIso(p.payment_date) === key && residential(p.tenant))
    .reduce((s, p) => s + p.amount, 0));
  return { mri_base: base, mri_rate: 0.075, mri_estimate: round2(base * 0.075) };
}
