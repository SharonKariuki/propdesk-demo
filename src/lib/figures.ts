/** Number formatting for figures: whole KES with commas, and compact forms. */
const whole = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

/** 1,126,700 */
export const fmt = (n: number) => whole.format(Math.round(n));

/** 418K · 13.25M — for tight spaces. */
export function compact(n: number) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000) return `${Math.round(n / 1_000)}K`;
  return fmt(n);
}

/** Two initials for an avatar: "Amina Wanjiru" → "AW". */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
