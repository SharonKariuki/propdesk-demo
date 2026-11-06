import { format, getDaysInMonth } from "date-fns";
import {
  BarChart3, Building2, Droplets, Send, UserPlus, Users, Wallet, Wrench, type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import {
  Avatar, GhostBarChart, HeroCard, KpiTile, ListRow, LogoTile, Money, PanelHeader, PropBar,
  QuickAction, RowList, Segmented, SplitBar,
} from "@/components/ds";
import { fmt } from "@/lib/figures";
import SmsBalanceCard from "@/components/SmsBalanceCard";
import { startTour } from "@/features/help/tourStore";
import { useAuth } from "@/hooks/useAuth";
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from "@/components/ui";
import { useBuildingPhotoSrc, useBuildings } from "@/hooks/useBuildings";
import { useDashboard, type AlertType, type RecentPayment } from "@/hooks/useDashboard";
import { useCan } from "@/hooks/usePermission";
import type { Permission } from "@/lib/permissions";

/** A building's own photo when it has one, else its stock picture. */
function BuildingThumb({ id, name, className }: { id: number | undefined; name: string; className?: string }) {
  const { data: buildings } = useBuildings();
  const building = buildings?.find((b) => b.id === id) ?? (id != null ? { id, name } : undefined);
  const src = useBuildingPhotoSrc(building);
  return <img src={src} alt={name} loading="lazy" className={className} />;
}

interface Action {
  icon: LucideIcon;
  label: string;
  /** Accessible name — the full verb, where the visible label is short. */
  aria?: string;
  to: string;
  permission: Permission;
}

/** Four quick actions, in this order of preference, for whatever the role may do. */
const ACTIONS: Action[] = [
  { icon: Wallet, label: "Record", aria: "Record payment", to: "/payments?new=1", permission: "payments.record" },
  { icon: UserPlus, label: "Add tenant", to: "/tenants?new=1", permission: "tenants.manage" },
  { icon: Send, label: "Remind", aria: "Send reminders", to: "/notifications", permission: "notifications.send" },
  { icon: BarChart3, label: "Reports", aria: "View reports", to: "/reports", permission: "reports.view" },
  { icon: Droplets, label: "Water", aria: "Record water readings", to: "/water", permission: "water.record" },
  { icon: Wrench, label: "Repair", aria: "Log a repair", to: "/buildings", permission: "maintenance.log" },
  { icon: Users, label: "Tenants", to: "/tenants", permission: "tenants.view" },
  { icon: Building2, label: "Units", to: "/units", permission: "buildings.view" },
];

const ALERT_PILL: Record<AlertType, { tone: "unpaid" | "partial" | "neutral"; label: string }> = {
  overdue: { tone: "unpaid", label: "Overdue" },
  partial: { tone: "partial", label: "Partial" },
  move_out: { tone: "neutral", label: "Leaving" },
  expiring_lease: { tone: "neutral", label: "Renewal" },
  maintenance: { tone: "partial", label: "Repair" },
};

function greetingFor(date: Date) {
  const h = date.getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function PaymentPill({ status }: { status: RecentPayment["status"] }) {
  if (status === "matched") return <Badge tone="paid">✓ Matched</Badge>;
  if (status === "partial") return <Badge tone="partial">Partial</Badge>;
  return <Badge tone="neutral">Recorded</Badge>;
}

/** Offered once per browser; Help keeps the tour after it is dismissed. */
function TourOffer() {
  const { user } = useAuth();
  const key = `propdesk-tour-offered-${user?.role ?? "user"}`;
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(key) === "1"; } catch { return true; }
  });
  if (hidden) return null;
  const dismiss = () => {
    try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
    setHidden(true);
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-[13.5px]">
      <p><span className="font-medium">New to Euonia Core?</span> <span className="text-content-secondary">A one-minute tour shows where everything you need lives.</span></p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={dismiss}>Not now</Button>
        <Button size="sm" onClick={() => { dismiss(); startTour(user?.role ?? "owner"); }}>Take the tour</Button>
      </div>
    </div>
  );
}

/** Rows shown in the payments and needs-attention feeds, so the two cards line up. */
const FEED_ROWS = 6;

export default function DashboardPage() {
  const { data, isLoading, isError, refetch } = useDashboard();
  const can = useCan();
  const [range, setRange] = useState<"6M" | "12M">("6M");

  const today = new Date();
  const header = (
    <header className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <LogoTile />
        <div className="min-w-0">
          <p className="text-[13px] text-content-muted">{greetingFor(today)}</p>
          <h1 className="truncate text-xl font-semibold text-content">Mawingu Properties</h1>
        </div>
      </div>
      <p className="hidden text-[13px] text-content-muted sm:block">{format(today, "EEEE d MMMM yyyy")}</p>
    </header>
  );

  if (isError && !data) {
    return (
      <div className="space-y-6">
        {header}
        <ErrorState
          title="The dashboard could not be loaded."
          description="Your portfolio summary did not come back. This is usually temporary."
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        {header}
        <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
          <Skeleton className="h-[188px] w-full lg:col-span-5" rounded="lg" />
          <div className="grid grid-cols-2 gap-2.5 lg:col-span-7">
            <Skeleton className="h-24 w-full" rounded="lg" />
            <Skeleton className="h-24 w-full" rounded="lg" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" rounded="lg" />
      </div>
    );
  }

  const { kpis, income_trend, occupancy, buildings, recent_payments, alerts } = data;
  const money = can("payments.view");
  const occupancyPct = kpis.total_units > 0 ? Math.round((kpis.occupied / kpis.total_units) * 100) : 0;
  const collectionPct = kpis.collection_expected > 0
    ? Math.round((kpis.collection_received / kpis.collection_expected) * 100)
    : kpis.collection_percentage ?? 0;
  const daysLeft = getDaysInMonth(today) - today.getDate();
  const monthName = format(today, "MMMM");

  const trend = range === "6M" ? income_trend.slice(-6) : income_trend.slice(-12);
  const thisMonth = kpis.collection_received;
  // Compare with the same point last month, not the whole of last month.
  const lastMonthToDate = kpis.last_month_to_date_received ?? 0;
  const delta = lastMonthToDate > 0 ? ((thisMonth - lastMonthToDate) / lastMonthToDate) * 100 : null;
  const lastMonthName = format(new Date(today.getFullYear(), today.getMonth() - 1, 1), "MMMM");
  const dueDay = kpis.due_day ?? 5;
  const beforeDueDay = today.getDate() <= dueDay;
  const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

  const actions = ACTIONS.filter((a) => can(a.permission)).slice(0, 4);
  const arrearsCount = kpis.arrears_count ?? alerts.filter((a) => a.type === "overdue").length;

  return (
    <div className="space-y-5 lg:space-y-7">
      {header}
      <TourOffer />

      {/* ── Lead: the one number, the actions, the two KPIs, the trend ───── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6 [&>*]:min-w-0">
        <div className="space-y-4 lg:col-span-5">
          {money ? (
            <HeroCard
              to="/payments"
              label={`Collected KES ${fmt(kpis.collection_received)} of KES ${fmt(kpis.collection_expected)} in ${monthName}`}
              eyebrow={`Collected · ${monthName}`}
              value={kpis.collection_received}
              subline={<>of KES {fmt(kpis.collection_expected)} billed · KES {fmt(lastMonthToDate)} by this day in {lastMonthName}</>}
              progress={collectionPct}
              footLeft={`${Math.min(collectionPct, 100)}% collected`}
              footRight={beforeDueDay ? `Rent due on the ${ordinal(dueDay)}` : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            />
          ) : (
            <HeroCard
              to="/units"
              label={`${kpis.occupied} of ${kpis.total_units} units let`}
              eyebrow={`Occupancy · ${monthName}`}
              prefix=""
              value={occupancyPct}
              suffix="%"
              subline={<>{kpis.occupied} of {kpis.total_units} units let · {kpis.vacant} vacant</>}
              progress={occupancyPct}
              footLeft={`${kpis.active_tenants} tenants`}
              footRight={`${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
            />
          )}
          {actions.length > 0 && (
            <nav aria-label="Quick actions" className="grid grid-cols-4 gap-3 sm:gap-4">
              {actions.map((a) => <QuickAction key={a.label} icon={a.icon} label={a.label} ariaLabel={a.aria} to={a.to} />)}
            </nav>
          )}
        </div>

        <div className="space-y-4 lg:col-span-7">
          <div className="grid grid-cols-2 gap-2.5">
            {money ? (
              <KpiTile
                label="Overdue"
                to="/tenants?payment_status=in_arrears"
                ariaLabel={`Overdue: KES ${fmt(kpis.overdue_total ?? kpis.total_arrears)}`}
                foot={
                  (kpis.due_not_late_total ?? 0) > 0
                    ? <span>{kpis.overdue_count ?? arrearsCount} tenants · KES {fmt(kpis.due_not_late_total)} not yet due</span>
                    : (kpis.overdue_count ?? arrearsCount) > 0
                      ? <Badge tone="unpaid">{kpis.overdue_count ?? arrearsCount} tenant{(kpis.overdue_count ?? arrearsCount) === 1 ? "" : "s"}</Badge>
                      : "Nothing overdue"
                }
              >
                <Money value={kpis.overdue_total ?? kpis.total_arrears} />
              </KpiTile>
            ) : (
              <KpiTile label="Tenants" to="/tenants" foot={`${alerts.filter((a) => a.type === "move_out").length} on notice`}>
                <span className="num">{kpis.active_tenants}</span>
              </KpiTile>
            )}
            <KpiTile label="Occupancy" to="/units" foot={`${kpis.occupied} of ${kpis.total_units} units`}>
              <span className="num">{occupancyPct}%</span>
            </KpiTile>
          </div>

          {money && (
            <Card padding="none" className="px-4 py-[14px] sm:px-5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-content-muted">Collected · last {range === "6M" ? "6" : "12"} months</p>
                  <p className="text-4xl font-semibold text-content">
                    <Money value={trend.reduce((s, p) => s + p.amount, 0)} short />
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Segmented label="Chart range" value={range} onChange={setRange} options={[{ value: "6M", label: "6M" }, { value: "12M", label: "12M" }]} />
                  {delta !== null && (
                    <span className={delta >= 0 ? "text-xs font-semibold text-success" : "text-xs font-semibold text-danger"}>
                      {delta >= 0 ? "Up" : "Down"} {Math.abs(delta).toFixed(0)}% on the same day in {lastMonthName}
                    </span>
                  )}
                </div>
              </div>
              <GhostBarChart
                label="Rent collected each month against what was billed"
                data={trend.map((p) => ({ label: p.month, actual: p.amount, expected: p.expected, current: p.current }))}
              />
            </Card>
          )}
        </div>
      </section>

      {/* ── Payments and what needs attention: side by side, one height ──── */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6 [&>*]:min-w-0">
        {money && (
          <Card padding="none" className="flex h-full min-w-0 flex-col px-4 py-[14px] lg:col-span-7 sm:px-5">
            <PanelHeader title="Recent payments" note="Matched automatically" />
            {recent_payments.length === 0 ? (
              <p className="py-6 text-[13px] text-content-muted">No payments recorded yet. When tenants pay, they appear here.</p>
            ) : (
              <RowList>
                {recent_payments.slice(0, FEED_ROWS).map((p) => (
                  <ListRow
                    key={p.id}
                    name={p.tenant_name}
                    meta={`${p.unit_label} · ${p.building_name.split(" - ")[0]} · ${format(new Date(`${p.payment_date}T00:00:00`), "EEE d MMM")}`}
                    amount={fmt(Number(p.amount))}
                    pill={<PaymentPill status={p.status} />}
                  />
                ))}
              </RowList>
            )}
            <Link to="/payments" className="mt-auto inline-block pt-2 text-[13px] font-medium text-content hover:underline">
              All payments →
            </Link>
          </Card>
        )}

        <Card padding="none" className={`flex h-full min-w-0 flex-col px-4 py-[14px] sm:px-5 ${money ? "lg:col-span-5" : "lg:col-span-12"}`}>
          <PanelHeader title="Needs attention" note={alerts.length === 0 ? "All clear" : `${alerts.length} item${alerts.length === 1 ? "" : "s"}`} />
          {alerts.length === 0 ? (
            <p className="py-3 text-[13px] text-content-muted">Nothing needs you. Tenants are current and leases are running.</p>
          ) : (
            <ul className="divide-y divide-border">
              {alerts.slice(0, FEED_ROWS).map((a, i) => (
                <li key={i} className="flex min-h-[69px] items-center justify-between gap-3 py-2.5 text-[13px]">
                  {a.tenant_id ? (
                    <Link to={`/tenants/${a.tenant_id}`} className="leading-snug text-content hover:underline">{a.message}</Link>
                  ) : (
                    <span className="leading-snug text-content">{a.message}</span>
                  )}
                  <Badge tone={ALERT_PILL[a.type].tone} className="shrink-0">{ALERT_PILL[a.type].label}</Badge>
                </li>
              ))}
            </ul>
          )}
          {alerts.length > FEED_ROWS && (
            <Link to="/tenants" className="mt-auto inline-block pt-2 text-[13px] font-medium text-content hover:underline">
              {alerts.length - FEED_ROWS} more →
            </Link>
          )}
        </Card>
      </section>

      {/* ── Properties at a glance ───────────────────────────────────────── */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-6 [&>*]:min-w-0">
        {buildings.length > 0 && (
          <Card padding="none" className="h-full px-4 py-[14px] sm:px-5">
            <PanelHeader title="By property" note={money ? monthName : "Units let"} />
            {buildings.map((b) => {
              const showMoney = money && (b.expected ?? 0) > 0;
              const pct = showMoney ? ((b.collected ?? 0) / (b.expected ?? 1)) * 100 : b.total ? (b.occupied / b.total) * 100 : 0;
              return (
                <PropBar
                  key={b.id}
                  to={`/buildings/${b.id}`}
                  name={b.name.split(" - ")[0]}
                  amount={showMoney ? `KES ${fmt(b.collected ?? 0)}` : `${b.occupied} of ${b.total}`}
                  pct={pct}
                />
              );
            })}
          </Card>
        )}

        <Card padding="none" className="h-full px-4 py-[14px] sm:px-5">
          <PanelHeader title="Unit status" note={`${kpis.total_units} units`} />
          <div className="mt-2">
            <SplitBar parts={[
              { value: occupancy.paid, tone: "bar", label: "Paid" },
              { value: occupancy.partial + occupancy.unpaid + occupancy.arrears, tone: "gold", label: "Owing" },
              { value: occupancy.vacant, tone: "soft", label: "Vacant" },
            ]} />
          </div>
          <dl className="mt-3 grid grid-cols-5 gap-2 text-center">
            {([["Paid", occupancy.paid], ["Partial", occupancy.partial], [beforeDueDay ? "Not paid yet" : "Unpaid", occupancy.unpaid], ["In arrears", occupancy.arrears], ["Vacant", occupancy.vacant]] as const).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] text-content-muted">{k}</dt>
                <dd className="num text-[15px] font-semibold text-content">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {can("notifications.view") && <SmsBalanceCard compact />}
      </section>

      {/* ── Properties ───────────────────────────────────────────────────── */}
      {buildings.length > 0 ? (
        <section>
          <PanelHeader
            title="Properties"
            note={<Link to="/buildings" className="font-medium text-content hover:underline">Manage →</Link>}
          />
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {buildings.slice(0, 8).map((b) => {
              const rate = b.total > 0 ? Math.round((b.occupied / b.total) * 100) : 0;
              return (
                <Link
                  key={b.id}
                  to={b.id ? `/buildings/${b.id}` : "/buildings"}
                  className="group card block overflow-hidden transition-colors hover:border-border-strong"
                >
                  <div className="relative h-32 w-full overflow-hidden">
                    <BuildingThumb id={b.id} name={b.name} className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]" />
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Avatar name={b.name} className="hidden" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-semibold text-content">{b.name.split(" - ")[0]}</p>
                      <p className="truncate text-xs text-content-muted">{b.name.split(" - ")[1] ?? ""} · {b.occupied} of {b.total} let</p>
                    </div>
                    <span className="num text-[15px] font-semibold text-content">{rate}%</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      ) : (
        <EmptyState title="No buildings yet" description="Add your first property to start tracking units, tenants, and payments." />
      )}
    </div>
  );
}
