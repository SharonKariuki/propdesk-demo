import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";

import { HelpButton } from "@/features/help/HelpPanel";
import { TourHost } from "@/features/help/Tour";
import { useAuth } from "@/hooks/useAuth";
import { avatarFor } from "@/lib/images";

import ErrorBoundary from "./ErrorBoundary";
import GlobalSearch from "./GlobalSearch";
import MobileNav from "./MobileNav";
import NotificationBell from "./NotificationBell";
import Sidebar from "./Sidebar";

export default function AuthLayout() {
  const { user } = useAuth();
  const location = useLocation();

  const fullName =
    [user?.first_name, user?.last_name]
      .map((s) => s?.trim())
      .filter(Boolean)
      .join(" ") || "Amani Njoroge";

  return (
    <div className="relative min-h-screen">
      <div className="relative z-10 flex">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar — search, notifications, profile */}
          <header className="sticky top-0 z-30 flex items-center justify-end gap-2 px-3 py-3 print:hidden sm:px-5 lg:px-7">
            <GlobalSearch />
            <HelpButton />
            <NotificationBell />
            <button
              className="glass flex h-10 items-center gap-2.5 pl-1 pr-1 transition-colors sm:pr-3.5"
              aria-label="Account"
            >
              <img
                src={avatarFor(fullName)}
                alt=""
                aria-hidden
                className="h-8 w-8 rounded-full"
              />
              <span className="hidden text-[13px] font-semibold text-content sm:block">
                {fullName}
              </span>
            </button>
          </header>

          {/* Main */}
          <main className="flex-1 px-[18px] pb-32 pt-1 sm:px-5 md:pb-10 lg:px-7">
            <div className="mx-auto max-w-[1400px] animate-fade-up">
              {/* Keyed by path so a render error in one page is cleared on
                  navigation and never blanks the whole shell. */}
              <ErrorBoundary inline key={location.pathname}>
                <Suspense fallback={<div className="py-10 text-[13px] text-content-muted" role="status">Loading…</div>}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </div>
          </main>

          <div className="print:hidden"><MobileNav /></div>
          <TourHost />
        </div>
      </div>
    </div>
  );
}
