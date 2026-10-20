import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/cn";

const card = cva(
  // Cards are for reading: white, a hairline, 20px radius, no shadow.
  // Depth is reserved for glass (touch) and the hero card (what matters most).
  "relative rounded-2xl transition-colors duration-200 ease-out",
  {
    variants: {
      variant: {
        elevated: "bg-surface border border-border",
        flat: "bg-surface border border-border",
        sunk: "bg-surface-sunk",
        // The one black card per screen.
        hero: "hero-card text-white",
        // Legacy aliases: content stays on white cards, never on glass.
        glass: "bg-surface border border-border",
        "glass-strong": "bg-surface border border-border",
        neu: "bg-surface border border-border",
        "neu-sm": "bg-surface border border-border rounded-[18px]",
      },
      padding: {
        none: "",
        sm: "px-[14px] py-[13px]",
        md: "px-4 py-[14px] sm:p-5",
        lg: "p-5 sm:p-6",
      },
      interactive: {
        true: "cursor-pointer hover:border-border-strong",
        false: "",
      },
    },
    defaultVariants: {
      variant: "elevated",
      padding: "md",
      interactive: false,
    },
  }
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof card> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, padding, interactive, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(card({ variant, padding, interactive }), className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-4 flex items-baseline justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-[15px] font-semibold leading-tight text-content", className)}
      {...props}
    />
  );
}

/** Small uppercase eyebrow label — for the muted label style cards used before. */
export function CardEyebrow({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      className={cn(
        "eyebrow",
        className
      )}
      {...props}
    />
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("", className)} {...props} />;
}
