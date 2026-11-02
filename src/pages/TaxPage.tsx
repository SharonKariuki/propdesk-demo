/**
 * Tax & eTIMS. Rent invoices for VAT-registered lettings go to KRA's eTIMS as
 * they are raised; this page shows what was sent, what failed and why, and
 * the monthly figures an accountant files. In the demo every KRA response is
 * simulated (sandbox).
 */
import { AlertTriangle, CheckCircle2, Info, QrCode, RotateCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Money, Segmented } from "@/components/ds";
import { Badge, Button, Card, ErrorState, Modal, Skeleton } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { fmtDay } from "@/features/deposits/labels";
import { useCan } from "@/hooks/usePermission";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/apiError";

interface EtimsInvoice {
  id: string; kind: "invoice" | "credit_note"; date: string; tenant_id: number; tenant_name: string; buyer_pin: string;
  unit_label: string; description: string; taxable: number; vat: number; total: number;
  status: "sent" | "failed"; error: string; kra_invoice_no: string; cu_serial: string; qr: string;
}
interface EtimsData {
  summary: {
    seller_pin: string; cu_serial: string; environment: string; sent_this_month: number; failed: number; vat_this_month: number;
    mri_base: number; mri_rate: number; mri_estimate: number;
  };
  invoices: EtimsInvoice[];
}

const kes = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function TaxPage() {
  const qc = useQueryClient();
  const can = useCan();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ["etims"], queryFn: async () => (await api.get<EtimsData>("/tax/etims/")).data });
  const retry = useMutation({
    mutationFn: async (id: string) => (await api.post<EtimsInvoice>(`/tax/etims/${id}/retry/`)).data,
    onSuccess: (inv) => {
      toast.success(`Sent to eTIMS. KRA invoice ${inv.kra_invoice_no}`);
      void qc.invalidateQueries({ queryKey: ["etims"] });
    },
    onError: (e) => toast.error(getErrorMessage(e, "eTIMS did not accept the invoice."), { duration: 7000 }),
  });
  const [filter, setFilter] = useState<"all" | "failed">("all");
  const [shown, setShown] = useState<EtimsInvoice | null>(null);

  if (isError) return <ErrorState title="Tax figures could not be loaded." description="This is usually temporary." onRetry={() => void refetch()} />;
  const month = new Date().toLocaleString("en-GB", { month: "long" });
  const rows = (data?.invoices ?? []).filter((i) => filter === "all" || i.status === "failed");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax & eTIMS"
        description="Rent invoices on VAT-registered lettings are sent to KRA as they are raised. Corrections go through credit notes, never edits."
      />

      {isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" rounded="lg" />)}</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Sent to eTIMS, {month}</p>
              <p className="mt-1 text-2xl font-semibold num">{data.summary.sent_this_month}</p>
              <p className="text-[12.5px] text-content-muted">Control unit {data.summary.cu_serial}</p>
            </Card>
            <Card padding="md" className={data.summary.failed > 0 ? "border-warning/50" : ""}>
              <p className="text-[13px] text-content-muted">Need attention</p>
              <p className={`mt-1 text-2xl font-semibold num ${data.summary.failed > 0 ? "text-warning" : ""}`}>{data.summary.failed}</p>
              <p className="text-[12.5px] text-content-muted">{data.summary.failed > 0 ? "Not yet accepted by KRA" : "Everything accepted"}</p>
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">VAT on commercial rent, {month}</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.summary.vat_this_month} /></p>
              <p className="text-[12.5px] text-content-muted">16%, from accepted invoices</p>
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Monthly Rental Income tax (estimate)</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={data.summary.mri_estimate} /></p>
              <p className="text-[12.5px] text-content-muted">7.5% of KES {Math.round(data.summary.mri_base).toLocaleString()} residential rent received</p>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented label="Show" value={filter} onChange={setFilter} options={[{ value: "all", label: `All (${data.invoices.length})` }, { value: "failed", label: `Need attention (${data.summary.failed})` }]} />
            <Badge tone="ochre">eTIMS {data.summary.environment}</Badge>
          </div>

          <Table minWidth={900}>
            <THead><tr><TH>Date</TH><TH>Tenant</TH><TH>Document</TH><TH className="text-right">Taxable</TH><TH className="text-right">VAT</TH><TH className="text-right">Total</TH><TH>eTIMS</TH></tr></THead>
            <TBody>
              {rows.map((i) => (
                <TR key={i.id}>
                  <TD className="text-content-secondary">{fmtDay(i.date)}</TD>
                  <TD>
                    <Link to={`/tenants/${i.tenant_id}`} className="font-medium hover:underline">{i.tenant_name}</Link>
                    <div className="text-[12px] text-content-muted">{i.unit_label} · PIN {i.buyer_pin || "missing"}</div>
                  </TD>
                  <TD className="text-content-secondary">{i.kind === "credit_note" ? "Credit note" : "Invoice"}: {i.description}</TD>
                  <TD className="num text-right">{kes(i.taxable)}</TD>
                  <TD className="num text-right text-content-secondary">{kes(i.vat)}</TD>
                  <TD className="num text-right font-medium">{kes(i.total)}</TD>
                  <TD>
                    {i.status === "sent" ? (
                      <button type="button" onClick={() => setShown(i)} className="inline-flex items-center gap-1.5 text-[12.5px] text-success hover:underline">
                        <CheckCircle2 className="h-4 w-4" /> {i.kra_invoice_no}
                      </button>
                    ) : (
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-flex items-center gap-1.5 text-[12.5px] text-warning"><AlertTriangle className="h-4 w-4" /> Not accepted</span>
                        <span className="max-w-[260px] whitespace-normal text-[12px] text-content-muted">{i.error}</span>
                        {can("payments.record") && (
                          <Button size="sm" variant="outline" onClick={() => retry.mutate(i.id)} loading={retry.isPending && retry.variables === i.id}>
                            <RotateCw className="h-3.5 w-3.5" /> Retry
                          </Button>
                        )}
                      </div>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>

          <p className="flex items-start gap-2 text-[12.5px] text-content-muted">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Demo: no invoice is sent to KRA. A live connection needs KRA certification of the integration (OSCU or VSCU) and each landlord's own PIN and device keys.
            Residential and commercial rent, deposits and short-stay income are taxed differently; confirm treatment with a tax adviser.
          </p>
        </>
      )}

      {shown && (
        <Modal open onClose={() => setShown(null)} title={`KRA invoice ${shown.kra_invoice_no}`} size="sm" footer={<Button onClick={() => setShown(null)}>Done</Button>}>
          <div className="space-y-3 text-[13px]">
            <div className="flex items-center gap-3 rounded-lg bg-surface-sunk p-3">
              <QrCode className="h-14 w-14 text-content" aria-hidden />
              <p className="text-content-secondary">The receipt carries this QR code. Scanning it opens KRA's invoice checker. (Simulated link.)</p>
            </div>
            <dl className="grid grid-cols-2 gap-2">
              <dt className="text-content-muted">Buyer</dt><dd>{shown.tenant_name}</dd>
              <dt className="text-content-muted">Buyer PIN</dt><dd>{shown.buyer_pin}</dd>
              <dt className="text-content-muted">Control unit</dt><dd>{shown.cu_serial}</dd>
              <dt className="text-content-muted">Total</dt><dd>KES {kes(shown.total)}</dd>
            </dl>
          </div>
        </Modal>
      )}
    </div>
  );
}
