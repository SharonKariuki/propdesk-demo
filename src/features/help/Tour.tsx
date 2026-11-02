/**
 * A short guided tour per role. Each step points at a place in the sidebar
 * (or explains it in a card on phones, where the sidebar is hidden). It never
 * starts by itself; the dashboard offers it once and Help always has it.
 */
import { useEffect, useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui";

import { setTour, subscribeTour, tourState } from "./tourStore";

export function TourHost() {
  const tour = useSyncExternalStore(subscribeTour, tourState);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = tour?.steps[tour.index];

  useEffect(() => {
    if (!step) return;
    const el = document.querySelector<HTMLElement>(`aside a[href="${step.to}"]`);
    const measure = () => setRect(el && el.offsetParent ? el.getBoundingClientRect() : null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step]);

  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTour(null);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tour]);

  if (!tour || !step) return null;
  const last = tour.index === tour.steps.length - 1;
  const card = (
    <div role="dialog" aria-label={`Tour step ${tour.index + 1} of ${tour.steps.length}`} className="w-[300px] rounded-xl border border-border bg-surface p-4 shadow-lg">
      <p className="text-[12px] text-content-muted">Step {tour.index + 1} of {tour.steps.length}</p>
      <h3 className="mt-0.5 text-[15px] font-semibold">{step.title}</h3>
      <p className="mt-1 text-[13.5px] leading-relaxed text-content-secondary">{step.body}</p>
      <div className="mt-3 flex items-center justify-between">
        <button type="button" onClick={() => setTour(null)} className="text-[13px] text-content-muted hover:text-content">End tour</button>
        <div className="flex gap-2">
          {tour.index > 0 && <Button size="sm" variant="ghost" onClick={() => setTour({ ...tour, index: tour.index - 1 })}>Back</Button>}
          <Button size="sm" onClick={() => setTour(last ? null : { ...tour, index: tour.index + 1 })}>{last ? "Done" : "Next"}</Button>
        </div>
      </div>
    </div>
  );
  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-black/25" onClick={() => setTour(null)} aria-hidden />
      {rect ? (
        <>
          <div className="pointer-events-none absolute rounded-md ring-2 ring-gold ring-offset-2" style={{ left: rect.left - 2, top: rect.top - 2, width: rect.width + 4, height: rect.height + 4 }} />
          <div className="absolute" style={{ left: rect.right + 16, top: Math.max(12, Math.min(rect.top - 12, window.innerHeight - 220)) }}>{card}</div>
        </>
      ) : (
        <div className="absolute inset-x-0 bottom-24 flex justify-center px-4">{card}</div>
      )}
    </div>
  );
}
