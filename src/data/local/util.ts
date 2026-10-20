/** Small helpers shared by the local backend's services and handlers. */
import { badRequest } from "./http";

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Decimal string as Django REST Framework serialises a DecimalField. */
export const dec = (n: number | null | undefined) => (n === null || n === undefined ? null : round2(n).toFixed(2));
export const decStr = (n: number) => round2(n).toFixed(2);

export const VAT_RATE = 0.16;

export function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Today's date (local), ISO YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function isoDate(y: number, m: number, d: number) {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseIso(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/** Months since year 0 — lets month arithmetic be plain integer maths. */
export const monthKey = (year: number, month: number) => year * 12 + (month - 1);
export const fromMonthKey = (key: number) => ({ year: Math.floor(key / 12), month: (key % 12) + 1 });
export const keyOfIso = (iso: string) => {
  const { y, m } = parseIso(iso);
  return monthKey(y, m);
};
export const currentKey = () => {
  const now = new Date();
  return monthKey(now.getFullYear(), now.getMonth() + 1);
};

export function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

export function lastDayIso(year: number, month: number) {
  return isoDate(year, month, daysInMonth(year, month));
}

function utcDay(iso: string) {
  const { y, m, d } = parseIso(iso);
  return Date.UTC(y, m - 1, d);
}

export function daysBetween(fromIso: string, toIso: string) {
  return Math.round((utcDay(toIso) - utcDay(fromIso)) / 86_400_000);
}

export function addDays(iso: string, days: number) {
  const { y, m, d } = parseIso(iso);
  const date = new Date(y, m - 1, d + days);
  return todayIso(date);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
export const monthLabel = (year: number, month: number) => `${MONTHS[month - 1]} ${year}`;
export const monthShort = (month: number) => MONTHS[month - 1].slice(0, 3);

/** FormData (multipart uploads) or a JSON body, as one plain object. */
export function bodyObject(body: unknown): Record<string, unknown> {
  if (body instanceof FormData) {
    const out: Record<string, unknown> = {};
    body.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (body && typeof body === "object") return body as Record<string, unknown>;
  if (typeof body === "string" && body.trim()) {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

export function str(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

export function bool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
}

/** A money field: required → must parse; reports a DRF-style field error otherwise. */
export function money(value: unknown, field: string, { required = true, min = 0, allowZero = true } = {}): number {
  const raw = str(value);
  if (!raw) {
    if (required) throw badRequest({ [field]: ["This field is required."] });
    return 0;
  }
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) throw badRequest({ [field]: ["A valid number is required."] });
  if (n < min || (!allowZero && n === 0)) {
    throw badRequest({ [field]: [allowZero ? `Ensure this value is greater than or equal to ${min}.` : "Ensure this value is greater than 0."] });
  }
  return round2(n);
}

export function requiredStr(value: unknown, field: string): string {
  const s = str(value);
  if (!s) throw badRequest({ [field]: ["This field is required."] });
  return s;
}

export function intField(value: unknown, field: string, { min, max, required = true }: { min?: number; max?: number; required?: boolean } = {}): number {
  const raw = str(value);
  if (!raw) {
    if (required) throw badRequest({ [field]: ["This field is required."] });
    return NaN;
  }
  const n = Number(raw);
  if (!Number.isInteger(n)) throw badRequest({ [field]: ["A valid integer is required."] });
  if (min !== undefined && n < min) throw badRequest({ [field]: [`Ensure this value is greater than or equal to ${min}.`] });
  if (max !== undefined && n > max) throw badRequest({ [field]: [`Ensure this value is less than or equal to ${max}.`] });
  return n;
}

export function dateField(value: unknown, field: string, { required = true } = {}): string | null {
  const raw = str(value);
  if (!raw) {
    if (required) throw badRequest({ [field]: ["This field is required."] });
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00`).getTime())) {
    throw badRequest({ [field]: ["Date has wrong format. Use one of these formats instead: YYYY-MM-DD."] });
  }
  return raw;
}

export function idParam(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) ? n : -1;
}

export function randomId(prefix = "") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export async function sha256(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Non-secure contexts lack SubtleCrypto; a demo password check still needs to work.
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `weak-${h}`;
}

export const contains = (haystack: string | null | undefined, needle: string) =>
  (haystack ?? "").toLowerCase().includes(needle.toLowerCase());
