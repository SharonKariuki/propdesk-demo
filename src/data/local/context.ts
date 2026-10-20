/**
 * The active local database, shared by every service and handler. Set once at
 * boot by `server.ts`; tests install their own (in-memory) database.
 */
import type { LocalDatabase } from "./db";

let current: LocalDatabase | null = null;

export function setDatabase(db: LocalDatabase) {
  current = db;
}

export function database(): LocalDatabase {
  if (!current) throw new Error("Local database is not initialised");
  return current;
}

/** Repositories by table — `repos().tenants.get(id)`. */
export function repos() {
  const db = database();
  return {
    users: db.repo("users"),
    buildings: db.repo("buildings"),
    units: db.repo("units"),
    tenants: db.repo("tenants"),
    documents: db.repo("documents"),
    charges: db.repo("charges"),
    payments: db.repo("payments"),
    transactions: db.repo("transactions"),
    utilityCharges: db.repo("utility_charges"),
    accounts: db.repo("accounts"),
    expenseCategories: db.repo("expense_categories"),
    expenses: db.repo("expenses"),
    manualIncome: db.repo("manual_income"),
    credits: db.repo("credits"),
    refunds: db.repo("refunds"),
    bankCredits: db.repo("bank_credits"),
    notifications: db.repo("notifications"),
    maintenance: db.repo("maintenance"),
    audit: db.repo("audit"),
    loginAttempts: db.repo("login_attempts"),
    resetTokens: db.repo("reset_tokens"),
  };
}
