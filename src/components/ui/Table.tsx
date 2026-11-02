import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /**
   * Width, in px, below which the table scrolls sideways instead of squeezing
   * its columns. Without it a wide table stays `w-full` at every viewport and
   * the browser crushes the columns — names truncate to "Achieng …", a building
   * name wraps over four lines and the trailing action button is clipped, all
   * while the row still "fits". Size it to the table's natural width so wide
   * screens stretch as before and narrow ones get a scrollbar instead.
   */
  minWidth?: number;
}

export function Table({ className, minWidth, ...props }: TableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-surface">
      <div className="w-full overflow-x-auto">
        <table
          className={cn("w-full border-collapse text-base", className)}
          style={minWidth ? { minWidth } : undefined}
          {...props}
        />
      </div>
    </div>
  );
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "border-b border-border text-[12px] font-medium text-content-muted",
        className
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn("transition-colors hover:bg-hover/70", className)} {...props} />
  );
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th className={cn("whitespace-nowrap px-4 py-3 text-left font-medium", className)} {...props} />
  );
}

/**
 * Data cells do not wrap. A wrapping cell contributes only its longest *word*
 * to the column width, so the layout starves the columns that matter — a name
 * ellipsises to "Achieng …" while "Mawingu Court - Kilimani" stacks over
 * four lines beside it. Nowrap lets each column ask for the width it needs and
 * the wrapper scrolls when they don't all fit. Free-text columns (a
 * description, a message preview) opt back in with `whitespace-normal` plus a
 * max-width so they wrap inside a bounded column.
 */
export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn("whitespace-nowrap px-4 py-3 align-middle text-content-secondary", className)}
      {...props}
    />
  );
}
