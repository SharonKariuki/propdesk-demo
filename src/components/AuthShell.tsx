import type { ReactNode } from "react";

import { isLocalProvider } from "@/data/config";
import { cn } from "@/lib/cn";

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Shown beside the form from lg up, and under it on smaller screens. */
  aside?: ReactNode;
}

/**
 * Sign-in, password reset and reset-confirm share this frame.
 *
 * It is a normal scrolling page — the content grows the page rather than being
 * centred into a column that clips at the top on short screens. With an
 * `aside` (the demo accounts on sign-in) the two sit side by side from lg up;
 * without one the form card is centred on its own.
 */
export default function AuthShell({ children, title, subtitle, aside }: Props) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="mx-auto flex min-h-dvh w-full max-w-[1080px] flex-col px-[18px] sm:px-8 lg:px-10">
        <main
          className={cn(
            "grid flex-1 items-center gap-6 py-8 sm:py-12 lg:gap-12",
            aside ? "lg:grid-cols-2" : "lg:grid-cols-1",
          )}
        >
          <section className={cn("mx-auto w-full max-w-[440px]", aside && "lg:mr-0")}>
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

          {aside && <section className="mx-auto w-full max-w-[440px] lg:ml-0">{aside}</section>}
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 py-5 text-[11.5px] text-content-muted sm:py-6">
          <span>© {new Date().getFullYear()} Mawingu Properties</span>
          {isLocalProvider && <span>Synthetic data · nothing leaves this browser</span>}
        </footer>
      </div>
    </div>
  );
}
