/**
 * The monthly management report: one page a director can read in two
 * minutes. Every headline figure is compared with the month before (with the
 * same day while a month is still running), arrears are shown by age, and a
 * few written sentences say what moved. Downloads as PDF or Excel; prints
 * with the charts.
 */
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileDown, FileSpreadsheet, Printer } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { Money } from "@/components/ds";
import { Button, Card, ErrorState, Skeleton } from "@/components/ui";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { api } from "@/lib/api";
import { getErrorMessage } from "@/lib/apiError";
import { downloadFile } from "@/lib/downloadPdf";

interface Report {
  year: number; month: number; as_of: string; is_current_month: boolean;
  headline: {
    expected: number; collected: number; collection_rate: number;
    prev_expected: number; prev_collected: number; prev_collection_rate: number;
    arrears: number; prev_arrears: number; occupied: number; prev_occupied: number; units: number; vacant: number;
    deposits_held: number; prev_deposits_held: number;
    income: number; expenses: number; net: number; prev_income: number; prev_expenses: number; prev_net: number;
  };
  trend: { label: string; expected: number; collected: number; current: boolean }[];
  aging: { building: string; "0_30": number; "31_60": number; "61_90": number; "90_plus": number }[];
  properties: { id: number; name: string; units: number; occupied: number; expected: number; collected: number; collection_rate: number; arrears: number; income: number; expenses: number; net: number }[];
  top_overdue: { tenant_id: number; tenant: string; unit: string; building: string; total: number; oldest: string }[];
  notes: string[];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const kes = (n: number) => Math.round(n).toLocaleString("en-KE");
const short = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
// Chart colours read as meaning: ink for money in, a quiet grey for what was billed,
// and arrears darkening with age.
const INK = "rgb(26 33 30)";
const BILLED = "rgb(209 213 206)";
const AGE = ["rgb(214 186 120)", "rgb(196 140 60)", "rgb(170 90 40)", "rgb(150 40 40)"];

function Change({ now, before, unit = "kes", goodWhenUp = true }: { now: number; before: number; unit?: "kes" | "pts" | "units"; goodWhenUp?: boolean }) {
  const d = now - before;
  if (Math.abs(d) < 0.05) return <span className="text-[12px] text-content-muted">Same as last month</span>;
  const good = goodWhenUp ? d > 0 : d < 0;
  const text = unit === "pts" ? `${Math.abs(Math.round(d * 10) / 10)} pts` : unit === "units" ? `${Math.abs(d)} units` : `KES ${kes(Math.abs(d))}`;
  return <span className={`text-[12px] font-medium ${good ? "text-success" : "text-danger"}`}>{d > 0 ? "Up" : "Down"} {text} on last month</span>;
}

export function MonthlyReport() {
  const today = new Date();
  const [period, setPeriod] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["reports", "monthly", period.year, period.month],
    queryFn: async () => (await api.get<Report>("/reports/monthly/", { params: period })).data,
  });
  const [busy, setBusy] = useState<"pdf" | "xlsx" | null>(null);
  const shift = (d: number) => setPeriod((p) => {
    const dt = new Date(p.year, p.month - 1 + d, 1);
    return { year: dt.getFullYear(), month: dt.getMonth() + 1 };
  });
  const isFuture = period.year * 12 + period.month >= today.getFullYear() * 12 + today.getMonth() + 1;
  const download = async (format: "pdf" | "xlsx") => {
    setBusy(format);
    try {
      await downloadFile("/reports/monthly/", { params: { ...period, format }, fallback: `Monthly-report.${format}` });
    } catch (e) {
      toast.error(getErrorMessage(e, "The report could not be downloaded."));
    } finally {
      setBusy(null);
    }
  };

  if (isError) return <ErrorState title="The monthly report could not be loaded." description="This is usually temporary." onRetry={() => void refetch()} />;
  const h = data?.headline;
  const monthLabel = `${MONTHS[period.month - 1]} ${period.year}`;
  const agingTotal = (data?.aging ?? []).reduce((s, a) => s + a["0_30"] + a["31_60"] + a["61_90"] + a["90_plus"], 0);

  return (
    <div className="monthly-report space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
          <h2 className="min-w-[150px] text-center text-lg font-semibold">{monthLabel}</h2>
          <Button size="icon-sm" variant="ghost" onClick={() => shift(1)} disabled={isFuture} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => download("pdf")} loading={busy === "pdf"}><FileDown className="h-4 w-4" /> PDF</Button>
          <Button size="sm" variant="outline" onClick={() => download("xlsx")} loading={busy === "xlsx"}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print with charts</Button>
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-2xl font-semibold">Monthly management report: {monthLabel}</h1>
        <p className="text-sm">Mawingu Properties · as at {data?.as_of}</p>
      </div>

      {isLoading || !data || !h ? (
        <div className="space-y-3"><Skeleton className="h-28" rounded="lg" /><Skeleton className="h-72" rounded="lg" /></div>
      ) : (
        <>
          <Card padding="md" className="space-y-1.5">
            <h3 className="text-sm font-semibold">This month in brief</h3>
            <ul className="list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-content">
              {data.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </Card>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Collected</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={h.collected} /></p>
              <p className="text-[12px] text-content-muted">of KES {kes(h.expected)} billed · {h.collection_rate}%</p>
              <Change now={h.collection_rate} before={h.prev_collection_rate} unit="pts" />
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Arrears</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={h.arrears} /></p>
              <p className="text-[12px] text-content-muted">{data.is_current_month ? "Owed by tenants, including this month's rent" : "Owed by tenants at month end"}</p>
              {data.is_current_month
                ? <span className="text-[12px] text-content-muted">Compare at month end; this month's rent is still coming in</span>
                : <Change now={h.arrears} before={h.prev_arrears} goodWhenUp={false} />}
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Occupancy</p>
              <p className="mt-1 text-2xl font-semibold num">{h.units ? Math.round((h.occupied / h.units) * 100) : 0}%</p>
              <p className="text-[12px] text-content-muted">{h.occupied} of {h.units} units let · {h.vacant} vacant</p>
              <Change now={h.occupied} before={h.prev_occupied} unit="units" />
            </Card>
            <Card padding="md">
              <p className="text-[13px] text-content-muted">Net income (billed basis)</p>
              <p className="mt-1 text-2xl font-semibold"><Money value={h.net} /></p>
              <p className="text-[12px] text-content-muted">KES {kes(h.income)} in, KES {kes(h.expenses)} out</p>
              <Change now={h.net} before={h.prev_net} />
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-5 [&>*]:min-w-0">
            <Card padding="md" className="lg:col-span-3">
              <h3 className="text-sm font-semibold">Collected against billed, 12 months</h3>
              <p className="mb-3 text-[12.5px] text-content-muted">For each month, grey is what was billed and dark is what came in.</p>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend} barGap={2} barCategoryGap="24%" margin={{ left: -8, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="rgba(0,0,0,0.06)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "rgb(110 118 113)" }} />
                    <YAxis tickFormatter={short} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "rgb(110 118 113)" }} width={44} />
                    <Tooltip formatter={(v) => `KES ${kes(Number(v))}`} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                    <Bar dataKey="expected" name="Billed" fill={BILLED} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="collected" name="Collected" fill={INK} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card padding="md" className="lg:col-span-2">
              <h3 className="text-sm font-semibold">Arrears by age</h3>
              <p className="mb-3 text-[12.5px] text-content-muted">KES {kes(agingTotal)} in total. Darker is older and harder to collect.</p>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.aging} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <CartesianGrid horizontal={false} stroke="rgba(0,0,0,0.06)" />
                    <XAxis type="number" tickFormatter={short} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "rgb(110 118 113)" }} />
                    <YAxis type="category" dataKey="building" tickLine={false} axisLine={false} width={110} tick={{ fontSize: 12, fill: "rgb(60 66 62)" }} />
                    <Tooltip formatter={(v) => `KES ${kes(Number(v))}`} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="0_30" name="0–30 days" stackId="a" fill={AGE[0]} isAnimationActive={false} />
                    <Bar dataKey="31_60" name="31–60" stackId="a" fill={AGE[1]} isAnimationActive={false} />
                    <Bar dataKey="61_90" name="61–90" stackId="a" fill={AGE[2]} isAnimationActive={false} />
                    <Bar dataKey="90_plus" name="90+" stackId="a" fill={AGE[3]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">By property</h3>
            <Table minWidth={820}>
              <THead><tr><TH>Property</TH><TH className="text-right">Units let</TH><TH className="text-right">Billed</TH><TH className="text-right">Collected</TH><TH className="text-right">Rate</TH><TH className="text-right">Arrears</TH><TH className="text-right">Expenses</TH><TH className="text-right">Net income</TH></tr></THead>
              <TBody>
                {data.properties.map((p) => (
                  <TR key={p.id}>
                    <TD><Link to={`/buildings/${p.id}`} className="font-medium hover:underline">{p.name}</Link></TD>
                    <TD className="num text-right">{p.occupied} / {p.units}</TD>
                    <TD className="num text-right text-content-secondary">{kes(p.expected)}</TD>
                    <TD className="num text-right">{kes(p.collected)}</TD>
                    <TD className={`num text-right ${p.collection_rate < 60 && p.expected > 0 ? "text-danger" : ""}`}>{p.expected > 0 ? `${p.collection_rate}%` : "–"}</TD>
                    <TD className="num text-right">{kes(p.arrears)}</TD>
                    <TD className="num text-right text-content-secondary">{kes(p.expenses)}</TD>
                    <TD className={`num text-right font-medium ${p.net < 0 ? "text-danger" : ""}`}>{kes(p.net)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
            <div>
              <h3 className="mb-2 text-sm font-semibold">Largest overdue balances</h3>
              <Table>
                <THead><tr><TH>Tenant</TH><TH>Owing since</TH><TH className="text-right">KES</TH></tr></THead>
                <TBody>
                  {data.top_overdue.map((t) => (
                    <TR key={t.tenant_id}>
                      <TD><Link to={`/tenants/${t.tenant_id}`} className="font-medium hover:underline">{t.tenant}</Link><div className="text-[12px] text-content-muted">{t.unit} · {t.building}</div></TD>
                      <TD className="text-content-secondary">{t.oldest}</TD>
                      <TD className="num text-right font-medium">{kes(t.total)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
            <Card padding="md" className="h-fit space-y-2 text-[13.5px]">
              <h3 className="text-sm font-semibold">Money held for others</h3>
              <div className="flex justify-between"><span>Deposits held for tenants</span><Money value={h.deposits_held} /></div>
              <p className="text-[12.5px] text-content-muted">
                Deposits are owed back to tenants and are never counted as income. See <Link to="/deposits" className="underline">Deposits</Link> for refunds owed and how past deposits were settled.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
