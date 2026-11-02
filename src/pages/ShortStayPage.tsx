/**
 * Short-stay letting (Airbnb, Booking.com, direct). A short-stay unit is an
 * ordinary unit let by the night: bookings instead of a lease, platform
 * payouts instead of rent. Revenue, nights and the tourism levy sit next to
 * long-term units in the reports.
 *
 * Demo: bookings come from calendar links (iCal) and payout reports, both
 * simulated here. Airbnb does not offer open API access; a production build
 * would connect through an approved channel manager.
 */
import { FileUp, Info, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Money, Segmented } from "@/components/ds";
import { Badge, Button, Card } from "@/components/ui";
import { PageHeader } from "@/components/ui/PageHeader";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/Table";
import { StayCalendar } from "@/features/shortstay/StayCalendar";
import { PAYOUT_LABEL, PAYOUT_TONE, STATUS_LABEL, STATUS_TONE } from "@/features/shortstay/labels";
import { AddBookingModal, BookingModal } from "@/features/shortstay/StayModals";
import {
  PLATFORMS, STAY_UNITS, TOURISM_LEVY_RATE, fmtDate, fmtShort, matchPayout, moneyOf, nightsWithin, payoutDate,
  shortStayStore, statusOn, todayIso, useShortStay, type Booking,
} from "@/features/shortstay/data";
import { useCan } from "@/hooks/usePermission";

const kes = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 0 });

export default function ShortStayPage() {
  const { bookings, lastSync } = useShortStay();
  const can = useCan();
  const money = can("payments.view");
  const today = todayIso();
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [tab, setTab] = useState<"bookings" | "payouts">("bookings");
  const [open, setOpen] = useState<Booking | null>(null);
  const [adding, setAdding] = useState(false);

  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`;
  const monthName = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", { month: "long", timeZone: "UTC" });

  const live = bookings.filter((b) => b.status !== "cancelled");
  const stats = useMemo(() => {
    const nights = live.reduce((s, b) => s + nightsWithin(b, start, end), 0);
    const available = STAY_UNITS.length * days;
    // Revenue earned in the month: nightly revenue for nights inside the month.
    const revenue = live.reduce((s, b) => s + nightsWithin(b, start, end) * b.nightlyRate, 0);
    const inMonth = live.filter((b) => b.checkIn >= start && b.checkIn < end);
    const gross = inMonth.reduce((s, b) => s + moneyOf(b).gross, 0);
    return {
      nights, available, occupancy: available ? Math.round((nights / available) * 100) : 0,
      revenue, adr: nights ? Math.round(revenue / nights) : 0,
      levy: Math.round(gross * TOURISM_LEVY_RATE), fees: inMonth.reduce((s, b) => s + moneyOf(b).fee, 0),
    };
  }, [live, start, end, days]);
  const awaiting = bookings.filter((b) => b.payoutStatus === "awaiting_match");

  const list = useMemo(
    () => bookings
      .filter((b) => b.checkIn < end && b.checkOut > start)
      .sort((a, b) => a.checkIn.localeCompare(b.checkIn)),
    [bookings, start, end],
  );
  const payouts = useMemo(
    () => bookings.filter((b) => b.status !== "cancelled" && b.payoutStatus !== "not_due")
      .sort((a, b) => payoutDate(b).localeCompare(payoutDate(a))),
    [bookings],
  );

  const sync = () => {
    shortStayStore.syncCalendars();
    toast.success("Calendars checked. No new bookings since the last sync.");
  };
  const importReport = () => {
    const n = shortStayStore.importPayouts();
    toast.success(n ? `${n} payout${n === 1 ? "" : "s"} added to the matching queue` : "Payout report read. Nothing new to match.");
  };
  const match = (b: Booking) => {
    matchPayout(b.id, `FT${today.replace(/-/g, "").slice(2)}${b.id.replace(/\D/g, "").padStart(3, "0")}`);
    toast.success(`KES ${kes(moneyOf(b).payout)} from ${PLATFORMS[b.platform].label} matched to the bank`);
  };
  const minutesAgo = Math.max(1, Math.round((Date.now() - lastSync) / 60_000));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Short-stay"
        description={`${STAY_UNITS.length} units at Mawingu Court let by the night. Calendars last synced ${minutesAgo} minute${minutesAgo === 1 ? "" : "s"} ago.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={sync}><RefreshCw className="h-4 w-4" /> Sync calendars</Button>
            {money && <Button variant="outline" onClick={importReport}><FileUp className="h-4 w-4" /> Import payout report</Button>}
            <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add booking</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card padding="md">
          <p className="text-[13px] text-content-muted">Occupancy, {monthName}</p>
          <p className="mt-1 text-2xl font-semibold num">{stats.occupancy}%</p>
          <p className="text-[12.5px] text-content-muted">{stats.nights} of {stats.available} nights booked</p>
        </Card>
        <Card padding="md">
          <p className="text-[13px] text-content-muted">Average nightly rate</p>
          <p className="mt-1 text-2xl font-semibold"><Money value={stats.adr} /></p>
          <p className="text-[12.5px] text-content-muted">Across booked nights</p>
        </Card>
        {money && (
          <Card padding="md">
            <p className="text-[13px] text-content-muted">Room revenue, {monthName}</p>
            <p className="mt-1 text-2xl font-semibold"><Money value={stats.revenue} /></p>
            <p className="text-[12.5px] text-content-muted">KES {kes(stats.fees)} in platform fees</p>
          </Card>
        )}
        {money && (
          <Card padding="md">
            <p className="text-[13px] text-content-muted">Payouts to match</p>
            <p className="mt-1 text-2xl font-semibold num">{awaiting.length}</p>
            <p className="text-[12.5px] text-content-muted">Tourism levy due: KES {kes(stats.levy)}</p>
          </Card>
        )}
      </div>

      <StayCalendar
        bookings={bookings}
        year={year}
        month={month}
        today={today}
        onMonthChange={(y, m) => { setYear(y); setMonth(m); }}
        onOpen={setOpen}
      />

      {money && (
        <Segmented
          label="Show"
          value={tab}
          onChange={setTab}
          options={[{ value: "bookings", label: `Bookings in ${monthName}` }, { value: "payouts", label: `Payouts${awaiting.length ? ` (${awaiting.length} to match)` : ""}` }]}
        />
      )}

      {tab === "bookings" || !money ? (
        <Table minWidth={760}>
          <THead><tr><TH>Guest</TH><TH>Unit</TH><TH>Stay</TH><TH>Booked through</TH><TH>Status</TH>{money && <TH className="text-right">Guest paid</TH>}</tr></THead>
          <TBody>
            {list.map((b) => {
              const st = statusOn(b, today);
              return (
                <TR key={b.id} className="cursor-pointer" onClick={() => setOpen(b)}>
                  <TD className="font-medium">{b.guest}</TD>
                  <TD className="text-content-secondary">{STAY_UNITS.find((u) => u.id === b.unitId)?.label}</TD>
                  <TD className="text-content-secondary">{fmtShort(b.checkIn)} to {fmtShort(b.checkOut)} · {moneyOf(b).nights} nights</TD>
                  <TD className="text-content-secondary">{PLATFORMS[b.platform].label}</TD>
                  <TD><Badge tone={STATUS_TONE[st]} withDot>{STATUS_LABEL[st]}</Badge></TD>
                  {money && <TD className="num text-right">{kes(moneyOf(b).gross)}</TD>}
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <Table minWidth={820}>
          <THead><tr><TH>Paid out</TH><TH>Guest</TH><TH>Platform</TH><TH className="text-right">Guest paid</TH><TH className="text-right">Platform fee</TH><TH className="text-right">Payout</TH><TH>Bank</TH></tr></THead>
          <TBody>
            {payouts.map((b) => {
              const m = moneyOf(b);
              return (
                <TR key={b.id}>
                  <TD className="text-content-secondary">{fmtDate(payoutDate(b))}</TD>
                  <TD className="font-medium">{b.guest}</TD>
                  <TD className="text-content-secondary">{PLATFORMS[b.platform].label}</TD>
                  <TD className="num text-right">{kes(m.gross)}</TD>
                  <TD className="num text-right text-content-secondary">({kes(m.fee)})</TD>
                  <TD className="num text-right font-medium">{kes(m.payout)}</TD>
                  <TD>
                    {b.payoutStatus === "awaiting_match"
                      ? <Button size="sm" variant="outline" onClick={() => match(b)}>Match to bank</Button>
                      : <Badge tone={PAYOUT_TONE[b.payoutStatus]} withDot>{PAYOUT_LABEL[b.payoutStatus]}</Badge>}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <p className="flex items-start gap-2 text-[12.5px] text-content-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        Demo: calendar sync and payout reports are simulated, and platform commission rates are assumptions. Short-stay operators register with the Tourism Regulatory Authority and pay a 2% tourism levy; confirm VAT and levy treatment with a tax adviser.
      </p>

      <BookingModal booking={open} onClose={() => setOpen(null)} />
      <AddBookingModal open={adding} onClose={() => setAdding(false)} bookings={bookings} />
    </div>
  );
}
