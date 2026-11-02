/**
 * "More" actions: the secondary things a page can do, grouped, so the header
 * keeps one primary action and stays readable. Built on Radix for keyboard
 * and screen-reader support.
 */
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/lib/cn";

export interface MoreItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Why it is disabled, shown in place of the label's meaning. */
  hint?: string;
}

export function MoreMenu({ groups, label = "More" }: { groups: { title: string; items: MoreItem[] }[]; label?: string }) {
  const visible = groups.filter((g) => g.items.length > 0);
  if (visible.length === 0) return null;
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-10 items-center gap-1.5 rounded-full border border-border-strong bg-surface px-4 text-[14px] font-medium text-content hover:bg-hover"
        >
          {label} <ChevronDown className="h-4 w-4" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-[220px] rounded-xl border border-border bg-surface p-1 shadow-md"
        >
          {visible.map((g, gi) => (
            <Fragment key={g.title}>
              {gi > 0 && <Dropdown.Separator className="my-1 h-px bg-border" />}
              <Dropdown.Label className="px-2.5 pb-1 pt-1.5 text-[11.5px] font-medium text-content-muted">{g.title}</Dropdown.Label>
              {g.items.map(({ label: text, icon: Icon, onSelect, danger, disabled, hint }) => (
                <Dropdown.Item
                  key={text}
                  disabled={disabled}
                  onSelect={onSelect}
                  title={hint}
                  className={cn(
                    "flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-[13.5px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-hover",
                    danger ? "text-danger" : "text-content",
                  )}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0" />}
                  {text}
                </Dropdown.Item>
              ))}
            </Fragment>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
