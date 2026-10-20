/**
 * Stored record shapes for the local data provider.
 *
 * These are the "database rows" — normalised, with foreign keys as ids. The
 * API shapes the UI consumes (src/lib/types.ts and the hook interfaces) are
 * built from them by the serializers, exactly as the real backend's
 * serializers build JSON from its models.
 */
import type { DocumentType, KycStatus, PropertyType, TenantStatus, UnitClassification, UnitType } from "@/lib/types";

export type Role = "owner" | "accountant" | "caretaker" | "viewer";

export interface UserRow {
  id: number;
  email: string;
  username: string;
  first_name: string;
  last_name: string;
  role: Role;
  /** SHA-256 hex of the password. Demo-grade only. */
  password_hash: string;
}

export interface BuildingRow {
  id: number;
  name: string;
  code: string;
  address: string;
  total_floors: number;
  property_type: PropertyType;
  notes: string;
  /** Water tariff per unit (m³), KES. */
  water_rate: number;
  photo_file: string | null;
  photo_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface UnitRow {
  id: number;
  building: number;
  label: string;
  floor: number;
  unit_type: UnitType;
  classification: UnitClassification;
  monthly_rent: number;
  notes: string;
  statement_descriptor: string;
  under_maintenance: boolean;
  /** Head unit of a combined space this unit has been let with. */
  combined_into: number | null;
  vacant_since: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenantRow {
  id: number;
  first_name: string;
  last_name: string;
  id_number: string;
  kra_pin: string;
  phone: string;
  email: string;
  care_of: string;
  emergency_contact: string;
  emergency_phone: string;
  unit: number;
  monthly_rent: number;
  deposit_paid: number;
  agreed_deposit: number | null;
  deposit_refund_percentage: number;
  deposit_refund_amount: number;
  due_day: number;
  is_billable: boolean;
  billing_frequency: "monthly" | "quarterly";
  status: TenantStatus;
  move_in_date: string;
  move_out_date: string | null;
  notice_date: string | null;
  intended_move_out_date: string | null;
  move_out_notes: string;
  notes: string;
  kyc_status: KycStatus;
  kyc_verified_at: string | null;
  kyc_verified_by: number | null;
  kyc_notes: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentRow {
  id: number;
  tenant: number;
  doc_type: DocumentType;
  file_id: string;
  original_name: string;
  uploaded_at: string;
}

/** A month's rent charge (the backend's Arrears row). */
export interface ChargeRow {
  id: number;
  tenant: number;
  period_month: number;
  period_year: number;
  expected_rent: number;
  expected_vat: number;
  waived_amount: number;
  /** Carries a balance from before the books began rather than a billed month. */
  is_opening: boolean;
}

export type PaymentSource = "mpesa" | "bank" | "cash" | "cheque";
export type PaymentType = "rent" | "late_fee" | "deposit" | "other";

export interface PaymentRow {
  id: number;
  tenant: number;
  amount: number;
  payment_date: string;
  period_month: number;
  period_year: number;
  source: PaymentSource;
  payment_type: PaymentType;
  reference: string;
  notes: string;
  voided_at: string | null;
  void_reason: string;
  /** The bank credit this came from, when it arrived through Reconciliation. */
  bank_credit: number | null;
  transaction: number | null;
  created_at: string;
}

export interface TransactionRow {
  id: number;
  transaction_id: string;
  tenant: number;
  payment: number;
  base_amount: number;
  tax_amount: number;
  total_amount: number;
  payment_mode: "MPESA" | "BANK" | "CASH" | "CHEQUE";
  reference_code: string;
  created_at: string;
}

export type ChargeType = "utility" | "late_fee" | "parking" | "damage";

export interface UtilityChargeRow {
  id: number;
  tenant: number;
  unit: number;
  posting_date: string;
  period_month: number;
  period_year: number;
  label: string;
  opening_reading: number | null;
  closing_reading: number | null;
  units: number | null;
  amount: number;
  notes: string;
  charge_type: ChargeType;
  expense_category: number | null;
}

export interface AccountRow {
  id: number;
  code: string;
  name: string;
  account_type: "asset" | "liability" | "equity" | "income" | "expense";
  parent_code: string;
  is_header: boolean;
  description: string;
}

export interface ExpenseCategoryRow {
  id: number;
  name: string;
  description: string;
  account_code: string;
  created_at: string;
}

export interface ExpenseRow {
  id: number;
  date: string;
  building: number | null;
  unit: number | null;
  category: number;
  amount: number;
  description: string;
  reference: string;
  period_month: number;
  period_year: number;
  notes: string;
  /** Paid from the petty-cash float rather than the bank. */
  petty_cash: boolean;
  created_at: string;
  updated_at: string;
}

export interface ManualIncomeRow {
  id: number;
  date: string;
  building: number;
  account: number;
  amount: number;
  description: string;
  reference: string;
  period_month: number;
  period_year: number;
  notes: string;
  created_at: string;
}

export type CreditReason = "billing_correction" | "rent_concession" | "tenant_paid_cost" | "opening_credit";

export interface CreditRow {
  id: number;
  number: string;
  tenant: number;
  credit_type: "credit_note" | "account_credit";
  reason: CreditReason;
  credit_date: string;
  net_amount: number;
  vat_amount: number;
  amount: number;
  amount_applied: number;
  on_hold: boolean;
  description: string;
  internal_notes: string;
  reference: string;
  evidence_file: string | null;
  evidence_name: string;
  charge: number | null;
  utility_charge: number | null;
  expense_category: number | null;
  created_by: number | null;
  created_at: string;
  voided_at: string | null;
  voided_by: number | null;
  void_reason: string;
}

export interface RefundRow {
  id: number;
  number: string;
  tenant: number;
  amount: number;
  method: "mpesa" | "bank" | "cash" | "cheque";
  paid_to: string;
  reference: string;
  notes: string;
  status: "scheduled" | "sent" | "cancelled" | "void";
  sent_on: string | null;
  credit: number | null;
  created_by: number | null;
  created_at: string;
  sent_recorded_by: number | null;
  closed_by: number | null;
  close_reason: string;
}

export interface BankCreditRow {
  id: number;
  transaction_id: string;
  payment_ref: string;
  account_number: string;
  amount: number;
  channel: string;
  narration: string;
  detail: string;
  status: "unmatched" | "assigned";
  received_at: string;
  payer_phone: string;
  payer_name: string;
  void_requeue_count: number;
  assigned_payment: number | null;
}

export interface NotificationRow {
  id: number;
  tenant: number;
  channel: "sms" | "email" | "both";
  subject: string;
  body: string;
  status: "pending" | "sent" | "failed";
  sent_at: string | null;
  error: string;
  template_key: string;
  created_at: string;
}

export interface MaintenanceRow {
  id: number;
  unit: number;
  description: string;
  cost: number;
  reported_date: string;
  status: "open" | "in_progress" | "resolved";
  notes: string;
  expense: number | null;
  created_at: string;
}

export interface AuditRow {
  id: number;
  created_at: string;
  kind: "event" | "change" | "auth" | "denied";
  action: string;
  summary: string;
  object_type: string;
  object_id: number | null;
  object_label: string;
  old_values: Record<string, unknown>;
  new_values: Record<string, unknown>;
  is_financial: boolean;
  actor: number | null;
  source: "web" | "admin" | "bank" | "cron" | "command" | "system";
  source_detail: string;
  request_id: string;
}

export interface LoginAttemptRow {
  id: number;
  email: string;
  ip_address: string;
  user_agent: string;
  successful: boolean;
  attempted_at: string;
}

export interface ResetTokenRow {
  id: number;
  token: string;
  user: number;
  created_at: string;
  used: boolean;
}

export interface Meta {
  /** Bumped when the seed's shape changes, so old browser data is rebuilt. */
  schema_version: number;
  seeded_at: string;
  /** First day of the books (ISO date). */
  books_start: string;
  sms_wallet: number;
  /** Owner's capital brought in when the books opened (bank, land, buildings). */
  opening: { bank: number; land: number; buildings: number; petty_cash_float: number };
  counters: Record<string, number>;
}

export interface Tables {
  users: UserRow[];
  buildings: BuildingRow[];
  units: UnitRow[];
  tenants: TenantRow[];
  documents: DocumentRow[];
  charges: ChargeRow[];
  payments: PaymentRow[];
  transactions: TransactionRow[];
  utility_charges: UtilityChargeRow[];
  accounts: AccountRow[];
  expense_categories: ExpenseCategoryRow[];
  expenses: ExpenseRow[];
  manual_income: ManualIncomeRow[];
  credits: CreditRow[];
  refunds: RefundRow[];
  bank_credits: BankCreditRow[];
  notifications: NotificationRow[];
  maintenance: MaintenanceRow[];
  audit: AuditRow[];
  login_attempts: LoginAttemptRow[];
  reset_tokens: ResetTokenRow[];
}

export type TableName = keyof Tables;

export const TABLE_NAMES: TableName[] = [
  "users", "buildings", "units", "tenants", "documents", "charges", "payments",
  "transactions", "utility_charges", "accounts", "expense_categories", "expenses",
  "manual_income", "credits", "refunds", "bank_credits", "notifications",
  "maintenance", "audit", "login_attempts", "reset_tokens",
];

export const SCHEMA_VERSION = 1;
