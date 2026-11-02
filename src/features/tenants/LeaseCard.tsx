/**
 * The lease, as the demo knows it: the term runs in yearly periods from the
 * move-in date, the rent and deposit come from the tenancy, and the signed
 * copy is the uploaded "Signed lease" document. Renewal reminders start 90
 * days out. A lease is a contract, so it is kept apart from KYC (identity).
 */
import { FileCheck2, FileWarning } from "lucide-react";

import { Badge, Card } from "@/components/ui";
import { fmtDay } from "@/features/deposits/labels";
import type { TenantDetail } from "@/lib/types";

function nextRenewal(moveIn: string, today: string) {
  const [, m, d] = moveIn.split("-").map(Number);
  let y = Number(today.slice(0, 4));
  const at = (yy: number) => `${yy}-${String(m).padStart(2, "0")}-${String(Math.min(d, 28)).padStart(2, "0")}`;
  if (at(y) < today) y += 1;
  return at(y);
}

export function LeaseCard({ tenant }: { tenant: TenantDetail }) {
  const today = new Date().toISOString().slice(0, 10);
  const current = tenant.status === "active" || tenant.status === "notice_given";
  const signed = (tenant.documents ?? []).filter((d) => d.doc_type === "lease").sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const renewal = nextRenewal(tenant.move_in_date, today);
  const days = Math.round((Date.parse(renewal) - Date.parse(today)) / 86_400_000);
  const rent = Number(tenant.monthly_rent) || 0;

  return (
    <Card padding="md" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-content">Lease</h2>
          <p className="text-[12.5px] text-content-muted">Yearly term from {fmtDay(tenant.move_in_date)}</p>
        </div>
        {tenant.status === "notice_given" && <Badge tone="ochre" withDot>Leaving {fmtDay(tenant.intended_move_out_date)}</Badge>}
        {tenant.status === "active" && days <= 90 && <Badge tone="partial" withDot>Renews in {days} days</Badge>}
        {!current && <Badge tone="neutral">Ended {fmtDay(tenant.move_out_date)}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
        <div><dt className="text-content-muted">Rent</dt><dd className="num font-medium">KES {rent.toLocaleString()} {tenant.billing_frequency === "quarterly" ? "a month, billed quarterly" : "a month"}</dd></div>
        <div><dt className="text-content-muted">Due</dt><dd className="font-medium">By the 5th</dd></div>
        <div><dt className="text-content-muted">Deposit</dt><dd className="num font-medium">KES {Number(tenant.expected_deposit).toLocaleString()}</dd></div>
        <div><dt className="text-content-muted">{current ? "Next renewal" : "Moved out"}</dt><dd className="font-medium">{current ? fmtDay(renewal) : fmtDay(tenant.move_out_date)}</dd></div>
      </dl>
      {signed.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <FileCheck2 className="h-4 w-4 text-success" />
          <a href={signed[0].file} target="_blank" rel="noreferrer" className="font-medium underline">{signed[0].original_name}</a>
          <span className="text-content-muted">signed copy uploaded {fmtDay(signed[0].uploaded_at.slice(0, 10))}{signed.length > 1 ? `, ${signed.length - 1} earlier version${signed.length > 2 ? "s" : ""}` : ""}</span>
        </p>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-warning">
          <FileWarning className="h-4 w-4" /> No signed lease on file. Upload it under Documents as "Signed lease".
        </p>
      )}
    </Card>
  );
}
