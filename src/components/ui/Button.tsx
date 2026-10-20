import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";

const button = cva(
  // Anything you tap is a pill or a circle.
  "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background,box-shadow,transform,opacity] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
  {
    variants: {
      variant: {
        // Ink: the one decisive action on a screen.
        primary: "bg-navy-800 text-white hover:bg-navy-600 dark:text-neutral-950",
        secondary: "bg-navy-800 text-white hover:bg-navy-600 dark:text-neutral-950",
        // Glass: everything else you touch.
        outline: "glass text-content hover:brightness-[1.03]",
        glass: "glass text-content hover:brightness-[1.03]",
        ghost: "text-content-secondary hover:bg-white/50 hover:text-content dark:hover:bg-white/5",
        danger: "bg-danger text-white hover:brightness-105 dark:text-neutral-950",
        // Gold is never a button colour; the legacy name maps to ink.
        gold: "bg-navy-800 text-white hover:bg-navy-600 dark:text-neutral-950",
      },
      size: {
        sm: "h-8 px-3.5 text-[13px]",
        md: "h-10 px-4 text-[14px]",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-10 w-10",
        "icon-sm": "h-8 w-8",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, loading, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(button({ variant, size }), className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
);
Button.displayName = "Button";
