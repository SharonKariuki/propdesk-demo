import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

export interface DepositHeldRow {
  tenant_id: number; tenant_name: string; unit_label: string; building_name: string;
  move_in_date: string; held: number; expected: number; shortfall: number; status: string;
}
export interface DepositSettledRow {
  tenant_id: number; tenant_name: string; unit_label: string; building_name: string;
  move_out_date: string; held: number; applied_to_rent: number; kept: number; refund: number;
  refund_status: "none" | "pending" | "sent"; refund_sent_on: string | null; refund_reference: string;
}
export interface DepositRegister {
  totals: {
    held: number; held_count: number; shortfall: number; shortfall_count: number;
    refunds_owed: number; refunds_owed_count: number; kept_last_12_months: number;
  };
  held: DepositHeldRow[];
  settled: DepositSettledRow[];
}

export function useDeposits() {
  return useQuery({
    queryKey: ["deposits"],
    queryFn: async () => (await api.get<DepositRegister>("/deposits/")).data,
  });
}

export interface ReconciliationCheck {
  key: string; title: string; explanation: string;
  subledger: number; ledger: number; difference: number; passed: boolean;
}

export function useAccountingChecks(enabled = true) {
  return useQuery({
    queryKey: ["accounting-checks"],
    enabled,
    queryFn: async () => (await api.get<{ as_of: string; all_passed: boolean; checks: ReconciliationCheck[] }>("/accounting/checks/")).data,
  });
}
