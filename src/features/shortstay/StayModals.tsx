import { useMemo, useState } from "react";
import toast from "react-hot-toast";

import { Money } from "@/components/ds";
import { Badge, Button, Modal } from "@/components/ui";
import { Field, inputCls } from "@/features/tenants/shared";

import {
  PLATFORMS, STAY_UNITS, TOURISM_LEVY_RATE, addDays, fmtDate, moneyOf, nightsOf, overlaps, payoutDate,
  shortStayStore, statusOn, todayIso, type Booking, type Platform,
} from "./data";
import { PAYOUT_LABEL, PAYOUT_TONE, STATUS_LABEL, STATUS_TONE } from "./labels";

export function BookingModal({ booking, onClose }: { booking: Booking | null; onClose: () => void }) {
  if (!booking) return null;
  const unit = STAY_UNITS.find((u) => u.id === booking.unitId)!;
  const m = moneyOf(booking);
  const status = statusOn(booking, todayIso());

  const cancel = () => {
    shortStayStore.update(booking.id, { status: "cancelled", payoutStatus: "not_due" });
    toast.success("Booking cancelled. The nights are free again.");
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      eyebrow={`${PLATFORMS[booking.platform].label} · ${booking.confirmation}`}
      title={booking.guest}
      size="md"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {status === "upcoming" ? (
            <Button variant="ghost" onClick={cancel}>Cancel booking</Button>
          ) : <span />}
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Badge tone={STATUS_TONE[status]} withDot>{STATUS_LABEL[status]}</Badge>
          {status !== "cancelled" && <Badge tone={PAYOUT_TONE[booking.payoutStatus]}>{PAYOUT_LABEL[booking.payoutStatus]}</Badge>}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
          <Item label="Unit" value={`${unit.label} · ${unit.name}`} />
          <Item label="Guests" value={String(booking.guests)} />
          <Item label="Check-in" value={fmtDate(booking.checkIn)} />
          <Item label="Checkout" value={fmtDate(booking.checkOut)} />
          <Item label="Nights" value={String(m.nights)} />
          <Item label="Payout expected" value={status === "cancelled" ? "None" : fmtDate(payoutDate(booking))} />
        </dl>

        <div>
          <p className="eyebrow mb-2">How the payout is worked out</p>
          <div className="rounded-xl border border-border">
            <Line label={`${m.nights} nights × KES ${booking.nightlyRate.toLocaleString()}`} value={m.accommodation} />
            <Line label="Cleaning fee charged to the guest" value={booking.cleaningFee} />
            <Line label="Guest paid" value={m.gross} strong />
            <Line label={`${PLATFORMS[booking.platform].label} commission (${Math.round(PLATFORMS[booking.platform].commission * 100)}%)`} value={-m.fee} />
            <Line label="Payout to the bank" value={m.payout} strong />
          </div>
          <p className="mt-2 text-[11.5px] text-content-muted">
            Tourism levy owed by the host: KES {m.levy.toLocaleString()} ({TOURISM_LEVY_RATE * 100}% of what the guest paid).
            Cleaner's cost per checkout: KES {unit.turnoverCost.toLocaleString()}, booked as an expense.
            {booking.bankRef && <> Matched to bank reference <span className="font-mono">{booking.bankRef}</span>.</>}
          </p>
        </div>
      </div>
    </Modal>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-content-muted">{label}</dt>
      <dd className="font-medium text-content">{value}</dd>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px] [&:not(:last-child)]:border-b [&:not(:last-child)]:border-border ${strong ? "font-semibold text-content" : "text-content-secondary"}`}>
      <span>{label}</span>
      <Money value={value} />
    </div>
  );
}

export function AddBookingModal({ open, onClose, bookings }: { open: boolean; onClose: () => void; bookings: Booking[] }) {
  const today = todayIso();
  const [unitId, setUnitId] = useState(STAY_UNITS[0].id);
  const [guest, setGuest] = useState("");
  const [guests, setGuests] = useState("2");
  const [platform, setPlatform] = useState<Platform>("direct");
  const [checkIn, setCheckIn] = useState(addDays(today, 3));
  const [checkOut, setCheckOut] = useState(addDays(today, 5));
  const unit = STAY_UNITS.find((u) => u.id === unitId)!;
  const [rate, setRate] = useState(String(unit.nightlyRate));
  const [tried, setTried] = useState(false);

  const draft = { checkIn, checkOut };
  const nights = checkIn && checkOut ? nightsOf(draft) : 0;
  const clash = useMemo(
    () => bookings.find((b) => b.unitId === unitId && b.status !== "cancelled" && checkIn && checkOut && overlaps(b, draft)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bookings, unitId, checkIn, checkOut],
  );
  const errors = {
    guest: guest.trim().length < 2 ? "Enter the guest's name" : "",
    dates: nights < 1 ? "Checkout must be after check-in" : clash ? `${unit.label} is already booked by ${clash.guest} (${fmtDate(clash.checkIn)} to ${fmtDate(clash.checkOut)})` : "",
    rate: !(Number(rate) > 0) ? "Enter the nightly rate" : "",
  };
  const valid = !errors.guest && !errors.dates && !errors.rate;
  const total = nights * Number(rate || 0) + unit.cleaningFee;

  const reset = () => {
    setGuest(""); setGuests("2"); setPlatform("direct"); setTried(false);
    setCheckIn(addDays(today, 3)); setCheckOut(addDays(today, 5));
  };
  const save = () => {
    setTried(true);
    if (!valid) return;
    shortStayStore.add({
      unitId, guest: guest.trim(), guests: Number(guests) || 1, platform, checkIn, checkOut,
      nightlyRate: Number(rate), cleaningFee: unit.cleaningFee,
    });
    toast.success(`Booked ${unit.label} for ${guest.trim()}, ${nights} night${nights === 1 ? "" : "s"}`);
    reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Short-stay"
      title="Add a booking"
      size="md"
      closeOnBackdrop={false}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-[12.5px] text-content-muted">
            {nights > 0 ? <>Guest pays <Money value={total} className="font-semibold text-content" /> incl. cleaning</> : " "}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save}>Save booking</Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Unit">
          <select value={unitId} onChange={(e) => { setUnitId(e.target.value); setRate(String(STAY_UNITS.find((u) => u.id === e.target.value)!.nightlyRate)); }} className={inputCls}>
            {STAY_UNITS.map((u) => <option key={u.id} value={u.id}>{u.label} · {u.name}</option>)}
          </select>
        </Field>
        <Field label="Booked through" hint={PLATFORMS[platform].payoutNote}>
          <select value={platform} onChange={(e) => setPlatform(e.target.value as Platform)} className={inputCls}>
            {(Object.keys(PLATFORMS) as Platform[]).map((p) => <option key={p} value={p}>{PLATFORMS[p].label}</option>)}
          </select>
        </Field>
        <Field label="Guest name" error={tried ? errors.guest : undefined} className="sm:col-span-2">
          <input value={guest} onChange={(e) => setGuest(e.target.value)} className={inputCls} placeholder="e.g. Jane Wambui" />
        </Field>
        <Field label="Check-in">
          <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Checkout" hint={nights > 0 ? `${nights} night${nights === 1 ? "" : "s"}` : undefined}>
          <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} className={inputCls} />
        </Field>
        {errors.dates && (tried || clash) && (
          <p className="-mt-2 text-[12px] text-status-unpaid sm:col-span-2" role="alert">{errors.dates}</p>
        )}
        <Field label="Nightly rate (KES)" error={tried ? errors.rate : undefined}>
          <input inputMode="numeric" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
        </Field>
        <Field label="Guests">
          <input inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value.replace(/[^\d]/g, ""))} className={inputCls} />
        </Field>
      </div>
    </Modal>
  );
}
