import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const badge = cva(
  // Status is spoken in soft pills: dark text on a pale tint, never a block of colour.
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-[18px]",
  {
    variants: {
      tone: {
        neutral: "bg-surface-sunk text-content-secondary",
        sage: "bg-success-soft text-success",
        info: "bg-surface-sunk text-content",
        coral: "bg-danger-soft text-danger",
        ochre: "bg-warning-soft text-warning",
        peri: "bg-surface-sunk text-content-secondary",
        paid: "bg-success-soft text-success",
        partial: "bg-warning-soft text-warning",
        unpaid: "bg-danger-soft text-danger",
        vacant: "bg-surface-sunk text-content-muted",
      },
      withDot: { true: "", false: "" },
    },
    defaultVariants: { tone: "neutral", withDot: false },
  }
);

interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badge> {}

export function Badge({ className, tone, withDot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badge({ tone, withDot }), className)} {...props}>
      {withDot && (
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            tone === "paid" && "bg-success",
            tone === "partial" && "bg-warning",
            tone === "unpaid" && "bg-danger",
            tone === "vacant" && "bg-neutral-400",
            tone === "sage" && "bg-success",
            tone === "ochre" && "bg-warning",
            tone === "info" && "bg-navy-800",
            tone === "coral" && "bg-danger",
            tone === "peri" && "bg-neutral-400",
            (!tone || tone === "neutral") && "bg-neutral-400"
          )}
        />
      )}
      {children}
    </span>
  );
}
