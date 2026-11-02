/**
 * Deposits: what is held for current tenants, refunds still owed, and how
 * every past deposit was settled. The register must agree with "Deposits
 * held" in the books; the check at the top says whether it does.
 */
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Money, Segmented } from "@/components/ds";
import { Badge, Card, ErrorState, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { fmtDay } from "@/features/deposits/labels";
import { useAccountingChecks, useDeposits } from "@/hooks/useDeposits";
import { useCan } from "@/hooks/usePermission";

const kes = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

export default function DepositsPage() {
  const { data, isLoading, isError, refetch } = useDeposits();
  const can = useCan();
  const checks = useAccountingChecks(can("accounting.view"));
  const [view, setView] = useState<"held" | "settled">("held");

  if (isError) return <ErrorState title="Deposits could not be loaded." description="This is usually temporary." onRetry={() => void refetch()} />;

  const depositCheck = checks.data?.checks.find((c) => c.key === "deposits");
  const refundCheck = checks.data?.checks.find((c) => c.key === "refunds");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deposits"
        description="A deposit belongs to the tenant until it is settled at move-out. It is never counted as rent."
      />

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24" rounded="lg" />)}</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Held for {data.totals.held_count} current tenants</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.totals.held} /></p>
              {data.totals.shortfall > 0 && (
                <p className="mt-1 text-[12.5px] text-warning">{data.totals.shortfall_count} tenants are KES {kes(data.totals.shortfall)} short in total</p>
              )}
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Refunds owed to tenants who left</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.totals.refunds_owed} /></p>
              <p className="mt-1 text-[12.5px] text-content-muted">
                {data.totals.refunds_owed_count === 0 ? "Nothing waiting to be sent" : `${data.totals.refunds_owed_count} waiting to be sent`}
              </p>
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Kept from deposits, last 12 months</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.totals.kept_last_12_months} /></p>
              <p className="mt-1 text-[12.5px] text-content-muted">Unpaid rent, damage and cleaning</p>
            </Card>
          </div>

          {depositCheck && refundCheck && (
            <div className={`flex items-start gap-2 rounded-lg border p-3 text-[13px] ${depositCheck.passed && refundCheck.passed ? "border-border bg-surface" : "border-warning/40 bg-warning-soft"}`}>
              {depositCheck.passed && refundCheck.passed
                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
              <p>
                {depositCheck.passed && refundCheck.passed
                  ? <>This register agrees with the books: KES {kes(depositCheck.ledger)} in Deposits held and KES {kes(refundCheck.ledger)} in Deposit refunds payable.</>
                  : <>The register and the books differ by KES {kes(Math.abs(depositCheck.difference) + Math.abs(refundCheck.difference))}. Open <Link className="underline" to="/accounting">Books</Link> to see the checks.</>}
              </p>
            </div>
          )}

          <Segmented
            label="Show"
            value={view}
            onChange={setView}
            options={[{ value: "held", label: `Held (${data.held.length})` }, { value: "settled", label: `Settled (${data.settled.length})` }]}
          />

          {view === "held" ? (
            <Table minWidth={720}>
              <THead><tr><TH>Tenant</TH><TH>Unit</TH><TH>Moved in</TH><TH className="text-right">Held</TH><TH className="text-right">Expected</TH><TH className="text-right">Short by</TH></tr></THead>
              <TBody>
                {data.held.map((r) => (
                  <TR key={r.tenant_id}>
                    <TD><Link to={`/tenants/${r.tenant_id}`} className="font-medium hover:underline">{r.tenant_name}</Link>{r.status === "notice_given" && <Badge tone="ochre" className="ml-2">Leaving</Badge>}</TD>
                    <TD className="text-content-secondary">{r.unit_label} · {r.building_name.split(" - ")[0]}</TD>
                    <TD className="text-content-secondary">{fmtDay(r.move_in_date)}</TD>
                    <TD className="num text-right">{kes(r.held)}</TD>
                    <TD className="num text-right text-content-secondary">{kes(r.expected)}</TD>
                    <TD className={`num text-right ${r.shortfall > 0 ? "text-warning" : "text-content-muted"}`}>{r.shortfall > 0 ? kes(r.shortfall) : "–"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <Table minWidth={820}>
              <THead><tr><TH>Tenant</TH><TH>Moved out</TH><TH className="text-right">Deposit</TH><TH className="text-right">To unpaid rent</TH><TH className="text-right">Kept</TH><TH className="text-right">Refund</TH><TH>Refund status</TH></tr></THead>
              <TBody>
                {data.settled.map((r) => (
                  <TR key={r.tenant_id}>
                    <TD><Link to={`/tenants/${r.tenant_id}`} className="font-medium hover:underline">{r.tenant_name}</Link><div className="text-[12px] text-content-muted">{r.unit_label} · {r.building_name.split(" - ")[0]}</div></TD>
                    <TD className="text-content-secondary">{fmtDay(r.move_out_date)}</TD>
                    <TD className="num text-right">{kes(r.held)}</TD>
                    <TD className="num text-right text-content-secondary">{r.applied_to_rent ? kes(r.applied_to_rent) : "–"}</TD>
                    <TD className="num text-right text-content-secondary">{r.kept ? kes(r.kept) : "–"}</TD>
                    <TD className="num text-right font-medium">{kes(r.refund)}</TD>
                    <TD>
                      {r.refund_status === "sent" && <Badge tone="paid" withDot>Sent {fmtDay(r.refund_sent_on)}</Badge>}
                      {r.refund_status === "pending" && <Link to={`/tenants/${r.tenant_id}`}><Badge tone="partial" withDot>Owed: record when sent</Badge></Link>}
                      {r.refund_status === "none" && <Badge tone="neutral">No refund due</Badge>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}
    </div>
  );
}
