/**
 * Reconciliation checks: each subledger the product shows must agree with the
 * control account in the general ledger. The Accounting page shows the result
 * as a pass/fail list, so an accountant can see the books tie out.
 */
import { repos } from "../context";
import { fromMonthKey, currentKey, lastDayIso, round2 } from "../util";

/** Balances are compared as the rent roll closes this month. */
const endOfThisMonth = () => {
  const { year, month } = fromMonthKey(currentKey());
  return lastDayIso(year, month);
};
import { currentBalance, isCurrent } from "./billing";
import { settlementOf } from "./deposits";
import { buildJournal, totalsByAccount } from "./ledger";
import { fullName } from "./serializers";

export interface CheckResult {
  key: string;
  title: string;
  /** What the check compares, in plain words. */
  explanation: string;
  subledger: number;
  ledger: number;
  difference: number;
  passed: boolean;
}

export function reconciliationChecks(asOf = endOfThisMonth()) {
  const r = repos();
  const totals = totalsByAccount(buildJournal().filter((e) => e.date <= asOf));
  const bal = (code: string, creditNormal = false) => {
    const t = totals.get(code) ?? { debit: 0, credit: 0 };
    return round2(creditNormal ? t.credit - t.debit : t.debit - t.credit);
  };
  const tenantNet = round2(r.tenants.all().reduce((s, t) => s + currentBalance(t.id), 0));
  const depositsHeld = round2(r.tenants.filter(isCurrent).reduce((s, t) => s + t.deposit_paid, 0));
  const refundsOwed = round2(
    r.tenants.filter((t) => t.status === "moved_out" && t.refund_status === "pending").reduce((s, t) => s + settlementOf(t).refund, 0),
  );
  let debit = 0;
  let credit = 0;
  totals.forEach((t) => { debit += t.debit; credit += t.credit; });

  const check = (key: string, title: string, explanation: string, subledger: number, ledger: number): CheckResult => {
    const difference = round2(subledger - ledger);
    return { key, title, explanation, subledger, ledger, difference, passed: Math.abs(difference) < 0.01 };
  };
  const checks = [
    check("tenants", "Tenant accounts agree with rent receivable",
      "Every tenant's balance, added up (credits included), against account 1040.", tenantNet, bal("1040")),
    check("deposits", "Deposit register agrees with deposits held",
      "Deposits of current tenants against account 2100. Settled deposits must have left the account.", depositsHeld, bal("2100", true)),
    check("refunds", "Refunds owed agree with refunds payable",
      "Deposit refunds approved but not yet sent, against account 2150.", refundsOwed, bal("2150", true)),
    check("trial", "Debits equal credits",
      "Total debits against total credits across every account.", round2(debit), round2(credit)),
  ];
  const pending = r.tenants
    .filter((t) => t.status === "moved_out" && t.refund_status === "pending")
    .map((t) => ({ tenant_id: t.id, tenant_name: fullName(t), amount: settlementOf(t).refund, move_out_date: t.move_out_date }));
  return { as_of: asOf, checks, all_passed: checks.every((c) => c.passed), refunds_pending: pending };
}
