/**
 * Which permission each API route needs — the server-side half of RBAC.
 *
 * The server refuses (403) any request whose user lacks every permission
 * listed for the route, and any non-public route missing from this table, so
 * a new endpoint is closed until someone decides who may call it. "any" means
 * any signed-in user. Refusals are written to the Activity log as "denied".
 */
import type { Permission } from "@/lib/permissions";

export type Access = "any" | Permission | Permission[];

export const ROUTE_ACCESS: Record<string, Access> = {
  // ── account ──
  "GET /auth/me/": "any",
  "PATCH /auth/me/": "any",
  "POST /auth/change-password/": "any",
  "GET /auth/login-audit/": "any",
  "GET /auth/activity/": "activity.view",
  "GET /auth/users/": "users.manage",
  "PATCH /auth/users/:id/": "users.manage",
  "POST /demo/reset/": "demo.reset",
  "GET /dashboard/summary/": "any",

  // ── properties ──
  "GET /buildings/": "buildings.view",
  "POST /buildings/": "buildings.manage",
  "GET /buildings/:id/": "buildings.view",
  "PATCH /buildings/:id/": "buildings.manage",
  "DELETE /buildings/:id/": "buildings.manage",
  "POST /buildings/:id/bulk-create-units/": "buildings.manage",
  "GET /buildings/:id/photo/": "buildings.view",
  "PUT /buildings/:id/photo/": "buildings.manage",
  "DELETE /buildings/:id/photo/": "buildings.manage",
  "GET /units/": "buildings.view",
  "GET /units/status-summary/": "buildings.view",
  "POST /units/": "buildings.manage",
  "PATCH /units/:id/": "units.manage",
  "POST /units/:id/reconfigure-space/": "units.manage",
  "GET /maintenance/": "buildings.view",
  "POST /maintenance/": "maintenance.log",

  // ── tenants ──
  "GET /tenants/": "tenants.view",
  "POST /tenants/": "tenants.manage",
  "GET /tenants/export/": "tenants.statements",
  "GET /tenants/:id/": "tenants.view",
  "PATCH /tenants/:id/": "tenants.manage",
  "POST /tenants/:id/move-out-notice/": "tenants.manage",
  "POST /tenants/:id/move-out/": "tenants.manage",
  "POST /tenants/:id/move-in/": "tenants.manage",
  "GET /tenants/:id/payment-history/": "tenants.view",
  "GET /tenants/:id/statement-pdf/": "tenants.statements",
  "POST /tenants/:id/email-statement/": "tenants.statements",
  "POST /tenants/email-statements/": "tenants.statements",
  "POST /tenants/:id/documents/": "tenants.kyc_upload",
  "POST /tenants/:id/verify-kyc/": "tenants.kyc_verify",
  "POST /tenants/:id/reject-kyc/": "tenants.kyc_verify",

  // ── money in ──
  "GET /payments/": "payments.view",
  "POST /payments/": "payments.record",
  "GET /payments/recent/": "payments.view",
  "GET /payments/collection-progress/": "payments.view",
  "POST /payments/:id/resend-receipt/": "payments.record",
  "GET /payments/:id/void-preview/": "payments.void",
  "POST /payments/:id/void/": "payments.void",
  "POST /payments/mock/": "payments.record",
  "GET /transactions/": "payments.view",
  "GET /transactions/:id/": "payments.view",
  "GET /transactions/:id/receipt/": "payments.view",
  "GET /transactions/:id/receipt-pdf/": "payments.view",
  "GET /unmatched-credits/": "reconciliation.manage",
  "POST /unmatched-credits/:id/assign/": "reconciliation.manage",

  // ── water & other charges ──
  "GET /utility-charges/": ["water.view", "charges.add"],
  "POST /utility-charges/": "charges.add",
  "GET /utility-charges/options/": "charges.add",
  "GET /utility-charges/previous-reading/": "water.view",
  "POST /utility-charges/reading/": "water.record",

  // ── credits & refunds (the tenant's own position is readable with the tenant) ──
  "GET /tenant-credits/position/": "tenants.view",
  "GET /tenant-credits/": "tenants.view",
  "POST /tenant-credits/": "credits.manage",
  "GET /tenant-credits/:id/evidence/": "credits.manage",
  "POST /tenant-credits/:id/hold/": "credits.manage",
  "GET /tenant-credits/:id/void-preview/": "credits.manage",
  "POST /tenant-credits/:id/void/": "credits.manage",
  "GET /refunds/": "tenants.view",
  "POST /refunds/": "credits.manage",
  "POST /refunds/:id/mark-sent/": "credits.manage",
  "POST /refunds/:id/cancel/": "credits.manage",
  "POST /refunds/:id/void/": "credits.manage",

  // ── money out & the books ──
  "GET /expenses/": "expenses.view",
  "POST /expenses/": "expenses.manage",
  "DELETE /expenses/:id/": "expenses.manage",
  "GET /expenses/categories/": "expenses.view",
  "POST /expenses/categories/": "expenses.manage",
  "GET /manual-income/": "income.view",
  "POST /manual-income/": "income.manage",
  "DELETE /manual-income/:id/": "income.manage",
  "GET /accounting/accounts/": ["income.view", "accounting.view"],

  // ── messaging ──
  "GET /notifications/": "notifications.view",
  "GET /notifications/templates/": "notifications.view",
  "GET /notifications/sms-balance/": "notifications.view",
  "POST /notifications/send/": "notifications.send",

  // ── reports ──
  "GET /reports/income-overview/": "reports.view",
  "GET /reports/monthly-collection/": "reports.view",
  "GET /reports/annual-income/": "reports.view",
  "GET /reports/arrears/": "reports.view",
  "GET /reports/rent-balances/": "reports.view",
  "GET /reports/rent-overpayments/": "reports.view",
  "GET /reports/aging-arrears/": "reports.view",
  "GET /reports/expiring-leases/": "reports.view",
  "GET /reports/tenant-history/:id/": "reports.view",
  "GET /reports/tenant-statement/:id/": "reports.view",
  "GET /reports/unit-statement/:id/": "reports.view",
  "GET /reports/landlord-statement/": "reports.view",
  "GET /reports/occupancy/": "reports.view",
  "GET /reports/vacant-units/": "reports.view",
  "GET /reports/move-log/": "reports.view",
  "GET /reports/profit-loss/": "reports.view",
  "GET /reports/trial-balance/": "reports.view",
  "GET /reports/expense-breakdown/": "reports.view",
  "POST /reports/export/": ["reports.view", "accounting.view"],
  "GET /reports/accounting/": "accounting.view",
};
