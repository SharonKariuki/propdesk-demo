/** Tenant statement and payment receipt PDFs. */
import { repos } from "../context";
import type { TenantRow, TransactionRow } from "../schema";
import { monthLabel, todayIso } from "../util";
import { buildLedger, currentBalance } from "./billing";
import { settlementOf } from "./deposits";
import { pdfBlob } from "./documents";
import { fullName, tenantLabels } from "./serializers";

const kes = (n: number) => {
  const text = Math.abs(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `(${text})` : text;
};

export const BRAND = "Mawingu Properties";
export const BRAND_LINE = "Mawingu Properties - Property Management (demo)";

export function statementPdf(tenant: TenantRow): Blob {
  const labels = tenantLabels(tenant.id);
  const rows = buildLedger(tenant.id).slice(-12);
  const balance = currentBalance(tenant.id);
  const showVat = rows.some((r) => r.vat > 0);
  const columns = [
    { label: "Month" }, { label: "B/F", align: "right" as const }, { label: "Rent", align: "right" as const },
    ...(showVat ? [{ label: "VAT", align: "right" as const }] : []),
    { label: "Other", align: "right" as const }, { label: "Paid", align: "right" as const },
    { label: "Credits", align: "right" as const }, { label: "Balance", align: "right" as const },
  ];
  return pdfBlob({
    title: "Rent Statement",
    subtitle: [BRAND_LINE, `Statement date: ${todayIso()}`],
    sections: [
      {
        pairs: [
          ["Tenant", tenant.care_of ? `${fullName(tenant)} (c/o ${tenant.care_of})` : fullName(tenant)],
          ["Unit", `${labels.building_name} - ${labels.unit_label}`],
          ["Monthly rent", `KES ${kes(tenant.monthly_rent)}`],
          ["Deposit", depositLine(tenant)],
        ],
      },
      {
        heading: "Month by month",
        table: {
          columns,
          rows: rows.map((r) => [
            monthLabel(r.period_year, r.period_month), kes(r.brought_forward), kes(r.rent),
            ...(showVat ? [kes(r.vat)] : []), kes(r.other_charges), kes(r.paid), kes(r.credits), kes(r.balance),
          ]),
        },
      },
      { pairs: [["Unpaid balance", `KES ${kes(balance)}`]] },
      ...depositSection(tenant),
    ],
    footnote: "Demo statement generated from synthetic data. A negative balance (in brackets) is a credit carried forward.",
  });
}

export function receiptPdf(txn: TransactionRow): Blob {
  const labels = tenantLabels(txn.tenant);
  const payment = repos().payments.get(txn.payment);
  const tax = txn.tax_amount > 0;
  return pdfBlob({
    title: "Payment Receipt",
    subtitle: [BRAND_LINE, `Receipt ${txn.transaction_id}`],
    sections: [
      {
        pairs: [
          ["Received from", labels.tenant_name],
          ["Unit", `${labels.building_name} - ${labels.unit_label}`],
          ["Date", payment?.payment_date ?? txn.created_at.slice(0, 10)],
          ["For period", payment ? monthLabel(payment.period_year, payment.period_month) : ""],
          ["Mode", txn.payment_mode],
          ["Reference", txn.reference_code || "-"],
          ...(tax
            ? ([["Base amount", `KES ${kes(txn.base_amount)}`], ["VAT (16%)", `KES ${kes(txn.tax_amount)}`]] as [string, string][])
            : []),
          ["Total received", `KES ${kes(txn.total_amount)}`],
          ["Balance after payment", `KES ${kes(currentBalance(txn.tenant))}`],
        ],
      },
    ],
    footnote: "Demo receipt - synthetic data, not a tax document.",
  });
}

const DEDUCTION_LABEL: Record<string, string> = {
  unpaid_rent: "Unpaid rent", damage: "Damage and repairs", cleaning: "Cleaning", utilities: "Unpaid utilities", other: "Other",
};
const METHOD_LABEL: Record<string, string> = { mpesa: "M-Pesa", bank: "Bank transfer", cheque: "Cheque" };

/** One line for the statement header: what is held now, or how it was settled. */
function depositLine(tenant: TenantRow) {
  if (tenant.status !== "moved_out") return `KES ${kes(tenant.deposit_paid)} held`;
  const s = settlementOf(tenant);
  return `KES ${kes(s.held)} settled at move-out, KES ${kes(s.refund)} refunded`;
}

/** The deposit's own movements, shown on the statement once the tenant has left. */
function depositSection(tenant: TenantRow) {
  if (tenant.status !== "moved_out" || !tenant.move_out_date) return [];
  const s = settlementOf(tenant);
  const rows: string[][] = [[tenant.move_in_date, "Deposit received", kes(s.held), kes(s.held)]];
  let left = s.held;
  for (const d of tenant.deposit_deductions ?? []) {
    left -= d.amount;
    rows.push([tenant.move_out_date, `${DEDUCTION_LABEL[d.kind] ?? d.kind}: ${d.label}${d.kind === "unpaid_rent" ? " (applied to your account)" : ""}`, `(${kes(d.amount)})`, kes(left)]);
  }
  if (s.refund > 0) {
    left -= s.refund;
    rows.push([
      tenant.refund_sent_on ?? tenant.move_out_date,
      tenant.refund_status === "sent" ? `Refund sent by ${METHOD_LABEL[tenant.refund_method] ?? "transfer"} (${tenant.refund_reference})` : "Refund owed to you (not yet sent)",
      `(${kes(s.refund)})`, kes(tenant.refund_status === "sent" ? left : left + s.refund),
    ]);
  }
  return [{
    heading: "Security deposit",
    table: {
      columns: [{ label: "Date" }, { label: "Item" }, { label: "Amount", align: "right" as const }, { label: "Deposit left", align: "right" as const }],
      rows,
    },
  }];
}

/** The settlement statement given to a tenant who has moved out. */
export function settlementPdf(tenant: TenantRow): Blob {
  const labels = tenantLabels(tenant.id);
  const s = settlementOf(tenant);
  const deductions = tenant.deposit_deductions ?? [];
  return pdfBlob({
    title: "Deposit Settlement",
    subtitle: [BRAND_LINE, `Issued ${todayIso()}`],
    sections: [
      {
        pairs: [
          ["Tenant", fullName(tenant)],
          ["Unit", `${labels.building_name} - ${labels.unit_label}`],
          ["Moved in", tenant.move_in_date],
          ["Moved out", tenant.move_out_date ?? ""],
        ],
      },
      {
        heading: "How your refund was worked out",
        table: {
          columns: [{ label: "Item" }, { label: "KES", align: "right" as const }],
          rows: [
            ["Deposit held", kes(s.held)],
            ...deductions.map((d) => [`Less ${DEDUCTION_LABEL[d.kind] ?? d.kind}: ${d.label}`, `(${kes(d.amount)})`]),
            ["Refund due to you", kes(s.refund)],
          ],
        },
      },
      {
        pairs: [
          ["Refund status", tenant.refund_status === "sent"
            ? `Sent ${tenant.refund_sent_on} by ${METHOD_LABEL[tenant.refund_method] ?? "transfer"}, ref ${tenant.refund_reference}`
            : s.refund > 0 ? "To be sent" : "No refund due"],
          ["Account balance after settlement", `KES ${kes(currentBalance(tenant.id))}`],
        ],
      },
    ],
    footnote: "Unpaid rent deducted from the deposit has been credited to your rent account. Demo document - synthetic data.",
  });
}
