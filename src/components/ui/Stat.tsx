import { useEffect, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/cn";
import { Card } from "./Card";

interface StatProps {
  label: string;
  value: number | string;
  prefix?: string;
  suffix?: string;
  delta?: number;
  deltaLabel?: string;
  icon?: ReactNode;
  tone?: "sage" | "coral" | "ochre" | "peri";
  variant?: "glass" | "neu";
  className?: string;
  animate?: boolean;
}

// Legacy tone keys kept for call-site compatibility, remapped to the new palette.
const TONE_ICON: Record<NonNullable<StatProps["tone"]>, string> = {
  sage: "bg-info-soft text-teal-700 dark:text-teal-500",
  coral: "bg-orange-500/10 text-orange-700 dark:text-orange-500",
  ochre: "bg-navy-800/[0.06] text-navy-700 dark:bg-navy-500/15 dark:text-navy-500",
  peri: "bg-surface-sunk text-content-secondary",
};

function useCountUp(target: number, enabled: boolean, duration = 900) {
  const [val, setVal] = useState(enabled ? 0 : target);
  useEffect(() => {
    if (!enabled) {
      setVal(target);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, enabled, duration]);
  return val;
}

export function Stat({
  label,
  value,
  prefix,
  suffix,
  delta,
  deltaLabel,
  icon,
  tone = "sage",
  variant = "glass",
  className,
  animate = true,
}: StatProps) {
  const numeric = typeof value === "number" ? value : NaN;
  const shouldCount = animate && !Number.isNaN(numeric);
  const counted = useCountUp(Number.isNaN(numeric) ? 0 : numeric, shouldCount);
  const display = Number.isNaN(numeric)
    ? String(value)
    : Math.round(counted).toLocaleString();

  const positive = (delta ?? 0) >= 0;
  const currency = prefix?.trim().replace(/s+$/, "");

  // KPI tile: a 12px label, a 22px figure (KES as a small muted prefix), and
  // growth as green or red text — never a filled block.
  return (
    <Card variant={variant} padding="sm" className={cn("relative overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-content-muted">{label}</p>
        {icon && <span className={cn("text-content-muted [&_svg]:h-4 [&_svg]:w-4", TONE_ICON[tone] && "")}>{icon}</span>}
      </div>
      <p className="num mt-1.5 text-2xl font-semibold leading-none text-content">
        {currency && <span className="kes">{currency}</span>}
        <span className="tabular-nums">{display}</span>
        {suffix && <span className="ml-0.5 text-base font-medium text-content-muted">{suffix}</span>}
      </p>
      {(delta !== undefined || deltaLabel) && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-content-muted">
          {delta !== undefined && (
            <span className={cn("inline-flex items-center gap-0.5 font-semibold", positive ? "text-success" : "text-danger")}>
              {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
          {deltaLabel && <span>{deltaLabel}</span>}
        </p>
      )}
    </Card>
  );
}
