/**
 * Month view of short-stay units: one row per unit, one column per night.
 * A stay is drawn from its check-in night to the night before checkout, so a
 * checkout and the next check-in can share a day without overlapping.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/cn";

import {
  PLATFORMS, STAY_UNITS, fromDay, monthLabel, statusOn, toDay, type Booking,
} from "./data";

interface Props {
  bookings: Booking[];
  year: number;
  month: number;
  today: string;
  onMonthChange: (year: number, month: number) => void;
  onOpen: (b: Booking) => void;
}

const BAR: Record<string, string> = {
  checked_out: "bg-surface-sunk text-content-secondary",
  in_house: "bg-navy-800 text-white dark:text-neutral-950",
  upcoming: "bg-surface text-content border border-border-strong",
};

export function StayCalendar({ bookings, year, month, today, onMonthChange, onOpen }: Props) {
  const start = toDay(`${year}-${String(month).padStart(2, "0")}-01`);
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = start + days;
  const todayN = toDay(today);
  const pct = (n: number) => `${((n - start) / days) * 100}%`;

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    onMonthChange(d.getUTCFullYear(), d.getUTCMonth() + 1);
  };

  return (
    <div className="card overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => shift(-1)} className="rounded-full p-1.5 text-content-secondary hover:bg-hover" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-[96px] text-center text-[15px] font-semibold text-content">{monthLabel(year, month)}</h2>
          <button type="button" onClick={() => shift(1)} className="rounded-full p-1.5 text-content-secondary hover:bg-hover" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="hidden items-center gap-3 text-[11.5px] text-content-muted sm:flex">
          <Legend className={BAR.in_house} label="In house" />
          <Legend className={BAR.upcoming} label="Upcoming" />
          <Legend className={BAR.checked_out} label="Checked out" />
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          {/* Day numbers */}
          <div className="flex border-b border-border">
            <div className="w-36 shrink-0 px-4 py-2 text-[12px] text-content-muted">Unit</div>
            <div className="relative flex flex-1">
              {Array.from({ length: days }, (_, i) => {
                const n = start + i;
                const dow = new Date(n * 86_400_000).getUTCDay();
                const isToday = n === todayN;
                return (
                  <div
                    key={n}
                    className={cn(
                      "flex-1 py-2 text-center text-[11px] tabular-nums",
                      dow === 0 || dow === 6 ? "text-content-muted" : "text-content-secondary",
                      isToday && "font-semibold text-content",
                    )}
                  >
                    {isToday ? <span className="rounded-full bg-gold px-1.5 py-0.5 text-[#1a1408]">{i + 1}</span> : i + 1}
                  </div>
                );
              })}
            </div>
          </div>

          {STAY_UNITS.map((unit) => {
            const row = bookings.filter(
              (b) => b.unitId === unit.id && b.status !== "cancelled" && toDay(b.checkIn) < end && toDay(b.checkOut) > start,
            );
            return (
              <div key={unit.id} className="flex border-b border-border last:border-b-0">
                <div className="w-36 shrink-0 px-4 py-3">
                  <p className="text-[13px] font-semibold text-content">{unit.label}</p>
                  <p className="text-[11.5px] text-content-muted">{unit.name}</p>
                </div>
                <div className="relative h-[60px] flex-1">
                  {/* weekend shading */}
                  {Array.from({ length: days }, (_, i) => {
                    const dow = new Date((start + i) * 86_400_000).getUTCDay();
                    return dow === 0 || dow === 6 ? (
                      <div key={i} className="absolute inset-y-0 bg-surface-sunk/50" style={{ left: pct(start + i), width: `${100 / days}%` }} aria-hidden />
                    ) : null;
                  })}
                  {todayN >= start && todayN < end && (
                    <div className="absolute inset-y-0 w-px bg-gold" style={{ left: pct(todayN + 0.5) }} aria-hidden />
                  )}
                  {row.map((b) => {
                    const a = Math.max(toDay(b.checkIn), start);
                    const z = Math.min(toDay(b.checkOut), end);
                    const status = statusOn(b, today);
                    const startsBefore = toDay(b.checkIn) < start;
                    const endsAfter = toDay(b.checkOut) > end;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => onOpen(b)}
                        title={`${b.guest} · ${PLATFORMS[b.platform].label} · ${b.checkIn} to ${b.checkOut}`}
                        aria-label={`${b.guest}, ${PLATFORMS[b.platform].label}, from ${fromDay(a)}`}
                        className={cn(
                          "absolute top-[12px] flex h-9 items-center overflow-hidden px-2 text-left text-[11.5px] font-medium leading-tight transition-[filter] hover:brightness-95",
                          BAR[status],
                          startsBefore ? "rounded-l-none" : "rounded-l-lg",
                          endsAfter ? "rounded-r-none" : "rounded-r-lg",
                        )}
                        style={{ left: `calc(${pct(a)} + 2px)`, width: `calc(${((z - a) / days) * 100}% - 4px)` }}
                      >
                        <span className="truncate">
                          {b.guest.split(" ")[0]}
                          <span className="opacity-70"> · {PLATFORMS[b.platform].label}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-2.5 w-4 rounded-sm", className)} aria-hidden />
      {label}
    </span>
  );
}
