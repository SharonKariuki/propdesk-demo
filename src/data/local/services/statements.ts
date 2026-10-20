/** Tenant statement and payment receipt PDFs. */
import { repos } from "../context";
import type { TenantRow, TransactionRow } from "../schema";
import { monthLabel, todayIso } from "../util";
import { buildLedger, currentBalance } from "./billing";
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
          ["Deposit held", `KES ${kes(tenant.deposit_paid)}`],
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
