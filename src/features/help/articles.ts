/**
 * In-app help: short task articles, a glossary of the money words, and a
 * search that understands what people mean rather than the exact words
 * ("undo a payment" finds "Reverse a payment"). Each article ends at the
 * screen where the task is done.
 *
 * The search is a small synonym-aware ranker, enough for a demo. A production
 * build would swap in embedding search over the same articles.
 */
import type { Permission } from "@/lib/permissions";

export interface HelpArticle {
  id: string;
  title: string;
  /** One line: what this is for. */
  summary: string;
  steps: string[];
  /** Where the task is done, and the button that takes you there. */
  to: string;
  cta: string;
  keywords: string[];
  permission?: Permission;
}

export const ARTICLES: HelpArticle[] = [
  {
    id: "record-payment", title: "Record a payment", summary: "Log rent paid in cash, by M-Pesa or by bank when it was not matched automatically.",
    steps: ["Open the tenant's page and choose Record payment. The tenant and the amount owed are filled in.", "Pick how it was paid and add the M-Pesa code or bank reference.", "Save. The receipt is created and the tenant's balance, the dashboard and the books update straight away."],
    to: "/payments?new=1", cta: "Record a payment", keywords: ["pay", "paid", "receive", "receipt", "rent", "mpesa", "cash", "log", "enter", "money in"], permission: "payments.record",
  },
  {
    id: "reverse-payment", title: "Reverse (void) a payment", summary: "Undo a payment entered by mistake. The original stays on record with a reversal beside it.",
    steps: ["Go to Payments and find the payment.", "Choose Void and give the reason (for example, entered twice).", "The tenant's balance goes back up and the books show both the payment and its reversal, so nothing is lost."],
    to: "/payments", cta: "Go to Payments", keywords: ["undo", "void", "reverse", "cancel", "delete", "mistake", "wrong", "duplicate", "remove", "refund"], permission: "payments.void",
  },
  {
    id: "match-bank", title: "Match an unknown bank or M-Pesa credit", summary: "Money that arrived without a recognisable account number waits in Reconciliation.",
    steps: ["Open Reconciliation. Each unmatched credit shows a suggested tenant where one fits.", "Confirm the suggestion or pick the right tenant.", "It becomes a payment on that tenant's account."],
    to: "/reconciliation", cta: "Open Reconciliation", keywords: ["unmatched", "unknown", "bank", "statement", "match", "assign", "reconcile", "suspense"], permission: "reconciliation.manage",
  },
  {
    id: "move-out", title: "Move a tenant out and settle the deposit", summary: "Free the unit, deduct what is owed from the deposit, and work out the refund.",
    steps: ["On the tenant's page choose More, then Move out and settle deposit.", "Unpaid rent is filled in as a deduction. Add damage or cleaning lines with a short description.", "Enter the refund as an amount or a percentage. The form will only save once the deposit is fully explained.", "Unpaid rent is credited to the tenant's account; the rest of the deductions are kept as income; the refund is owed until you record it as sent."],
    to: "/tenants", cta: "Find the tenant", keywords: ["move out", "leave", "vacate", "deposit", "refund", "deduct", "damage", "settlement", "exit", "notice"], permission: "tenants.manage",
  },
  {
    id: "refund-sent", title: "Record a deposit refund as sent", summary: "After the money leaves the deposit account, record it so the tenant's statement and the books show it.",
    steps: ["Open Deposits and choose Settled. Refunds still owed are marked.", "Open the tenant and choose Record refund sent.", "Enter the M-Pesa code or bank reference and the date."],
    to: "/deposits", cta: "Open Deposits", keywords: ["refund", "deposit", "send back", "return", "pay back", "owed"], permission: "credits.manage",
  },
  {
    id: "monthly-report", title: "Send directors the monthly report", summary: "A one-page summary of collections, arrears, occupancy and property performance.",
    steps: ["Open Reports. The monthly report is the first page.", "Use the arrows to pick the month.", "Download it as PDF or Excel, or print it with the charts."],
    to: "/reports?tab=management", cta: "Open the monthly report", keywords: ["report", "directors", "board", "summary", "monthly", "pdf", "excel", "export", "download", "owner"], permission: "reports.view",
  },
  {
    id: "arrears", title: "See who owes rent", summary: "Overdue means past the due day; this month's rent before the due day is shown separately.",
    steps: ["The dashboard shows the overdue total and how much is not yet due.", "Reports, Collections and arrears, Arrears by age shows how old each debt is.", "From any tenant, send a reminder by SMS or email."],
    to: "/reports?tab=aging", cta: "See arrears by age", keywords: ["arrears", "owe", "overdue", "debt", "late", "unpaid", "balance", "defaulters", "chase", "remind"],
  },
  {
    id: "etims", title: "Fix an invoice KRA did not accept", summary: "Rent invoices for VAT-registered lettings go to eTIMS. A few need a correction first.",
    steps: ["Open Tax & eTIMS and choose Need attention.", "Read the reason. A missing tenant KRA PIN is added on the tenant's page under Edit.", "Choose Retry. Corrections to an accepted invoice are made with a credit note, never an edit."],
    to: "/tax", cta: "Open Tax & eTIMS", keywords: ["etims", "kra", "tax", "vat", "invoice", "failed", "pin", "credit note", "tims", "compliance"], permission: "accounting.view",
  },
  {
    id: "short-stay", title: "Add an Airbnb booking and match its payout", summary: "Short-stay units are let by the night; payouts arrive from the platform less its fee.",
    steps: ["Open Short-stay and choose Add booking, or Sync calendars to pull bookings from the platform's calendar link.", "When the platform pays out, choose Import payout report.", "In Payouts, choose Match to bank for each payout that has reached the account."],
    to: "/short-stay", cta: "Open Short-stay", keywords: ["airbnb", "booking", "guest", "short stay", "nightly", "payout", "holiday", "bnb", "booking.com"],
  },
  {
    id: "books-tie", title: "Check that the books tie out", summary: "Tenant accounts, deposits and refunds owed are each compared with the ledger.",
    steps: ["Open Books. The panel at the top says whether everything ties out.", "Expand it to see each check, the two figures compared, and any difference.", "A difference usually means a record was changed after the month closed."],
    to: "/accounting", cta: "Open Books", keywords: ["reconcile", "tie", "balance", "trial balance", "ledger", "audit", "check", "accountant", "books"], permission: "accounting.view",
  },
  {
    id: "lease", title: "Upload a signed lease", summary: "Keep the signed agreement with the tenant, next to their ID documents.",
    steps: ["Open the tenant's page and scroll to Documents.", "Choose the document type Signed lease and upload the PDF or a photo.", "The lease card shows the term, rent and renewal date."],
    to: "/tenants", cta: "Find the tenant", keywords: ["lease", "agreement", "contract", "upload", "document", "signed", "tenancy agreement"], permission: "tenants.manage",
  },
  {
    id: "add-tenant", title: "Register a new tenant", summary: "Add the person, the unit they take, the rent and the deposit paid.",
    steps: ["Open Tenants and choose Register tenant.", "Pick a vacant unit. Rent and the expected deposit fill in from the unit.", "Save, then upload their ID and signed lease for KYC."],
    to: "/tenants?new=1", cta: "Register a tenant", keywords: ["new tenant", "add", "register", "onboard", "move in", "let", "occupy"], permission: "tenants.manage",
  },
];

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Arrears", meaning: "Rent and charges that are past their due day and still unpaid." },
  { term: "Not yet due", meaning: "This month's rent before its due day (usually the 5th). Unpaid, but not late." },
  { term: "Collection rate", meaning: "Money received in the month divided by what was billed for it." },
  { term: "Deposit held", meaning: "Money a tenant paid as security. It belongs to them until it is settled at move-out, so it is never income." },
  { term: "Deposit settlement", meaning: "At move-out, the deposit is split into deductions (unpaid rent, damage, cleaning) and a refund. Together they always equal the deposit." },
  { term: "Credit (tenant credit)", meaning: "Money a tenant has paid ahead or is owed back. It reduces what they owe next." },
  { term: "Void", meaning: "Reversing a payment entered by mistake. The original stays on record with a reversal next to it." },
  { term: "Reconciliation", meaning: "Matching money that reached the bank to the tenant it came from." },
  { term: "Trial balance", meaning: "Every account with its total debits and credits. If the two columns match, the books balance." },
  { term: "eTIMS", meaning: "KRA's electronic invoicing system. VAT invoices are sent to it and come back with a KRA number and QR code." },
  { term: "MRI", meaning: "Monthly Rental Income tax: 7.5% of gross residential rent for landlords in the eligible income band." },
  { term: "Occupancy", meaning: "Units let divided by units available to let." },
];

// Words people use for the same thing, folded together before matching.
const SYNONYMS: Record<string, string> = {
  undo: "reverse", cancel: "reverse", delete: "reverse", remove: "reverse", void: "reverse", mistake: "reverse",
  owe: "arrears", owing: "arrears", debt: "arrears", overdue: "arrears", late: "arrears", unpaid: "arrears", defaulter: "arrears",
  leave: "move out", leaving: "move out", vacate: "move out", exit: "move out",
  kra: "etims", vat: "etims", tax: "etims", invoice: "etims",
  airbnb: "short stay", bnb: "short stay", guest: "short stay", nightly: "short stay",
  contract: "lease", agreement: "lease",
  export: "report", download: "report", board: "report", directors: "report",
  mpesa: "pay", receive: "pay", received: "pay", log: "pay",
};

const norm = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9 .-]/g, " ").split(/\s+/).filter((w) => w.length > 1)
    .map((w) => SYNONYMS[w] ?? w.replace(/(ing|ed|s)$/, ""));

/** Ranks articles for a question; returns the best few with a score above zero. */
export function searchHelp(query: string, can: (p: Permission) => boolean, limit = 5) {
  const q = norm(query);
  if (!q.length) return [];
  return ARTICLES
    .filter((a) => !a.permission || can(a.permission))
    .map((a) => {
      const title = norm(a.title).join(" ");
      const keys = a.keywords.flatMap(norm).join(" ");
      const body = norm(`${a.summary} ${a.steps.join(" ")}`).join(" ");
      let score = 0;
      for (const w of q) {
        if (title.includes(w)) score += 5;
        if (keys.includes(w)) score += 3;
        if (body.includes(w)) score += 1;
      }
      return { article: a, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.article);
}
