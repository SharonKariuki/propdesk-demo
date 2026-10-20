/**
 * Design-system building blocks shared by the hero screens (Home, Payments,
 * Income): the money figure, the black hero card, glass quick actions, KPI
 * tiles, list rows, notice banner, filter chips, segmented control, split and
 * property bars, and the actual-vs-expected bar chart.
 *
 * Rules they encode: one big tabular number leads; glass for touch, white for
 * reading, black once; gold only for "now" and progress; status as pale pills.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { cn } from "@/lib/cn";
import { compact, fmt, initials } from "@/lib/figures";

/** KES as a small muted prefix in front of a tabular figure. */
export function Money({ value, short, className, currency = "KES" }: {
  value: number; short?: boolean; className?: string; currency?: string;
}) {
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      <span className="kes">{currency}</span>
      {short ? compact(value) : fmt(value)}
    </span>
  );
}

export function Eyebrow({ children, dot, className }: { children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <p className={cn("eyebrow flex items-center gap-1.5", className)}>
      {dot && <span className="inline-block h-[7px] w-[7px] rounded-full bg-gold" aria-hidden />}
      {children}
    </p>
  );
}

// ─── header ──────────────────────────────────────────────────────────────────
export function LogoTile({ letter = "M", className }: { letter?: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-[13px] bg-[linear-gradient(135deg,#f3d48a,#c98f3a)] text-lg font-semibold text-[#1a1408] shadow-[inset_0_1px_0_rgba(255,255,255,.6),0_2px_6px_rgba(0,0,0,.15)]",
        className,
      )}
      aria-hidden
    >
      {letter}
    </div>
  );
}

// ─── hero card (one per screen) ──────────────────────────────────────────────
export function HeroCard({ eyebrow, value, subline, progress, footLeft, footRight, to, label, prefix = "KES", suffix }: {
  eyebrow: string;
  value: number;
  /** Small muted prefix (KES by default); pass "" for a plain count. */
  prefix?: string;
  suffix?: string;
  subline: ReactNode;
  /** 0–100, drawn as the gold fill. */
  progress?: number;
  footLeft?: ReactNode;
  footRight?: ReactNode;
  to?: string;
  label?: string;
}) {
  const body = (
    <div className="hero-card px-[18px] pb-4 pt-[18px]">
      <Eyebrow dot className="!text-hero-muted">{eyebrow}</Eyebrow>
      <p className="num mt-2.5 text-5xl font-semibold leading-none text-white">
        {prefix && <span className="kes">{prefix}</span>}
        {fmt(value)}
        {suffix && <span className="ml-1 text-2xl font-medium text-hero-muted">{suffix}</span>}
      </p>
      <p className="mt-2 text-[13px] text-hero-muted">{subline}</p>
      {progress !== undefined && (
        <div className="mt-4 h-[7px] w-full overflow-hidden rounded-[4px] bg-white/[0.14]">
          <div className="h-full rounded-[4px] bg-gold transition-[width] duration-700 ease-out" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
      {(footLeft || footRight) && (
        <div className="mt-3 flex items-center justify-between text-[13px] font-medium text-white">
          <span>{footLeft}</span>
          <span>{footRight}</span>
        </div>
      )}
    </div>
  );
  return to ? (
    <Link to={to} aria-label={label} className="block rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
      {body}
    </Link>
  ) : body;
}

// ─── quick actions ───────────────────────────────────────────────────────────
export function QuickAction({ icon: Icon, label, to, ariaLabel }: { icon: LucideIcon; label: string; to: string; ariaLabel?: string }) {
  return (
    <Link to={to} aria-label={ariaLabel ?? label} className="group flex min-w-0 flex-col items-center gap-2 text-center">
      {/* Fills its column as a square, up to 104px — big, thick liquid glass. */}
      <span className="glass-liquid flex aspect-square w-full max-w-[104px] items-center justify-center rounded-[24px] group-hover:-translate-y-0.5 group-active:scale-95">
        <Icon className="h-6 w-6 text-content" strokeWidth={1.6} />
      </span>
      <span className="truncate text-[12.5px] font-medium text-content">{label}</span>
    </Link>
  );
}

// ─── KPI tile ────────────────────────────────────────────────────────────────
export function KpiTile({ label, children, foot, to, ariaLabel, className }: {
  label: string; children: ReactNode; foot?: ReactNode; to?: string; ariaLabel?: string; className?: string;
}) {
  const body = (
    <div className={cn("card h-full px-[14px] py-[13px]", to && "transition-colors hover:border-border-strong", className)}>
      <p className="text-xs text-content-muted">{label}</p>
      <div className="mt-1 text-2xl font-semibold text-content">{children}</div>
      {foot && <div className="mt-1.5 text-[11.5px] text-content-muted">{foot}</div>}
    </div>
  );
  return to ? <Link to={to} aria-label={ariaLabel ?? label} className="block h-full">{body}</Link> : body;
}

// ─── panels & rows ───────────────────────────────────────────────────────────
export function PanelHeader({ title, note, className }: { title: ReactNode; note?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-1 flex items-baseline justify-between gap-3", className)}>
      <h2 className="text-[15px] font-semibold text-content">{title}</h2>
      {note && <span className="text-xs text-content-muted">{note}</span>}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span className={cn("flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-expected text-[11.5px] font-semibold text-content", className)} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function ListRow({ name, meta, amount, pill, to, onClick }: {
  name: string; meta: ReactNode; amount?: ReactNode; pill?: ReactNode; to?: string; onClick?: () => void;
}) {
  const inner = (
    <>
      <Avatar name={name} />
      <span className="min-w-0">
        <span className="block truncate text-[14px] font-semibold text-content">{name}</span>
        <span className="block truncate text-xs text-content-muted">{meta}</span>
      </span>
      <span className="flex flex-col items-end gap-1 text-right">
        {amount !== undefined && <span className="num text-[14px] font-semibold text-content">{amount}</span>}
        {pill}
      </span>
    </>
  );
  const cls = "grid grid-cols-[34px_1fr_auto] items-center gap-[11px] py-2.5";
  if (to) return <Link to={to} className={cn(cls, "rounded-lg hover:bg-hover/60")}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cn(cls, "w-full rounded-lg text-left hover:bg-hover/60")}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

/** Rows separated by hairlines, none above the first. */
export function RowList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}

// ─── notice banner ───────────────────────────────────────────────────────────
export function NoticeBanner({ icon: Icon, title, subline }: { icon: LucideIcon; title: ReactNode; subline?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] border border-notice-edge bg-notice px-[14px] py-3">
      <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] bg-white dark:bg-surface">
        <Icon className="h-[17px] w-[17px] text-warning" strokeWidth={1.7} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-semibold text-content">{title}</span>
        {subline && <span className="block text-xs text-content-muted">{subline}</span>}
      </span>
    </div>
  );
}

// ─── controls ────────────────────────────────────────────────────────────────
export function FilterChips<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string; count?: number }[]; label: string;
}) {
  return (
    <div className="flex flex-wrap gap-[7px]" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-[13px] py-[7px] text-[13px] font-medium transition-colors",
              active ? "bg-navy-800 text-white dark:text-neutral-950" : "glass text-content",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn("num text-xs", active ? "text-hero-muted" : "text-content-muted")}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Segmented<T extends string>({ value, onChange, options, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string;
}) {
  return (
    <div className="glass inline-flex p-[3px]" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
              active ? "bg-surface text-content shadow-[0_1px_3px_rgba(0,0,0,.1)]" : "text-content-muted hover:text-content",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── bars ────────────────────────────────────────────────────────────────────
/** A mix in one 6px bar, e.g. M-Pesa (ink) next to bank (gold). */
export function SplitBar({ parts }: { parts: { value: number; tone: "bar" | "gold" | "soft"; label: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total <= 0) return <div className="h-1.5 w-full rounded-[3px] bg-expected" aria-hidden />;
  return (
    <div className="flex h-1.5 w-full gap-[3px]" role="img" aria-label={parts.map((p) => `${p.label} ${fmt(p.value)}`).join(", ")}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <span
          key={p.label}
          className={cn("h-full rounded-[3px]", p.tone === "bar" ? "bg-bar" : p.tone === "gold" ? "bg-gold" : "bg-expected")}
          style={{ flex: p.value }}
        />
      ))}
    </div>
  );
}

/** Property name and amount over a 6px track filled to the share collected. */
export function PropBar({ name, amount, pct, to }: { name: string; amount: ReactNode; pct: number; to?: string }) {
  const body = (
    <div className="py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-[13.5px] font-semibold text-content">{name}</span>
        <span className="num whitespace-nowrap text-[12.5px] text-content-muted">{amount}</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-[3px] bg-expected">
        <div className="h-full rounded-[3px] bg-bar transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
  return to ? <Link to={to} className="block rounded-lg hover:bg-hover/50">{body}</Link> : body;
}

// ─── actual vs expected ──────────────────────────────────────────────────────
export interface BarPoint {
  label: string;
  actual: number;
  expected?: number;
  current?: boolean;
}

/**
 * Ghost bar (expected) behind the actual bar; the current period in gold with
 * its label in ink. Three gridlines only. No legend — the convention explains
 * itself and the panel header says what is plotted.
 */
export function GhostBarChart({ data, height = 150, label }: { data: BarPoint[]; height?: number; label: string }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.actual, d.expected ?? 0)));
  const ticks = [max, max / 2, 0];
  return (
    <figure aria-label={label} className="m-0 min-w-0">
      <div className="relative flex gap-2" style={{ height }}>
        <div className="flex w-9 shrink-0 flex-col justify-between text-right text-[10.5px] text-content-soft" aria-hidden>
          {ticks.map((t, i) => <span key={i} className="num -translate-y-1/2 leading-none first:translate-y-0 last:translate-y-0">{compact(t)}</span>)}
        </div>
        <div className="relative min-w-0 flex-1">
          {ticks.map((_, i) => (
            <div key={i} className="absolute inset-x-0 border-t border-border" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }} aria-hidden />
          ))}
          <div className="absolute inset-0 flex items-end">
            {data.map((d) => {
              const a = (d.actual / max) * 100;
              const e = ((d.expected ?? 0) / max) * 100;
              return (
                <div key={d.label} className="relative flex h-full min-w-0 flex-1 items-end justify-center" title={`${d.label}: KES ${fmt(d.actual)}${d.expected ? ` of ${fmt(d.expected)}` : ""}`}>
                  {d.expected !== undefined && (
                    <span className="absolute bottom-0 rounded-t-[5px] bg-expected" style={{ height: `${e}%`, width: "calc(46% + 6px)" }} aria-hidden />
                  )}
                  <span className={cn("relative rounded-t-[4px]", d.current ? "bg-gold" : "bg-bar")} style={{ height: `${a}%`, width: "46%" }} aria-hidden />
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-1.5 flex gap-2 pl-11" aria-hidden>
        {data.map((d) => (
          <span key={d.label} className={cn("min-w-0 flex-1 overflow-hidden text-center text-[10.5px]", d.current ? "font-semibold text-content" : "text-content-soft")}>
            {data.length > 8 ? (<><span className="sm:hidden">{d.label.charAt(0)}</span><span className="hidden sm:inline">{d.label}</span></>) : d.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        {data.map((d) => `${d.label}: ${fmt(d.actual)}${d.expected ? ` of ${fmt(d.expected)} expected` : ""}`).join("; ")}
      </figcaption>
    </figure>
  );
}
