/** Deposit settlement arithmetic, shared by the ledger, balances and statements. */
import { round2 } from "../util";

// ─── Deposit settlement ──────────────────────────────────────────────────────
export interface SettlementFigures {
  /** Deposit held at move-out. */
  held: number;
  /** Deducted for unpaid rent and applied to the tenant's account. */
  appliedToRent: number;
  /** Deducted for damage, cleaning, utilities or other reasons, kept as income. */
  kept: number;
  /** Owed back to the tenant. */
  refund: number;
}

/** How a moved-out tenant's deposit was split. Always sums to the deposit held. */
export function settlementOf(t: { deposit_paid: number; deposit_refund_amount: number; deposit_deductions?: { kind: string; amount: number }[] }): SettlementFigures {
  const deductions = t.deposit_deductions ?? [];
  const appliedToRent = round2(deductions.filter((d) => d.kind === "unpaid_rent").reduce((s, d) => s + d.amount, 0));
  const refund = round2(Math.max(0, Math.min(t.deposit_refund_amount, t.deposit_paid)));
  // Anything not refunded and not applied to rent is a kept deduction, even on
  // older records that predate itemised settlements.
  const kept = round2(Math.max(0, t.deposit_paid - refund - appliedToRent));
  return { held: round2(t.deposit_paid), appliedToRent, kept, refund };
}
