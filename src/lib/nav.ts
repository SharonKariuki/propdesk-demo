import {
  BadgeCheck,
  BarChart3,
  BedDouble,
  PiggyBank,
  Bell,
  Building2,
  Calculator,
  CreditCard,
  Home,
  LayoutDashboard,
  Receipt,
  Scale,
  Droplets,
  History,
  Settings,
  Sprout,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { Permission } from "./permissions";

export type ViewKey =
  | "dashboard"
  | "buildings"
  | "units"
  | "tenants"
  | "payments"
  | "reconciliation"
  | "expenses"
  | "income"
  | "water"
  | "accounting"
  | "notifications"
  | "reports"
  | "activity"
  | "settings"
  | "shortstay"
  | "deposits"
  | "tax";

/** The areas the sidebar is grouped into, named after the job, not the table. */
export type NavGroup = "home" | "portfolio" | "tenants" | "money" | "accounting" | "reports" | "admin";

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  home: "",
  portfolio: "Portfolio",
  tenants: "Tenants",
  money: "Money",
  accounting: "Accounting",
  reports: "Reports",
  admin: "Admin",
};

export interface NavItem {
  key: ViewKey;
  to: string;
  label: string;
  icon: LucideIcon;
  group: NavGroup;
  togglable: boolean;
  /** Shown only to roles holding this permission (lib/permissions.ts). */
  permission?: Permission;
  description?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", group: "home", to: "/dashboard", label: "Home", icon: LayoutDashboard, togglable: false },
  { key: "buildings", group: "portfolio", permission: "buildings.view", to: "/buildings", label: "Properties", icon: Building2, togglable: true, description: "Your buildings, photos and unit mix" },
  { key: "units", group: "portfolio", permission: "buildings.view", to: "/units", label: "Units", icon: Home, togglable: true, description: "Track unit availability and rent" },
  { key: "shortstay", group: "portfolio", permission: "buildings.view", to: "/short-stay", label: "Short-stay", icon: BedDouble, togglable: true, description: "Airbnb and other nightly lettings" },
  { key: "tenants", group: "tenants", permission: "tenants.view", to: "/tenants", label: "Tenants", icon: Users, togglable: true, description: "Tenant directory, leases and KYC" },
  { key: "notifications", group: "tenants", permission: "notifications.view", to: "/notifications", label: "Messages", icon: Bell, togglable: true, description: "Reminders and alerts by SMS and email" },
  { key: "payments", group: "money", permission: "payments.view", to: "/payments", label: "Payments", icon: CreditCard, togglable: true, description: "Rent collection, M-Pesa, receipts" },
  { key: "reconciliation", group: "money", permission: "reconciliation.manage", to: "/reconciliation", label: "Reconciliation", icon: Scale, togglable: true, description: "Assign unmatched bank credits to tenants" },
  { key: "deposits", group: "money", permission: "payments.view", to: "/deposits", label: "Deposits", icon: PiggyBank, togglable: true, description: "Deposits held, settlements and refunds" },
  { key: "expenses", group: "money", permission: "expenses.view", to: "/expenses", label: "Expenses", icon: Receipt, togglable: true, description: "Operating costs and disbursements" },
  { key: "income", group: "money", permission: "income.view", to: "/income", label: "Other income", icon: Sprout, togglable: true, description: "Income that is not tenant rent" },
  { key: "water", group: "money", permission: "water.view", to: "/water", label: "Water readings", icon: Droplets, togglable: true, description: "Meter readings and water billing" },
  { key: "accounting", group: "accounting", permission: "accounting.view", to: "/accounting", label: "Books", icon: Calculator, togglable: true, description: "Ledger, trial balance, statements and checks" },
  { key: "tax", group: "accounting", permission: "accounting.view", to: "/tax", label: "Tax & eTIMS", icon: BadgeCheck, togglable: true, description: "KRA invoices, VAT and rental income tax" },
  { key: "reports", group: "reports", permission: "reports.view", to: "/reports", label: "Reports", icon: BarChart3, togglable: true, description: "Monthly report, statements and analytics" },
  { key: "activity", group: "admin", permission: "activity.view", to: "/activity", label: "Activity log", icon: History, togglable: false },
  { key: "settings", group: "admin", to: "/settings", label: "Settings", icon: Settings, togglable: false },
];
