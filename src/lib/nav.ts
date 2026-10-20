import {
  BarChart3,
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
  | "settings";

export interface NavItem {
  key: ViewKey;
  to: string;
  label: string;
  icon: LucideIcon;
  togglable: boolean;
  /** Shown only to roles holding this permission (lib/permissions.ts). */
  permission?: Permission;
  description?: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, togglable: false },
  { key: "buildings", permission: "buildings.view", to: "/buildings", label: "Buildings", icon: Building2, togglable: true, description: "Manage your properties and bank details" },
  { key: "units", permission: "buildings.view", to: "/units", label: "Units", icon: Home, togglable: true, description: "Track unit availability and rent" },
  { key: "tenants", permission: "tenants.view", to: "/tenants", label: "Tenants", icon: Users, togglable: true, description: "Tenant directory and KYC" },
  { key: "payments", permission: "payments.view", to: "/payments", label: "Payments", icon: CreditCard, togglable: true, description: "Rent collection, M-Pesa, receipts" },
  { key: "reconciliation", permission: "reconciliation.manage", to: "/reconciliation", label: "Reconciliation", icon: Scale, togglable: true, description: "Assign unmatched bank credits to tenants" },
  { key: "expenses", permission: "expenses.view", to: "/expenses", label: "Expenses", icon: Receipt, togglable: true, description: "Operating costs and disbursements" },
  { key: "income", permission: "income.view", to: "/income", label: "Income", icon: Sprout, togglable: true, description: "Manual income (farm produce, non-tenant)" },
  { key: "water", permission: "water.view", to: "/water", label: "Water", icon: Droplets, togglable: true, description: "Meter readings and water billing" },
  { key: "accounting", permission: "accounting.view", to: "/accounting", label: "Accounting", icon: Calculator, togglable: true, description: "Chart of accounts, P&L, balance sheet" },
  { key: "notifications", permission: "notifications.view", to: "/notifications", label: "Notifications", icon: Bell, togglable: true, description: "Reminders and alerts" },
  { key: "reports", permission: "reports.view", to: "/reports", label: "Reports", icon: BarChart3, togglable: true, description: "Statements and analytics" },
  { key: "activity", permission: "activity.view", to: "/activity", label: "Activity", icon: History, togglable: false },
  { key: "settings", to: "/settings", label: "Settings", icon: Settings, togglable: false },
];
