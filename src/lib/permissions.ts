/**
 * Role-based access control — the one place that says who may do what.
 *
 * The local API enforces these permissions route by route; the UI reads the
 * same matrix to hide navigation, guard routes and drop buttons a role cannot
 * use. A real backend can send `permissions` on the user object instead, and
 * the UI will use that list in preference to the role defaults below.
 */
export type Role = "owner" | "accountant" | "caretaker" | "viewer";

export const PERMISSIONS = [
  // Properties
  "buildings.view", "buildings.manage", "units.manage", "maintenance.log",
  // Tenants
  "tenants.view", "tenants.manage", "tenants.kyc_upload", "tenants.kyc_verify", "tenants.statements",
  // Money in
  "payments.view", "payments.record", "payments.void", "reconciliation.manage",
  "charges.add", "credits.manage",
  // Water
  "water.view", "water.record",
  // Money out and the books
  "expenses.view", "expenses.manage", "income.view", "income.manage",
  "accounting.view", "reports.view",
  // Messaging
  "notifications.view", "notifications.send",
  // Administration
  "activity.view", "users.manage", "demo.reset",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ALL: Permission[] = [...PERMISSIONS];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  /** Owner / admin: everything, including reversing money and running the system. */
  owner: ALL,
  /** Accountant: runs the money day to day, but cannot reverse it or change the portfolio. */
  accountant: [
    "buildings.view", "maintenance.log",
    "tenants.view", "tenants.manage", "tenants.kyc_upload", "tenants.kyc_verify", "tenants.statements",
    "payments.view", "payments.record", "reconciliation.manage",
    "water.view", "water.record",
    "expenses.view", "expenses.manage", "income.view", "income.manage",
    "accounting.view", "reports.view",
    "notifications.view", "notifications.send",
  ],
  /** Caretaker: on-site work — meters, maintenance, tenant contacts and documents. No money. */
  caretaker: [
    "buildings.view", "maintenance.log",
    "tenants.view", "tenants.kyc_upload",
    "water.view", "water.record",
  ],
  /** Viewer: read-only across the operational screens. */
  viewer: ["buildings.view", "tenants.view", "water.view"],
};

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner / Admin",
  accountant: "Accountant",
  caretaker: "Caretaker",
  viewer: "Viewer",
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  "buildings.view": "See properties and units",
  "buildings.manage": "Add, edit and delete properties",
  "units.manage": "Change unit rent and combined spaces",
  "maintenance.log": "Log maintenance",
  "tenants.view": "See tenants",
  "tenants.manage": "Register, edit, give notice, move out",
  "tenants.kyc_upload": "Upload KYC documents",
  "tenants.kyc_verify": "Verify or reject KYC",
  "tenants.statements": "Download and email statements",
  "payments.view": "See payments and receipts",
  "payments.record": "Record payments",
  "payments.void": "Void payments",
  "reconciliation.manage": "Match bank credits",
  "charges.add": "Add charges (fees, recharges)",
  "credits.manage": "Issue credits and refunds",
  "water.view": "See water readings",
  "water.record": "Record water readings",
  "expenses.view": "See expenses",
  "expenses.manage": "Record and delete expenses",
  "income.view": "See manual income",
  "income.manage": "Record and delete manual income",
  "accounting.view": "Accounting suite",
  "reports.view": "Reports",
  "notifications.view": "See messages and the SMS wallet",
  "notifications.send": "Send SMS and email",
  "activity.view": "Activity log",
  "users.manage": "Change team members' roles",
  "demo.reset": "Reset the demo data",
};

export function permissionsForRole(role: string | undefined | null): Permission[] {
  return ROLE_PERMISSIONS[(role ?? "viewer") as Role] ?? ROLE_PERMISSIONS.viewer;
}

interface UserLike {
  role?: unknown;
  permissions?: unknown;
}

/** Does this user hold the permission? Server-sent `permissions` win over role defaults. */
export function hasPermission(user: UserLike | null | undefined, permission: Permission): boolean {
  if (!user) return false;
  if (Array.isArray(user.permissions)) return user.permissions.includes(permission);
  return permissionsForRole(typeof user.role === "string" ? user.role : undefined).includes(permission);
}
