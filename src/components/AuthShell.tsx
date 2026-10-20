import { BarChart3, Send, UserPlus, Wallet } from "lucide-react";
import type { ReactNode } from "react";

import { Avatar, LogoTile } from "@/components/ds";
import { Badge } from "@/components/ui";
import { isLocalProvider } from "@/data/config";

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

/**
 * Sign-in, password reset and reset-confirm share this frame.
 *
 * It is a normal scrolling page: header, a centred form card, footer. The
 * page grows when the content is taller than the screen (a short laptop, a
 * phone in landscape, a big zoom) instead of centring a column that is
 * clipped at the top. From lg up a live product preview — built from the
 * app's own components — sits beside the form.
 */
export default function AuthShell({ children, title, subtitle }: Props) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1180px] flex-col px-[18px] sm:px-8 lg:px-10">
        <header className="flex items-center justify-between gap-3 py-5 sm:py-6">
          <div className="flex items-center gap-3">
            <LogoTile />
            <div className="leading-tight">
              <p className="text-[15px] font-semibold text-content">Mawingu Properties</p>
              <p className="text-xs text-content-muted">Property suite</p>
            </div>
          </div>
          {isLocalProvider && <span className="glass px-3 py-1.5 text-xs font-medium text-content">Demo</span>}
        </header>

        <main className="grid flex-1 items-center gap-10 py-4 sm:py-8 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)] lg:gap-16">
          <section className="mx-auto w-full max-w-[440px] lg:mx-0">
            <div className="card p-5 sm:p-8">
              <p className="eyebrow flex items-center gap-1.5">
                <span className="inline-block h-[7px] w-[7px] rounded-full bg-gold" aria-hidden />
                Welcome back
              </p>
              <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-content sm:text-4xl">
                {title}
              </h1>
              {subtitle && <p className="mt-2 text-[13px] text-content-muted">{subtitle}</p>}
              <div className="mt-6 sm:mt-7">{children}</div>
            </div>
          </section>

          <ProductPreview />
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 py-5 text-[11.5px] text-content-muted sm:py-6">
          <span>© {new Date().getFullYear()} Mawingu Properties</span>
          {isLocalProvider && <span>Synthetic data · nothing leaves this browser</span>}
        </footer>
      </div>
    </div>
  );
}

/** What the suite looks like once you are in — decorative, so hidden from assistive tech. */
function ProductPreview() {
  return (
    <aside aria-hidden className="relative hidden min-w-0 lg:block">
      <p className="max-w-md text-4xl font-semibold leading-[1.1] text-content">
        Every building, every tenant, every payment — in one calm view.
      </p>
      <p className="mt-3 max-w-md text-[13px] text-content-muted">
        Rent, M-Pesa and bank payments matched automatically, arrears at a glance, and the books always balanced.
      </p>

      <div className="mt-8 max-w-[480px]">
        <div className="hero-card px-[18px] pb-4 pt-[18px]">
          <p className="eyebrow flex items-center gap-1.5 !text-hero-muted">
            <span className="inline-block h-[7px] w-[7px] rounded-full bg-gold" />
            Collected · October
          </p>
          <p className="num mt-2.5 text-5xl font-semibold leading-none text-white">
            <span className="kes">KES</span>1,126,700
          </p>
          <p className="mt-2 text-[13px] text-hero-muted">of KES 1,482,500 expected</p>
          <div className="mt-4 h-[7px] w-full overflow-hidden rounded-[4px] bg-white/[0.14]">
            <div className="h-full w-[76%] rounded-[4px] bg-gold" />
          </div>
          <div className="mt-3 flex justify-between text-[13px] font-medium text-white">
            <span>76% collected</span>
            <span>10 days left</span>
          </div>
        </div>

        <div className="mt-4 grid max-w-[360px] grid-cols-4 gap-2">
          {[[Wallet, "Record"], [UserPlus, "Add tenant"], [Send, "Remind"], [BarChart3, "Reports"]].map(([Icon, label]) => {
            const I = Icon as typeof Wallet;
            return (
              <div key={label as string} className="flex flex-col items-center gap-1.5">
                <span className="glass flex h-[54px] w-[54px] items-center justify-center !rounded-[18px]">
                  <I className="h-[18px] w-[18px] text-content" strokeWidth={1.7} />
                </span>
                <span className="text-[11.5px] font-medium text-content">{label as string}</span>
              </div>
            );
          })}
        </div>

        <div className="card mt-5 hidden max-w-[400px] px-4 py-3 xl:block">
          <div className="flex items-baseline justify-between">
            <p className="text-[15px] font-semibold text-content">M-Pesa payments</p>
            <p className="text-xs text-content-muted">Matched</p>
          </div>
          {[["Amina Wanjiru", "A-204 · Kilimani", "24,000", true], ["Kevin Mutua", "L-3 · Lavington", "20,000", false]].map(([name, meta, amount, ok]) => (
            <div key={name as string} className="grid grid-cols-[34px_1fr_auto] items-center gap-[11px] border-t border-border py-2.5 first-of-type:border-t-0">
              <Avatar name={name as string} />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-content">{name as string}</span>
                <span className="block truncate text-xs text-content-muted">{meta as string}</span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="num text-[14px] font-semibold text-content">{amount as string}</span>
                {ok ? <Badge tone="paid">✓ Matched</Badge> : <Badge tone="partial">Partial</Badge>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
