import { zodResolver } from "@hookform/resolvers/zod";
import { Banknote, Bell, Building2, CreditCard, Eye, EyeOff, FileText, Mail, Plus, Smartphone, Undo2, UserPlus, Wallet, X } from "lucide-react";

import { cloneElement, isValidElement, useId, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { Avatar, Money, NoticeBanner, SplitBar } from "@/components/ds";
import { fmt } from "@/lib/figures";
import {
  Badge,
  Button,
  Card,
  DatePicker,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@/components/ui";
import { TenantPicker } from "@/features/payments/TenantPicker";
import { toChoices } from "@/features/payments/tenantChoices";
import { VoidPaymentModal } from "@/features/payments/VoidPaymentModal";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";
import { useCan } from "@/hooks/usePermission";
import {
  type Payment,
  useCollectionProgress,
  useCreatePayment,
  usePayments,
  useResendReceipt,
} from "@/hooks/usePayments";
import { useTenants } from "@/hooks/useTenants";
import { getErrorMessage } from "@/lib/apiError";
import { cn } from "@/lib/cn";
import { toDayFirst, todayIso } from "@/lib/dates";
import { downloadPdf } from "@/lib/downloadPdf";

const SOURCES = [
  { value: "", label: "All" },
  { value: "cash", label: "Cash" },
  { value: "mpesa", label: "M-Pesa" },
  { value: "bank", label: "Bank" },
];

const PAYMENT_TYPES = [
  { value: "rent",     label: "Rental Income (4000)" },
  { value: "late_fee", label: "Late Fee (4010)" },
  { value: "deposit",  label: "Security Deposit (2100)" },
  { value: "other",    label: "Other Income" },
] as const;

const now = new Date();

/** Payments grouped by the day they arrived, newest day first. */
function groupByDay(rows: Payment[]): [string, Payment[]][] {
  const map = new Map<string, Payment[]>();
  for (const r of rows) map.set(r.payment_date, [...(map.get(r.payment_date) ?? []), r]);
  return [...map.entries()].sort((x, y) => y[0].localeCompare(x[0]));
}

/** "TODAY · TUE 20 OCT", "YESTERDAY · …", or just the date. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");
  const t = todayIso();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
  return iso === t ? `Today · ${label}` : iso === yIso ? `Yesterday · ${label}` : label;
}

const schema = z.object({
  tenant: z.coerce.number().min(1, "Select a tenant"),
  amount: z.string()
    .min(1, "Required")
    .refine((v) => Number(v) > 0, "Amount must be greater than 0"),
  payment_date: z.string().min(1, "Required"),
  period_month: z.coerce.number().min(1).max(12),
  period_year: z.coerce.number().min(2020).max(2100),
  source: z.string().min(1),
  payment_type: z.enum(["rent", "late_fee", "deposit", "other"]),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

const inputCls =
  "w-full rounded-md bg-surface-raised hairline px-3 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-sage-500/40";

const SOURCE_CONFIG: Record<string, { tone: "sage" | "peri" | "ochre" | "coral"; icon: React.ComponentType<{ className?: string }> }> = {
  mpesa: { tone: "sage", icon: Smartphone },
  bank: { tone: "peri", icon: Building2 },
  cash: { tone: "ochre", icon: Banknote },
  cheque: { tone: "peri", icon: Wallet },
};

function SourceChip({ source, label }: { source: string; label: string }) {
  const config = SOURCE_CONFIG[source] ?? { tone: "sage" as const, icon: Wallet };
  const Icon = config.icon;
  return (
    <Badge tone={config.tone}>
      <Icon className="h-3 w-3" />
      {label}
    </Badge>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ id?: string }>, {
        id: (children as React.ReactElement<{ id?: string }>).props.id ?? id,
      })
    : children;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-500">
        {label}
      </label>
      {control}
      {error && <p className="mt-1 text-[11px] text-status-unpaid">{error}</p>}
    </div>
  );
}

export default function PaymentsPage() {
  const [sourceFilter, setSourceFilter] = useState("");
  const [tenantFilter, setTenantFilter] = useState<number | null>(null);
  const [searchParams] = useSearchParams();
  const [showForm, setShowForm] = useState(searchParams.get("new") === "1");
  const [showVoided, setShowVoided] = useState(false);
  const [voidTarget, setVoidTarget] = useState<Payment | null>(null);

  // Voiding is owner-only on the API (CanForgiveMoney). Hiding the control for
  // everyone else keeps the UI honest about what it will let you finish.
  const { user } = useAuth();

  const canVoid = Boolean(user?.can_forgive_money);
  const can = useCan();

  const handleDownloadReceipt = async (txnId: number) => {
    try {
      await downloadPdf(`/transactions/${txnId}/receipt-pdf/`, `receipt-${txnId}.pdf`);
    } catch {
      toast.error("Failed to download receipt");
    }
  };

  const resendReceipt = useResendReceipt();
  const handleResendReceipt = async (paymentId: number) => {
    try {
      await resendReceipt.mutateAsync(paymentId);
      toast.success("Receipt resent");
    } catch (e) {
      toast.error(getErrorMessage(e, "Failed to resend receipt"));
    }
  };

  const filters: Record<string, string> = {};

  if (sourceFilter) filters.source = sourceFilter;
  if (tenantFilter) filters.tenant = String(tenantFilter);
  // Voided rows are hidden by default so the list agrees with arrears and the
  // ledger; the toggle brings them back for audit.
  if (showVoided) filters.include_void = "true";

  const { data: payments, isLoading, isError, refetch } = usePayments(filters);
  const { data: allPayments } = usePayments();
  const { data: notifications } = useNotifications(can("notifications.view"));
  const todayIsoDate = todayIso();
  const today = useMemo(() => {
    const rows = (allPayments ?? []).filter((x) => x.payment_date === todayIsoDate && x.payment_type !== "deposit");
    const sum = (f: (x: Payment) => boolean) => rows.filter(f).reduce((t, x) => t + Number(x.amount), 0);
    return {
      total: sum(() => true), count: rows.length,
      mpesa: sum((x) => x.source === "mpesa"), bank: sum((x) => x.source === "bank"),
      other: sum((x) => x.source !== "mpesa" && x.source !== "bank"),
      mpesaCount: rows.filter((x) => x.source === "mpesa").length,
      bankCount: rows.filter((x) => x.source === "bank").length,
      otherCount: rows.filter((x) => x.source !== "mpesa" && x.source !== "bank").length,
    };
  }, [allPayments, todayIsoDate]);
  const remindersToday = new Set(
    (notifications ?? [])
      .filter((n) => n.status === "sent" && (n.sent_at ?? "").slice(0, 10) === todayIsoDate && n.template_key.startsWith("rent_"))
      .map((n) => n.tenant),
  ).size;
  const { data: progress } = useCollectionProgress();
  const { data: tenants, isLoading: tenantsLoading } = useTenants({ status: "active" });
  const createPayment = useCreatePayment();
  // The filter searches every tenancy, not just active ones: a payment that
  // needs voiding may sit on a tenant who has since given notice or moved out.
  const { data: allTenants } = useTenants();
  const tenantChoices = useMemo(() => toChoices(allTenants), [allTenants]);

  // The record form keeps to active tenancies, as the old dropdown did.
  const activeChoices = useMemo(() => toChoices(tenants), [tenants]);

  const hasTenants = (tenants?.length ?? 0) > 0;

  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      tenant: 0,
      amount: "",
      payment_date: todayIso(),
      period_month: now.getMonth() + 1,
      period_year: now.getFullYear(),
      source: "cash",
      payment_type: "rent",
      reference: "",
      notes: "",
    },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await createPayment.mutateAsync(values);
      toast.success("Payment recorded");
      reset();
      setShowForm(false);
    } catch (e) {
      toast.error(getErrorMessage(e, "Failed to record payment"));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Collections"
        title="Payments"
        description={`${now.toLocaleString("en-GB", { month: "long" })} · bank and M-Pesa matched automatically`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="gold"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
              {showForm ? "Cancel" : "Record Payment"}
            </Button>
          </div>
        }
      />

      {/* Today, this month, and what went out this morning */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="card px-4 py-[14px]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-content-muted">Received today</p>
              <p className="text-2xl font-semibold text-content"><Money value={today.total} /></p>
            </div>
            <div className="text-right">
              <p className="num text-xl font-semibold text-content">{today.count}</p>
              <p className="text-xs text-content-muted">receipt{today.count === 1 ? "" : "s"}</p>
            </div>
          </div>
          <div className="mt-3">
            <SplitBar parts={[
              { value: today.mpesa, tone: "bar", label: "M-Pesa" },
              { value: today.bank, tone: "gold", label: "Bank" },
              { value: today.other, tone: "soft", label: "Cash and cheque" },
            ]} />
          </div>
          <p className="mt-2 text-xs text-content-muted">
            {[today.mpesaCount && `${today.mpesaCount} M-Pesa`, today.bankCount && `${today.bankCount} bank`, today.otherCount && `${today.otherCount} cash`].filter(Boolean).join(" · ") || "Nothing received yet today"}
          </p>
        </div>
        {progress ? (
          <div className="card px-4 py-[14px]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-content-muted">Collected this month</p>
                <p className="text-2xl font-semibold text-content"><Money value={Number(progress.collected)} /></p>
              </div>
              <p className="num text-xl font-semibold text-content">{Math.round(Number(progress.percentage))}%</p>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-[3px] bg-expected">
              <div className="h-full rounded-[3px] bg-bar transition-[width] duration-700" style={{ width: `${Math.min(100, Number(progress.percentage))}%` }} />
            </div>
            <p className="mt-2 text-xs text-content-muted">of KES {fmt(Number(progress.expected))} expected</p>
          </div>
        ) : (
          <Skeleton className="h-[118px]" />
        )}
      </div>
      {remindersToday > 0 && (
        <NoticeBanner
          icon={Bell}
          title={`Reminders sent to ${remindersToday} tenant${remindersToday === 1 ? "" : "s"}`}
          subline="SMS & email · today (simulated in the demo)"
        />
      )}

      {/* Record payment form */}
      {showForm && (
        <Card variant="glass" padding="md" className="animate-fade-up">
          <div className="mb-5">
            <p className="font-display text-lg font-semibold text-ink-900">Record manual payment</p>
            <p className="text-xs text-ink-500">
              Manually log a cash, M-Pesa, or bank payment.
            </p>
          </div>

          {!tenantsLoading && !hasTenants ? (
            <div className="rounded-md border border-dashed border-ink-300 bg-surface-raised/40 p-6 text-center">
              <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-coral-50 text-coral-600">
                <UserPlus className="h-4 w-4" />
              </div>
              <p className="font-medium text-ink-900">No active tenants yet</p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-ink-500">
                Add a tenant before recording a payment. Payments must be attributed to an
                active tenant and unit.
              </p>
              <Link
                to="/tenants"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-ink-900 px-4 py-2 text-xs font-medium text-canvas transition-opacity hover:opacity-90"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Go to tenants
              </Link>
            </div>
          ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="sm:col-span-2">
                <Field label="Tenant *" error={errors.tenant?.message}>
                  <Controller
                    control={control}
                    name="tenant"
                    render={({ field }) => (
                      <TenantPicker
                        choices={activeChoices}
                        value={field.value || null}
                        onChange={(id) => field.onChange(id ?? 0)}
                        disabled={tenantsLoading}
                        ariaLabel="Tenant"
                      />
                    )}
                  />
                </Field>
              </div>
              <Field label="Amount (KES) *" error={errors.amount?.message}>
                <input {...register("amount")} className={inputCls} />
              </Field>
              <DatePicker
                label="Payment date"
                {...register("payment_date")}
                error={errors.payment_date?.message}
              />

              <Field label="Source">
                <select {...register("source")} className={inputCls}>
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="bank">Bank transfer</option>
                </select>
              </Field>
              <Field label="Type">
                <select {...register("payment_type")} className={inputCls}>
                  {PAYMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </Field>
              <Field label="Period month">
                <input type="number" min={1} max={12} {...register("period_month")} className={inputCls} />
              </Field>
              <Field label="Period year">
                <input type="number" min={2020} {...register("period_year")} className={inputCls} />
              </Field>
              <Field label="Reference">
                <input
                  {...register("reference")}
                  placeholder="M-Pesa code, receipt #"
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={createPayment.isPending}>
                <CreditCard className="h-4 w-4" />
                Record payment
              </Button>
            </div>
          </form>
          )}
        </Card>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by payment source">
          {SOURCES.map((s) => {
            const active = sourceFilter === s.value;
            return (
              <button
                key={s.value || "all"}
                onClick={() => setSourceFilter(s.value)}
                aria-pressed={active}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                  active
                    ? "bg-ink-900 text-canvas shadow-float dark:bg-ink-100 dark:text-canvas"
                    : "glass text-ink-700"
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="w-64 max-w-full">
            <TenantPicker
              choices={tenantChoices}
              value={tenantFilter}
              onChange={setTenantFilter}
              ariaLabel="Filter payments by tenant"
            />
          </div>
          {tenantFilter && (
            <button
              onClick={() => setTenantFilter(null)}
              className="rounded-full p-1.5 text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900"
              title="Clear tenant filter"
              aria-label="Clear tenant filter"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowVoided((v) => !v)}
          aria-pressed={showVoided}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
            showVoided
              ? "bg-ink-900 text-canvas shadow-float dark:bg-ink-100 dark:text-canvas"
              : "glass text-ink-700"
          )}
          title="Show payments that have been voided"
        >
          {showVoided ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          Voided
        </button>
      </div>

      {/* Payments table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
      ) : isError ? (
        <Card variant="glass" padding="none" className="py-4">
          <ErrorState
            title="Payments could not be loaded."
            description="The payment history did not come back. This is usually temporary."
            onRetry={() => void refetch()}
          />
        </Card>
      ) : !payments?.length ? (
        <Card variant="glass" padding="none" className="py-4">
          <EmptyState
            icon={<CreditCard className="h-5 w-5" />}
            title={tenantFilter ? "No payments for this tenant" : "No payments yet"}
            description={
              tenantFilter
                ? "Nothing recorded against this tenant matches the current filters."
                : "Recorded payments will appear here."
            }
          />
        </Card>
      ) : (
        <>
          <div className="hidden md:block">
            <Table minWidth={980}>
              <THead>
                <TR>
                  <TH>Tenant</TH>
                  <TH>Unit</TH>
                  <TH className="text-right">Amount</TH>
                  <TH>Date</TH>
                  <TH>Period</TH>
                  <TH>Source</TH>
                  <TH>Reference</TH>
                </TR>
              </THead>
              <TBody>
                {payments.map((p) => (
                  <TR key={p.id}>
                    <TD>
                      <div className="flex w-max items-center gap-3">
                        <Avatar name={p.tenant_name} />
                        <span className="font-medium text-ink-900">{p.tenant_name}</span>
                        {p.is_void && (
                          <Badge tone="unpaid" title={p.void_reason}>Void</Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="text-ink-500">
                      {p.building_name} · {p.unit_label}
                    </TD>
                    <TD
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        p.is_void
                          ? "text-ink-400 line-through"
                          : "text-content"
                      )}
                    >
                      KES {Number(p.amount).toLocaleString()}
                    </TD>
                    <TD className="text-ink-500">{toDayFirst(p.payment_date)}</TD>
                    <TD className="tabular-nums text-ink-500">
                      {p.period_month}/{p.period_year}
                    </TD>
                    <TD>
                      <SourceChip source={p.source} label={p.source_display} />
                    </TD>
                    <TD className="font-mono text-[11px] text-ink-400">
                      <div className="flex items-center gap-2">
                        {p.reference || "—"}
                        {p.transaction_id && (
                          <button
                            onClick={() => handleDownloadReceipt(p.transaction_id!)}

                            className="rounded p-1 hover:bg-sage-50 text-sage-600 transition-colors"
                            title="Download PDF Receipt"
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleResendReceipt(p.id)}
                          disabled={resendReceipt.isPending}
                          className="rounded p-1 hover:bg-sage-50 text-sage-600 transition-colors disabled:opacity-40"
                          title="Resend receipt by SMS + email"
                        >
                          <Mail className="h-3.5 w-3.5" />
                        </button>
                        {canVoid && !p.is_void && (
                          <button
                            onClick={() => setVoidTarget(p)}
                            className="rounded p-1 text-ink-400 transition-colors hover:bg-danger-soft hover:text-danger"
                            title="Void this payment"
                            aria-label={`Void payment of KES ${p.amount} from ${p.tenant_name}`}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </TD>

                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="space-y-3 md:hidden">
            {groupByDay(payments).map(([day, rows]) => (
              <div key={day} className="card px-4 py-3">
                <p className="eyebrow mb-1">{dayLabel(day)}</p>
                <div className="divide-y divide-border">
                  {rows.map((p) => (
                    <div key={p.id} className="py-2.5">
                      <div className="grid grid-cols-[34px_1fr_auto] items-center gap-[11px]">
                        <Avatar name={p.tenant_name} />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] font-semibold text-content">{p.tenant_name}</span>
                          <span className="block truncate text-xs text-content-muted">{p.unit_label} · {p.building_name.split(" - ")[0]} · {p.source_display}</span>
                        </span>
                        <span className="flex flex-col items-end gap-1">
                          <span className={cn("num text-[14px] font-semibold", p.is_void ? "text-content-soft line-through" : "text-content")}>{fmt(Number(p.amount))}</span>
                          {p.is_void ? <Badge tone="unpaid">Void</Badge> : p.payment_type === "deposit" ? <Badge tone="neutral">Deposit</Badge> : <Badge tone="paid">✓ Matched</Badge>}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-3 pl-[45px] text-[11.5px] font-medium">
                        {p.transaction_id && (
                          <button onClick={() => handleDownloadReceipt(p.transaction_id!)} className="flex items-center gap-1 text-content-muted hover:text-content">
                            <FileText className="h-3 w-3" strokeWidth={1.7} /> Receipt
                          </button>
                        )}
                        {!p.is_void && (
                          <button onClick={() => handleResendReceipt(p.id)} disabled={resendReceipt.isPending} className="flex items-center gap-1 text-content-muted hover:text-content disabled:opacity-40">
                            <Mail className="h-3 w-3" strokeWidth={1.7} /> Resend
                          </button>
                        )}
                        {canVoid && !p.is_void && (
                          <button onClick={() => setVoidTarget(p)} className="flex items-center gap-1 text-danger">
                            <Undo2 className="h-3 w-3" strokeWidth={1.7} /> Void
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {voidTarget && (
        <VoidPaymentModal
          payment={voidTarget}
          onClose={() => setVoidTarget(null)}
        />
      )}
    </div>
  );
}
