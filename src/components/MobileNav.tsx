import { Bell, Droplets, Plus, Receipt, Send, Sprout, UserPlus, Wallet, Wrench, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { useViewPreferences } from "@/hooks/useViewPreferences";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, type NavItem, type ViewKey } from "@/lib/nav";
import { hasPermission, type Permission } from "@/lib/permissions";

/**
 * The floating glass tab bar (phones only): four tabs and a centre "+" that
 * opens quick actions and every other section. Tabs follow the role — a
 * caretaker, who has no Payments or Reports, gets Buildings and Water instead.
 */
const TAB_PREFERENCE: ViewKey[] = ["dashboard", "payments", "reports", "tenants", "buildings", "water", "units"];

const SHORT_LABEL: Partial<Record<ViewKey, string>> = { dashboard: "Home" };

interface QuickAction {
  label: string;
  to: string;
  icon: typeof Plus;
  permission: Permission;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Record payment", to: "/payments?new=1", icon: Wallet, permission: "payments.record" },
  { label: "Add tenant", to: "/tenants?new=1", icon: UserPlus, permission: "tenants.manage" },
  { label: "Remind", to: "/notifications", icon: Send, permission: "notifications.send" },
  { label: "Record expense", to: "/expenses?new=1", icon: Receipt, permission: "expenses.manage" },
  { label: "Record income", to: "/income?new=1", icon: Sprout, permission: "income.manage" },
  { label: "Water reading", to: "/water", icon: Droplets, permission: "water.record" },
  { label: "Log a repair", to: "/buildings", icon: Wrench, permission: "maintenance.log" },
];

export default function MobileNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { prefs } = useViewPreferences();
  const { user } = useAuth();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const allowed = useMemo(
    () => NAV_ITEMS.filter(
      (item) => (!item.togglable || prefs[item.key]) && (!item.permission || hasPermission(user, item.permission)),
    ),
    [prefs, user],
  );
  const tabs = useMemo(
    () => TAB_PREFERENCE.map((k) => allowed.find((i) => i.key === k)).filter((i): i is NavItem => Boolean(i)).slice(0, 4),
    [allowed],
  );
  const rest = allowed.filter((i) => !tabs.includes(i));
  const actions = QUICK_ACTIONS.filter((a) => hasPermission(user, a.permission));

  const tab = (item: NavItem) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        className={({ isActive }) =>
          cn(
            "flex flex-col items-center justify-center gap-[3px] text-[10.5px] font-medium transition-colors",
            isActive ? "text-content" : "text-content-muted",
          )
        }
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
        {SHORT_LABEL[item.key] ?? item.label}
      </NavLink>
    );
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="fixed inset-x-4 z-40 md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom) + 18px)" }}
      >
        <div className="glass-strong grid h-[68px] grid-cols-5 items-center rounded-[34px] px-1">
          {tabs.slice(0, 2).map(tab)}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label="Quick actions and more"
              className="flex h-[50px] w-[50px] items-center justify-center rounded-full bg-navy-800 text-white shadow-fab transition-transform active:scale-95 dark:text-neutral-950"
            >
              <Plus className="h-5 w-5" strokeWidth={1.8} />
            </button>
          </div>
          {tabs.slice(2, 4).map(tab)}
        </div>
      </nav>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-50 bg-neutral-950/25 backdrop-blur-[2px] md:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Quick actions"
            className="glass-panel fixed inset-x-3 z-50 rounded-[28px] p-4 md:hidden animate-fade-up"
            style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="eyebrow">Quick actions</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="glass flex h-9 w-9 items-center justify-center"
              >
                <X className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>
            {actions.length > 0 && (
              <div className="mb-4 grid grid-cols-4 gap-2">
                {actions.slice(0, 8).map(({ label, to, icon: Icon }) => (
                  <Link key={label} to={to} className="flex flex-col items-center gap-1.5 text-center">
                    <span className="glass flex h-[54px] w-[54px] items-center justify-center rounded-[18px]">
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.7} />
                    </span>
                    <span className="text-[11.5px] font-medium leading-tight text-content">{label}</span>
                  </Link>
                ))}
              </div>
            )}
            {rest.length > 0 && (
              <>
                <p className="eyebrow mb-2">Everything else</p>
                <div className="grid grid-cols-2 gap-2">
                  {rest.map(({ to, label, icon: Icon }) => (
                    <NavLink
                      key={to}
                      to={to}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-[13px] font-medium transition-colors",
                          isActive ? "border-transparent bg-navy-800 text-white dark:text-neutral-950" : "border-border bg-surface text-content",
                        )
                      }
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.7} />
                      {label}
                    </NavLink>
                  ))}
                </div>
              </>
            )}
            {actions.length === 0 && rest.length === 0 && (
              <p className="flex items-center gap-2 text-[13px] text-content-muted"><Bell className="h-4 w-4" /> Nothing else is available to your role.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
