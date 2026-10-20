import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leftIcon, rightIcon, ...props }, ref) => {
    return (
      <div
        className={cn(
          "glass relative flex h-[46px] items-center rounded-full transition-shadow",
          "focus-within:ring-2 focus-within:ring-ring/25",
          className
        )}
      >
        {leftIcon && (
          <span className="pointer-events-none absolute left-4 flex items-center text-content-muted [&_svg]:h-[17px] [&_svg]:w-[17px]">
            {leftIcon}
          </span>
        )}
        <input
          ref={ref}
          className={cn(
            "w-full bg-transparent px-4 text-[14px] text-content placeholder:text-content-muted focus:outline-none",
            leftIcon && "pl-11",
            rightIcon && "pr-10"
          )}
          {...props}
        />
        {rightIcon && (
          <span className="pointer-events-none absolute right-3.5 flex items-center text-content-muted">
            {rightIcon}
          </span>
        )}
      </div>
    );
  }
);
Input.displayName = "Input";
