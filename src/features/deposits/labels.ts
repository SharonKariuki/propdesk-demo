/** Shared wording for deposit screens. */
import type { DepositDeductionKind } from "@/lib/types";

export const DEDUCTION_KINDS: { value: DepositDeductionKind; label: string; hint: string }[] = [
  { value: "unpaid_rent", label: "Unpaid rent", hint: "Credited to the tenant's account" },
  { value: "damage", label: "Damage and repairs", hint: "Kept as income" },
  { value: "cleaning", label: "Cleaning", hint: "Kept as income" },
  { value: "utilities", label: "Unpaid utilities", hint: "Kept as income" },
  { value: "other", label: "Other", hint: "Say what it is for" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "3 Nov 2026": the one date format people read in the product. */
export const fmtDay = (iso?: string | null) => (iso ? `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}` : "");
