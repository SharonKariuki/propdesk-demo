/**
 * The deposit on a tenant's page: what is held while they live there, and,
 * once they have left, exactly how it was settled and whether the refund has
 * gone out. The refund is recorded here when it is sent.
 */
import { CheckCircle2, Download, Send } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";

import { Money } from "@/components/ds";
import { Badge, Button, Card, Modal } from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { Field, inputCls } from "@/features/tenants/shared";
import { useCan } from "@/hooks/usePermission";
import { useSendDepositRefund } from "@/hooks/useTenants";
import { getErrorMessage } from "@/lib/apiError";
import { downloadPdf } from "@/lib/downloadPdf";
import type { TenantDetail } from "@/lib/types";

import { DEDUCTION_KINDS, fmtDay } from "./labels";

const METHOD = { mpesa: "M-Pesa", bank: "Bank transfer", cheque: "Cheque", "": "" } as const;

export function DepositCard({ tenant }: { tenant: TenantDetail }) {
  const s = tenant.deposit_settlement;
  const [sending, setSending] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const can = useCan();
  const canRefund = can("credits.manage");
  const canStatements = can("tenants.statements");

  const download = async () => {
    setDownloading(true);
    try {
      await downloadPdf(`/tenants/${tenant.id}/settlement-pdf/`, `Deposit-settlement-${tenant.full_name}.pdf`);
    } catch (e) {
      toast.error(getErrorMessage(e, "Could not download the settlement."));
    } finally {
      setDownloading(false);
    }
  };

  if (!s) {
    const short = Number(tenant.deposit_shortfall) || 0;
    return (
      <Card padding="md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-content">Deposit</h2>
            <p className="text-[12.5px] text-content-muted">Held for the tenant. It is settled when they move out.</p>
          </div>
          <p className="text-xl font-semibold"><Money value={Number(tenant.deposit_paid) || 0} /></p>
        </div>
        {short > 0 && (
          <p className="mt-2 text-[12.5px] text-warning">KES {short.toLocaleString()} short of the expected KES {Number(tenant.expected_deposit).toLocaleString()}.</p>
        )}
      </Card>
    );
  }

  const status = s.refund_status;
  return (
    <Card padding="md" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-content">Deposit settlement</h2>
          <p className="text-[12.5px] text-content-muted">Settled at move-out on {fmtDay(tenant.move_out_date)}</p>
        </div>
        {status === "sent" && <Badge tone="paid" withDot>Refund sent</Badge>}
        {status === "pending" && <Badge tone="partial" withDot>Refund owed</Badge>}
        {status === "none" && <Badge tone="neutral">No refund due</Badge>}
      </div>

      <table className="w-full text-[13px]">
        <tbody>
          <tr><td className="py-1">Deposit held</td><td className="num py-1 text-right"><Money value={s.held} /></td></tr>
          {s.deductions.map((d, i) => (
            <tr key={i} className="text-content-secondary">
              <td className="py-1">
                Less {DEDUCTION_KINDS.find((k) => k.value === d.kind)?.label.toLowerCase() ?? d.kind}
                {d.label && <span className="text-content-muted">: {d.label}</span>}
                {d.kind === "unpaid_rent" && <span className="ml-1 text-[11.5px] text-content-muted">(credited to the rent account)</span>}
              </td>
              <td className="num py-1 text-right">({d.amount.toLocaleString("en-KE")})</td>
            </tr>
          ))}
          <tr className="border-t border-border font-semibold">
            <td className="pt-2">Refund to the tenant</td><td className="num pt-2 text-right"><Money value={s.refund} /></td>
          </tr>
        </tbody>
      </table>

      {status === "sent" && (
        <p className="flex items-center gap-2 text-[12.5px] text-content-secondary">
          <CheckCircle2 className="h-4 w-4 text-success" />
          Sent {fmtDay(s.refund_sent_on)} by {METHOD[s.refund_method]}, reference {s.refund_reference}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "pending" && canRefund && (
          <Button size="sm" onClick={() => setSending(true)}><Send className="h-3.5 w-3.5" /> Record refund sent</Button>
        )}
        {canStatements && (
          <Button size="sm" variant="outline" onClick={download} loading={downloading}><Download className="h-3.5 w-3.5" /> Settlement statement</Button>
        )}
      </div>

      {sending && <RefundSentModal tenant={tenant} amount={s.refund} onClose={() => setSending(false)} />}
    </Card>
  );
}

function RefundSentModal({ tenant, amount, onClose }: { tenant: TenantDetail; amount: number; onClose: () => void }) {
  const send = useSendDepositRefund(tenant.id);
  const d = new Date();
  const [method, setMethod] = useState<"mpesa" | "bank" | "cheque">("mpesa");
  const [reference, setReference] = useState("");
  const [sentOn, setSentOn] = useState(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  const [tried, setTried] = useState(false);

  const save = async () => {
    setTried(true);
    if (!reference.trim()) return;
    try {
      await send.mutateAsync({ method, reference: reference.trim(), sent_on: sentOn });
      toast.success(`Refund of KES ${amount.toLocaleString()} recorded as sent`);
      onClose();
    } catch (e) {
      toast.error(getErrorMessage(e, "The refund could not be recorded."));
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Record the KES ${amount.toLocaleString()} refund`}
      size="sm"
      footer={<div className="flex w-full justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save} loading={send.isPending}>Record refund sent</Button></div>}
    >
      <div className="space-y-3">
        <p className="text-[13px] text-content-muted">Record this after the money has left the deposit account. It appears on {tenant.full_name}'s statement and clears the refund from the books.</p>
        <Field label="Paid by">
          <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={inputCls}>
            <option value="mpesa">M-Pesa</option>
            <option value="bank">Bank transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </Field>
        <Field label={method === "mpesa" ? "M-Pesa code *" : method === "bank" ? "Bank reference *" : "Cheque number *"} error={tried && !reference.trim() ? "Enter the reference so the refund can be traced." : undefined}>
          <input value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} className={inputCls} placeholder={method === "mpesa" ? "e.g. SLK4H7Q2XR" : ""} />
        </Field>
        <DatePicker label="Date sent" value={sentOn} onChange={(e) => setSentOn(e.target.value)} />
      </div>
    </Modal>
  );
}
