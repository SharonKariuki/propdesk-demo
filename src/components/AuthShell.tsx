import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

interface Props {
  children: ReactNode;
  title: string;
  subtitle?: string;
  /** Shown beside the form from lg up, and under it on smaller screens. */
  aside?: ReactNode;
}

/**
 * Sign-in, password reset and reset-confirm share this frame: the form on a
 * white card, and an optional side panel (the demo accounts on sign-in)
 * straight on the wash. It is a normal scrolling page, so on short screens the
 * content grows the page instead of being clipped at the top.
 */
export default function AuthShell({ children, title, subtitle, aside }: Props) {
  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <main
        className={cn(
          "mx-auto grid min-h-dvh w-full max-w-[960px] content-center items-center gap-8 px-[18px] py-10 sm:px-8 lg:gap-14 lg:px-10",
          aside ? "lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]" : "",
        )}
      >
        <section className={cn("mx-auto w-full max-w-[420px]", aside && "lg:mx-0")}>
          <div className="card p-5 sm:p-8">
            <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-content sm:text-4xl">{title}</h1>
            {subtitle && <p className="mt-2 text-[13px] text-content-muted">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
        </section>

        {aside && <section className="mx-auto w-full max-w-[420px] lg:mx-0 lg:max-w-[340px]">{aside}</section>}
      </main>
    </div>
  );
}
