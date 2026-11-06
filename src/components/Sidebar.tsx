import { ChevronLeft, ChevronRight, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "@/hooks/useAuth";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useViewPreferences } from "@/hooks/useViewPreferences";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/displayName";
import { NAV_GROUP_LABELS, NAV_ITEMS, type NavItem } from "@/lib/nav";
import { ROLE_LABELS, hasPermission, type Role } from "@/lib/permissions";

const STORAGE_KEY = "propdesk-sidebar-collapsed";

/**
 * The original dashboard's sidebar — flush, full-height, a single right
 * divider, an accent bar beside the current page, the profile pinned to the
 * bottom — in the design system's colours: glass on the wash, ink text, gold
 * for "you are here" and the brand tile.
 */
export default function Sidebar() {
  // Below lg the expanded rail costs 224px of a 768px viewport, which leaves
  // the tables and filters too little room to lay out. Force the icon rail
  // there; the saved preference applies from lg up.
  const roomToExpand = useMediaQuery("(min-width: 1024px)");

  const [preferCollapsed, setPreferCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, preferCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [preferCollapsed]);

  const collapsed = preferCollapsed || !roomToExpand;
  const toggle = () => setPreferCollapsed((c) => !c);

  const { prefs } = useViewPreferences();
  const { user, logout } = useAuth();
  const visibleItems = useMemo(
    () =>
      NAV_ITEMS.filter(
        (item) => (!item.togglable || prefs[item.key]) && (!item.permission || hasPermission(user, item.permission))
      ),
    [prefs, user]
  );

  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
  const handle = fullName || displayName(user?.email?.split("@")[0] ?? "");
  // Consecutive items of one area sit under that area's label.
  const groups = useMemo(() => {
    const out: { group: NavItem["group"]; items: NavItem[] }[] = [];
    for (const item of visibleItems) {
      const last = out.at(-1);
      if (last && last.group === item.group) last.items.push(item);
      else out.push({ group: item.group, items: [item] });
    }
    return out;
  }, [visibleItems]);
  const initials =
    (handle || "??")
      .split(/[._\- ]/)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "U";

  return (
    <aside
      className={cn(
        "hidden shrink-0 transition-[width] duration-300 ease-out print:!hidden md:sticky md:top-0 md:flex md:h-screen md:flex-col",
        collapsed ? "md:w-[72px]" : "md:w-56"
      )}
    >
      <div className="sidebar-shell relative flex h-full flex-col px-3 py-4">
        {/* Collapse toggle — pill straddling the right divider. Hidden below lg,
            where the rail is the only layout that leaves room for the page. */}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-1/2 z-10 hidden h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-navy-800 text-white shadow-fab transition-all hover:scale-110 dark:text-neutral-950 lg:flex"
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" />
          )}
        </button>

        {/* Primary nav — scrolls internally so the profile stays pinned */}
        <nav aria-label="Main" className="sidebar-nav flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pt-1">
          {groups.map(({ group, items }) => (
            <div key={group} className="flex flex-col gap-0.5">
              {NAV_GROUP_LABELS[group] && (
                collapsed
                  ? <div className="mx-auto my-1.5 h-px w-6 bg-border" aria-hidden />
                  : <p className="px-3 pb-1 pt-3 text-[11.5px] font-medium text-content-muted">{NAV_GROUP_LABELS[group]}</p>
              )}
              {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-md py-2 text-[13.5px] font-medium transition-colors",
                  collapsed ? "justify-center px-2" : "px-3",
                  isActive
                    ? "bg-white/70 text-content shadow-[0_1px_3px_rgba(0,0,0,.06)] dark:bg-white/10"
                    : "text-content-muted hover:bg-white/40 hover:text-content dark:hover:bg-white/5"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span
                      className={cn(
                        "absolute top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-gold",
                        collapsed ? "-left-[10px]" : "left-0"
                      )}
                    />
                  )}
                  <Icon
                    strokeWidth={1.7}
                    className={cn(
                      "h-[18px] w-[18px] shrink-0 transition-colors",
                      isActive ? "text-content" : "text-content-muted group-hover:text-content"
                    )}
                  />
                  {!collapsed && <span className="truncate">{label}</span>}
                </>
              )}
            </NavLink>
          ))}
            </div>
          ))}
        </nav>

        {/* Profile + logout — pinned to the bottom */}
        <div
          className={cn(
            "mt-3 flex shrink-0 items-center gap-3 border-t border-border/70 pt-4",
            collapsed ? "flex-col" : "px-3"
          )}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-expected text-xs font-semibold text-content">
            {initials}
          </div>

          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-content">
                {handle || "User"}
              </p>
              <p className="truncate text-[11.5px] text-content-muted">
                {user?.role === "owner" ? "Admin" : ROLE_LABELS[(user?.role ?? "viewer") as Role] ?? "Member"}
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Sign out"
            title="Sign out"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-content-muted transition-colors hover:bg-white/50 hover:text-content dark:hover:bg-white/5"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
