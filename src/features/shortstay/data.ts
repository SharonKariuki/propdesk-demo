/**
 * Short-stay (Airbnb-style) letting — demo data and money rules.
 *
 * Front-end only: bookings and payouts are generated around today's date so
 * the demo never goes stale, and kept in this browser for the day. Nothing is
 * sent to Airbnb or any other platform.
 *
 * Money for one stay:
 *   guest total   = nights × nightly rate + cleaning fee
 *   platform fee  = guest total × the platform's commission
 *   payout        = guest total − platform fee   (what reaches the bank)
 *   tourism levy  = 2% of the guest total, owed by the host
 * Commission rates are demo assumptions, not quotes from the platforms.
 */
import { useSyncExternalStore } from "react";

export type Platform = "airbnb" | "booking" | "direct";
export type BookingStatus = "upcoming" | "in_house" | "checked_out" | "cancelled";
export type PayoutStatus = "not_due" | "awaiting_match" | "matched";

export interface StayUnit {
  id: string;
  label: string;
  name: string;
  building: string;
  nightlyRate: number;
  cleaningFee: number;
  /** Cost of a cleaner per checkout, booked as an expense. */
  turnoverCost: number;
}

export interface Booking {
  id: string;
  unitId: string;
  guest: string;
  guests: number;
  platform: Platform;
  /** ISO dates. checkOut is the morning the guest leaves (not a night stayed). */
  checkIn: string;
  checkOut: string;
  nightlyRate: number;
  cleaningFee: number;
  status: BookingStatus;
  payoutStatus: PayoutStatus;
  /** Bank or M-Pesa reference the payout was matched to. */
  bankRef?: string;
  confirmation: string;
}

export const PLATFORMS: Record<Platform, { label: string; commission: number; payoutNote: string }> = {
  airbnb: { label: "Airbnb", commission: 0.03, payoutNote: "Paid about a day after check-in" },
  booking: { label: "Booking.com", commission: 0.15, payoutNote: "Paid monthly, after checkout" },
  direct: { label: "Direct", commission: 0, payoutNote: "Paid by the guest by M-Pesa" },
};

export const TOURISM_LEVY_RATE = 0.02;

export const STAY_UNITS: StayUnit[] = [
  { id: "s1", label: "KC-S1", name: "Studio", building: "Mawingu Court - Kilimani", nightlyRate: 4500, cleaningFee: 1000, turnoverCost: 1200 },
  { id: "s2", label: "KC-S2", name: "1 bedroom", building: "Mawingu Court - Kilimani", nightlyRate: 6500, cleaningFee: 1500, turnoverCost: 1500 },
  { id: "s3", label: "KC-S3", name: "2 bedroom", building: "Mawingu Court - Kilimani", nightlyRate: 9500, cleaningFee: 2000, turnoverCost: 2000 },
];

// ─── dates (UTC day arithmetic so time zones never shift a stay) ─────────────
const DAY = 86_400_000;
export const toDay = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
export const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromDay(toDay(iso) + n);
export function todayIso() {
  const d = new Date();
  return fromDay(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}
export const nightsOf = (b: Pick<Booking, "checkIn" | "checkOut">) => Math.max(0, toDay(b.checkOut) - toDay(b.checkIn));

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "4 Nov 2026" — the one display format for dates in this module. */
export const fmtDate = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
export const fmtShort = (iso: string) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
export const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;

// ─── money ───────────────────────────────────────────────────────────────────
export function moneyOf(b: Booking) {
  const nights = nightsOf(b);
  const accommodation = nights * b.nightlyRate;
  const gross = accommodation + b.cleaningFee;
  const fee = Math.round(gross * PLATFORMS[b.platform].commission);
  return { nights, accommodation, gross, fee, payout: gross - fee, levy: Math.round(gross * TOURISM_LEVY_RATE) };
}

/** Nights of a booking that fall inside [start, end) — for monthly occupancy. */
export function nightsWithin(b: Booking, start: string, end: string) {
  const a = Math.max(toDay(b.checkIn), toDay(start));
  const z = Math.min(toDay(b.checkOut), toDay(end));
  return Math.max(0, z - a);
}

export function overlaps(a: Pick<Booking, "checkIn" | "checkOut">, b: Pick<Booking, "checkIn" | "checkOut">) {
  return toDay(a.checkIn) < toDay(b.checkOut) && toDay(b.checkIn) < toDay(a.checkOut);
}

/** Status a booking should have today, unless it was cancelled. */
export function statusOn(b: Booking, today: string): BookingStatus {
  if (b.status === "cancelled") return "cancelled";
  if (toDay(today) < toDay(b.checkIn)) return "upcoming";
  if (toDay(today) < toDay(b.checkOut)) return "in_house";
  return "checked_out";
}

/** When the platform releases the payout. */
export function payoutDate(b: Booking) {
  if (b.platform === "airbnb") return addDays(b.checkIn, 1);
  if (b.platform === "booking") {
    // The 5th of the month after checkout.
    const y = +b.checkOut.slice(0, 4);
    const m = +b.checkOut.slice(5, 7);
    return m === 12 ? `${y + 1}-01-05` : `${y}-${String(m + 1).padStart(2, "0")}-05`;
  }
  return b.checkIn;
}

// ─── seed ────────────────────────────────────────────────────────────────────
const GUESTS = [
  "Daniel Otieno", "Grace Wanjiru", "Hannah Müller", "Kevin Mwangi", "Aisha Hassan", "Tom Becker",
  "Faith Achieng", "Samuel Kiprono", "Priya Nair", "Brian Odhiambo", "Lucy Njeri", "Marco Rossi",
  "Wanjiku Kamau", "Peter Mutua", "Chloe Martin", "Joseph Wekesa", "Esther Chebet", "Liam O'Brien",
  "Mercy Atieno", "Ahmed Yusuf", "Naomi Wairimu", "Felix Omondi", "Sara Lindqvist", "David Kariuki",
];

/** Deterministic pseudo-random sequence, so every load shows the same story. */
function seq(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function seedBookings(today: string): Booking[] {
  const rand = seq(20261101);
  const out: Booking[] = [];
  let g = 0;
  let n = 1;
  // Roughly 45 days back to 45 days ahead, per unit, with gaps between stays.
  for (const unit of STAY_UNITS) {
    let day = toDay(today) - 45 + Math.floor(rand() * 4);
    const end = toDay(today) + 45;
    while (day < end) {
      const nights = 1 + Math.floor(rand() * (unit.id === "s3" ? 6 : 4));
      const r = rand();
      const platform: Platform = r < 0.62 ? "airbnb" : r < 0.85 ? "booking" : "direct";
      const checkIn = fromDay(day);
      const checkOut = fromDay(day + nights);
      const b: Booking = {
        id: `bk${n}`,
        unitId: unit.id,
        guest: GUESTS[g++ % GUESTS.length],
        guests: 1 + Math.floor(rand() * (unit.id === "s1" ? 2 : 4)),
        platform,
        checkIn,
        checkOut,
        nightlyRate: unit.nightlyRate + (rand() < 0.3 ? 500 : 0),
        cleaningFee: unit.cleaningFee,
        status: "upcoming",
        payoutStatus: "not_due",
        confirmation: `${platform === "airbnb" ? "HM" : platform === "booking" ? "BK" : "DR"}${String(4810 + n * 37).slice(-4)}${"QWXZRTPL".at(n % 8)}`,
      };
      b.status = statusOn(b, today);
      const paid = toDay(payoutDate(b)) <= toDay(today);
      // Older payouts are already matched to the bank; the last few wait in the queue.
      b.payoutStatus = !paid ? "not_due" : toDay(payoutDate(b)) < toDay(today) - 4 ? "matched" : "awaiting_match";
      if (b.payoutStatus === "matched") b.bankRef = `FT${checkIn.replace(/-/g, "").slice(2)}${String(n).padStart(3, "0")}`;
      out.push(b);
      n += 1;
      day += nights + (rand() < 0.35 ? 0 : 1 + Math.floor(rand() * 3));
    }
  }
  // One recent cancellation, so the status is visible.
  const cancel = out.find((b) => b.status === "upcoming" && b.unitId === "s2");
  if (cancel) {
    cancel.status = "cancelled";
    cancel.payoutStatus = "not_due";
  }
  return out;
}

// ─── session store ───────────────────────────────────────────────────────────
type Listener = () => void;
let bookings: Booking[] | null = null;
let lastSync = Date.now() - 11 * 60_000;
const listeners = new Set<Listener>();

const STORAGE_KEY = "propdesk-shortstay-v1";

function emit() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ seededOn: todayIso(), bookings, lastSync }));
  } catch {
    // Storage full or blocked: the session copy still works.
  }
  listeners.forEach((l) => l());
}
function ensure() {
  if (!bookings) {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { seededOn: string; bookings: Booking[]; lastSync: number } | null;
      // Kept for the day it was made, so the demo story stays centred on today.
      if (saved && saved.seededOn === todayIso() && Array.isArray(saved.bookings)) {
        bookings = saved.bookings;
        lastSync = saved.lastSync;
      }
    } catch {
      // Unreadable: start again from the seed.
    }
  }
  if (!bookings) bookings = seedBookings(todayIso());
  return bookings;
}

export const shortStayStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getBookings: () => ensure(),
  getLastSync: () => lastSync,
  add(b: Omit<Booking, "id" | "status" | "payoutStatus" | "confirmation">) {
    const list = ensure();
    const id = `bk${list.length + 1000}`;
    const booking: Booking = {
      ...b, id, status: "upcoming", payoutStatus: "not_due",
      confirmation: `${b.platform === "airbnb" ? "HM" : b.platform === "booking" ? "BK" : "DR"}${String(Date.now()).slice(-5)}`,
    };
    booking.status = statusOn(booking, todayIso());
    bookings = [...list, booking];
    emit();
    return booking;
  },
  update(id: string, patch: Partial<Booking>) {
    bookings = ensure().map((b) => (b.id === id ? { ...b, ...patch } : b));
    emit();
  },
  /** Simulates reading the platform's payout report: payouts now due join the matching queue. */
  importPayouts() {
    const today = todayIso();
    let count = 0;
    bookings = ensure().map((b) => {
      if (b.status !== "cancelled" && b.payoutStatus === "not_due" && toDay(payoutDate(b)) <= toDay(today)) {
        count += 1;
        return { ...b, payoutStatus: "awaiting_match" as const };
      }
      return b;
    });
    emit();
    return count;
  },
  syncCalendars() {
    lastSync = Date.now();
    emit();
  },
};

export function useShortStay() {
  const list = useSyncExternalStore(shortStayStore.subscribe, shortStayStore.getBookings);
  const synced = useSyncExternalStore(shortStayStore.subscribe, shortStayStore.getLastSync);
  return { bookings: list, lastSync: synced };
}

/** Marks a payout as found on the bank statement. */
export function matchPayout(id: string, bankRef: string) {
  shortStayStore.update(id, { payoutStatus: "matched", bankRef });
}

/** Clears the session's changes (used by Settings, Reset demo data). */
export function resetShortStay() {
  bookings = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  ensure();
  emit();
}
