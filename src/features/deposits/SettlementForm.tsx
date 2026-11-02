/**
 * Move-out with a deposit settlement. The person settling sees the deposit,
 * the tenant's balance and every deduction on one screen, and can give the
 * refund as an amount or a percentage. The form will not submit until the
 * deductions and the refund add up to the deposit exactly.
 */
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Money, Segmented } from "@/components/ds";
import { Button, Card } from "@/components/ui";
import { DatePicker } from "@/components/ui/DatePicker";
import { Field, inputCls } from "@/features/tenants/shared";
import { useMoveOutTenant } from "@/hooks/useTenants";
import { getErrorMessage } from "@/lib/apiError";
import type { DepositDeductionKind, TenantDetail } from "@/lib/types";

import { DEDUCTION_KINDS } from "./labels";


interface Line { key: number; kind: DepositDeductionKind; label: string; amount: string }

const kes = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function SettlementForm({ tenant, onDone, onCancel }: { tenant: TenantDetail; onDone: () => void; onCancel: () => void }) {
  const moveOut = useMoveOutTenant(tenant.id);
  const held = round2(Number(tenant.deposit_paid) || 0);
  const owes = Math.max(0, round2(tenant.current_balance ?? Number(tenant.total_arrears)));

  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>(() =>
    owes > 0 && held > 0 ? [{ key: 1, kind: "unpaid_rent", label: "Rent owed at move-out", amount: String(Math.min(owes, held)) }] : [],
  );
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  // Null = the refund follows the deductions (the usual case).
  const [refundInput, setRefundInput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deducted = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const rentDeducted = round2(lines.filter((l) => l.kind === "unpaid_rent").reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const followRefund = Math.max(0, round2(held - deducted));
  const refund = useMemo(() => {
    if (refundInput === null || refundInput === "") return followRefund;
    const n = Number(refundInput) || 0;
    return mode === "percent" ? round2((held * Math.min(100, Math.max(0, n))) / 100) : round2(n);
  }, [refundInput, mode, held, followRefund]);
  const gap = round2(held - deducted - refund);
  const pct = held > 0 ? round2((refund / held) * 100) : 0;
  const rentTooHigh = rentDeducted > owes + 0.01;
  const blankReason = lines.some((l) => l.kind === "other" && !l.label.trim());
  const canSubmit = Math.abs(gap) < 0.01 && !rentTooHigh && !blankReason && lines.every((l) => Number(l.amount) > 0);

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const add = (kind: DepositDeductionKind, amount = "") =>
    setLines((ls) => [...ls, { key: Math.max(0, ...ls.map((l) => l.key)) + 1, kind, label: "", amount }]);

  const submit = async () => {
    setError(null);
    try {
      await moveOut.mutateAsync({
        move_out_date: date,
        notes,
        deductions: lines.map((l) => ({ kind: l.kind, label: l.label.trim(), amount: Number(l.amount) })),
        refund_amount: refund,
      });
      toast.success(refund > 0 ? `Moved out. KES ${kes(refund)} refund is now owed to the tenant.` : "Moved out. The deposit is settled.");
      onDone();
    } catch (e) {
      setError(getErrorMessage(e, "The settlement could not be saved."));
    }
  };

  return (
    <Card padding="md" className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-content">Move out and settle the deposit</h2>
        <p className="text-[13px] text-content-muted">
          The unit becomes vacant and rent stops after the move-out month. Deductions and the refund must add up to the deposit.
        </p>
      </div>

      {/* What we start from: no need to look anything up on another screen. */}
      <dl className="grid grid-cols-3 gap-3 rounded-lg bg-surface-sunk p-3 text-[13px]">
        <div>
          <dt className="text-content-muted">Deposit held</dt>
          <dd className="text-lg font-semibold"><Money value={held} /></dd>
        </div>
        <div>
          <dt className="text-content-muted">Tenant owes now</dt>
          <dd className={owes > 0 ? "text-lg font-semibold text-danger" : "text-lg font-semibold"}><Money value={owes} /></dd>
        </div>
        <div>
          <dt className="text-content-muted">Refund</dt>
          <dd className="text-lg font-semibold"><Money value={refund} /> <span className="text-[12px] font-normal text-content-muted">({pct}%)</span></dd>
        </div>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <DatePicker label="Move-out date *" value={date} onChange={(e) => setDate(e.target.value)} />
        <Field label="Notes for the file">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="e.g. Keys returned, meter read 1,204" />
        </Field>
      </div>

      <section aria-labelledby="deductions-title" className="space-y-2">
        <div className="flex items-baseline justify-between">
          <h3 id="deductions-title" className="text-sm font-semibold text-content">Deductions</h3>
          <span className="text-[12px] text-content-muted">Total <Money value={deducted} /></span>
        </div>
        {lines.length === 0 && (
          <p className="rounded-md border border-dashed border-border-strong p-3 text-[13px] text-content-muted">
            No deductions. The full deposit is refunded.
          </p>
        )}
        {lines.map((l) => {
          const meta = DEDUCTION_KINDS.find((k) => k.value === l.kind)!;
          return (
            <div key={l.key} className="grid grid-cols-[1fr_auto] items-start gap-2 sm:grid-cols-[180px_1fr_140px_auto]">
              <select
                aria-label="Reason"
                value={l.kind}
                onChange={(e) => update(l.key, { kind: e.target.value as DepositDeductionKind })}
                className={inputCls}
              >
                {DEDUCTION_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select>
              <button type="button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label="Remove deduction" className="row-span-1 flex h-10 w-10 items-center justify-center rounded-md text-content-muted hover:bg-hover hover:text-danger sm:order-last">
                <Trash2 className="h-4 w-4" />
              </button>
              <input
                aria-label="Description"
                value={l.label}
                onChange={(e) => update(l.key, { label: e.target.value })}
                className={inputCls}
                placeholder={l.kind === "other" ? "What is this for? (required)" : meta.hint}
              />
              <input
                aria-label="Amount in KES"
                inputMode="decimal"
                value={l.amount}
                onChange={(e) => update(l.key, { amount: e.target.value.replace(/[^\d.]/g, "") })}
                className={`${inputCls} text-right tabular-nums`}
                placeholder="KES"
              />
            </div>
          );
        })}
        <div className="flex flex-wrap gap-2 pt-1">
          {owes > 0 && !lines.some((l) => l.kind === "unpaid_rent") && (
            <Button size="sm" variant="outline" onClick={() => add("unpaid_rent", String(Math.min(owes, held)))}>
              <Plus className="h-3.5 w-3.5" /> Unpaid rent (KES {kes(Math.min(owes, held))})
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => add("damage")}><Plus className="h-3.5 w-3.5" /> Damage</Button>
          <Button size="sm" variant="outline" onClick={() => add("cleaning")}><Plus className="h-3.5 w-3.5" /> Cleaning</Button>
          <Button size="sm" variant="ghost" onClick={() => add("other")}><Plus className="h-3.5 w-3.5" /> Other</Button>
        </div>
        {rentTooHigh && (
          <p className="text-[12.5px] text-danger" role="alert">Unpaid rent deducted is more than the KES {kes(owes)} the tenant owes.</p>
        )}
      </section>

      <section aria-labelledby="refund-title" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="refund-title" className="text-sm font-semibold text-content">Refund to the tenant</h3>
          <Segmented
            label="Enter the refund as"
            value={mode}
            onChange={(m) => { setMode(m); setRefundInput(null); }}
            options={[{ value: "amount", label: "Amount" }, { value: "percent", label: "Percentage" }]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-48">
            <input
              aria-label={mode === "amount" ? "Refund in KES" : "Refund as a percentage of the deposit"}
              inputMode="decimal"
              value={refundInput ?? (mode === "amount" ? String(followRefund) : String(held > 0 ? round2((followRefund / held) * 100) : 0))}
              onChange={(e) => setRefundInput(e.target.value.replace(/[^\d.]/g, ""))}
              className={`${inputCls} pr-12 text-right tabular-nums`}
            />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-content-muted">{mode === "amount" ? "KES" : "%"}</span>
          </div>
          <p className="text-[13px] text-content-muted">
            {mode === "amount" ? `${pct}% of the deposit` : `KES ${kes(refund)}`}
            {refundInput !== null && <> · <button type="button" className="underline" onClick={() => setRefundInput(null)}>Match the deductions</button></>}
          </p>
        </div>
      </section>

      {/* The arithmetic, written out the way the tenant will see it. */}
      <div className="rounded-lg border border-border p-3 text-[13px]">
        <div className="flex justify-between"><span>Deposit held</span><Money value={held} /></div>
        <div className="flex justify-between text-content-secondary"><span>Less deductions</span><span className="num">({kes(deducted)})</span></div>
        <div className="flex justify-between text-content-secondary"><span>Less refund</span><span className="num">({kes(refund)})</span></div>
        <div className={`mt-1 flex justify-between border-t border-border pt-1 font-semibold ${Math.abs(gap) < 0.01 ? "text-success" : "text-warning"}`}>
          <span>{Math.abs(gap) < 0.01 ? "Fully explained" : gap > 0 ? "Not yet explained" : "Over the deposit by"}</span>
          <span className="num">{kes(Math.abs(gap))}</span>
        </div>
        {gap > 0.009 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => add("other", String(gap))}>Add KES {kes(gap)} as another deduction</Button>
            <Button size="sm" variant="ghost" onClick={() => setRefundInput(null)}>Refund it instead</Button>
          </div>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-md bg-danger-soft p-3 text-[13px] text-danger" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="danger" onClick={submit} disabled={!canSubmit} loading={moveOut.isPending}>
          Move out and settle KES {kes(held)}
        </Button>
      </div>
    </Card>
  );
}
