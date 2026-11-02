/**
 * "Do the books tie out?" Each tenant-level register is compared with its
 * control account. A pass is quiet; a failure says by how much and where.
 */
import { AlertTriangle, CheckCircle2, ChevronDown } from "lucide-react";
import { useState } from "react";

import { Card } from "@/components/ui";
import { useAccountingChecks } from "@/hooks/useDeposits";
import { cn } from "@/lib/cn";

const kes = (n: number) => n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ChecksPanel() {
  const { data } = useAccountingChecks();
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const failed = data.checks.filter((c) => !c.passed);
  return (
    <Card padding="none" className={cn("overflow-hidden", failed.length > 0 && "border-warning/50")}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        {failed.length === 0
          ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
          : <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />}
        <span className="flex-1">
          <span className="block text-[14px] font-medium text-content">
            {failed.length === 0 ? "The books tie out" : `${failed.length} check${failed.length === 1 ? "" : "s"} do not tie out`}
          </span>
          <span className="block text-[12.5px] text-content-muted">
            Tenant accounts, the deposit register and refunds owed are each compared with their account in the ledger.
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 text-content-muted transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <ul className="divide-y divide-border border-t border-border">
          {data.checks.map((c) => (
            <li key={c.key} className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div>
                <p className="flex items-center gap-2 text-[13.5px] font-medium">
                  {c.passed ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertTriangle className="h-4 w-4 text-warning" />}
                  {c.title}
                </p>
                <p className="pl-6 text-[12.5px] text-content-muted">{c.explanation}</p>
              </div>
              <p className="num pl-6 text-[12.5px] text-content-secondary sm:pl-0 sm:text-right">
                Register {kes(c.subledger)} · Ledger {kes(c.ledger)}
                {!c.passed && <span className="block text-warning">Difference {kes(c.difference)}</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
