/**
 * Help, one click from anywhere: ask a question in your own words, follow a
 * short article, and jump straight to the screen where the task is done. The
 * glossary explains the money words; the tour shows a new user where things
 * live for their role.
 */
import { ArrowLeft, BookOpen, CircleHelp, Compass, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/usePermission";

import { ARTICLES, GLOSSARY, searchHelp, type HelpArticle } from "./articles";
import { setHelpOpener } from "./helpBus";
import { startTour } from "./tourStore";


export function HelpButton() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    return setHelpOpener((q) => { setQuery(q ?? ""); setOpen(true); });
  }, []);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass flex h-10 items-center gap-1.5 px-3 text-[13px] font-medium text-content"
        aria-label="Help"
      >
        <CircleHelp className="h-[18px] w-[18px]" /> <span className="hidden sm:inline">Help</span>
      </button>
      {open && <HelpDrawer initialQuery={query} onClose={() => setOpen(false)} />}
    </>
  );
}

function HelpDrawer({ initialQuery, onClose }: { initialQuery: string; onClose: () => void }) {
  const can = useCan();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [article, setArticle] = useState<HelpArticle | null>(null);
  const [tab, setTab] = useState<"tasks" | "glossary">("tasks");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const visible = useMemo(() => ARTICLES.filter((a) => !a.permission || can(a.permission)), [can]);
  const results = query.trim() ? searchHelp(query, can) : visible;
  const terms = GLOSSARY.filter((g) => !query.trim() || `${g.term} ${g.meaning}`.toLowerCase().includes(query.trim().toLowerCase()));

  const go = (to: string) => { onClose(); navigate(to); };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Help">
      <button type="button" className="absolute inset-0 bg-black/20" aria-label="Close help" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[440px] flex-col border-l border-border bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold">{article ? "Help" : "How can we help?"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-content-muted hover:bg-hover"><X className="h-5 w-5" /></button>
        </div>

        {article ? (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <button type="button" onClick={() => setArticle(null)} className="inline-flex items-center gap-1 text-[13px] text-content-muted hover:text-content">
              <ArrowLeft className="h-4 w-4" /> All help
            </button>
            <h3 className="text-xl font-semibold">{article.title}</h3>
            <p className="text-[14px] text-content-secondary">{article.summary}</p>
            <ol className="space-y-2.5">
              {article.steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-[14px] leading-relaxed">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-sunk text-[12px] font-semibold">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            <Button onClick={() => go(article.to)}>{article.cta}</Button>
          </div>
        ) : (
          <>
            <div className="space-y-3 px-5 pt-4">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted" />
                <input
                  ref={input}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Ask in your own words, e.g. how do I undo a payment?"
                  aria-label="Search help"
                  className="w-full rounded-md border border-border-strong bg-surface py-2.5 pl-9 pr-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-content/20"
                />
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTab("tasks")} className={`rounded-full px-3 py-1 text-[13px] font-medium ${tab === "tasks" ? "bg-navy-800 text-white dark:text-neutral-950" : "text-content-muted hover:bg-hover"}`}>How to</button>
                <button type="button" onClick={() => setTab("glossary")} className={`rounded-full px-3 py-1 text-[13px] font-medium ${tab === "glossary" ? "bg-navy-800 text-white dark:text-neutral-950" : "text-content-muted hover:bg-hover"}`}>What words mean</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {tab === "tasks" ? (
                results.length === 0 ? (
                  <p className="py-6 text-[14px] text-content-muted">Nothing matches that yet. Try a shorter question, such as "deposit refund" or "who owes rent".</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {results.map((a) => (
                      <li key={a.id}>
                        <button type="button" onClick={() => setArticle(a)} className="flex w-full items-start gap-3 py-3 text-left hover:bg-hover/60">
                          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-content-muted" />
                          <span>
                            <span className="block text-[14px] font-medium">{a.title}</span>
                            <span className="block text-[13px] text-content-muted">{a.summary}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <dl className="divide-y divide-border">
                  {terms.map((g) => (
                    <div key={g.term} className="py-3">
                      <dt className="text-[14px] font-medium">{g.term}</dt>
                      <dd className="text-[13px] text-content-secondary">{g.meaning}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            <div className="border-t border-border px-5 py-3">
              <Button variant="outline" size="sm" onClick={() => { onClose(); startTour(user?.role ?? "viewer"); }}>
                <Compass className="h-4 w-4" /> Take the one-minute tour
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
