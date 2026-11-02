import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: Props) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {/* The area name is already in the sidebar, so the eyebrow is not repeated here. */}
        {eyebrow && <span className="sr-only">{eyebrow}: </span>}
        <h1 className="text-3xl font-semibold text-content">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[13px] text-content-muted">{description}</p>
        )}
      </div>
      {actions && (
        // shrink-0 so a long title/description gives way first — without it the
        // actions are squeezed until each button drops onto its own line.
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5">{actions}</div>
      )}
    </div>
  );
}
