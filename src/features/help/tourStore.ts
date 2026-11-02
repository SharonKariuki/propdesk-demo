/** Tour steps per role and the tour's state, shared by Help, the dashboard and the overlay. */
export interface Step { to: string; title: string; body: string }

const COMMON: Step[] = [
  { to: "/dashboard", title: "Home", body: "Your month at a glance: what came in, what is overdue, and what needs attention today." },
];
const BY_ROLE: Record<string, Step[]> = {
  owner: [
    ...COMMON,
    { to: "/tenants", title: "Tenants", body: "Each tenant's page has their balance, deposit, documents and every payment. Record payments and move-outs from there." },
    { to: "/deposits", title: "Deposits", body: "Money held for tenants, refunds still owed, and how every past deposit was settled." },
    { to: "/accounting", title: "Books", body: "The ledger, trial balance and statements, with a check at the top that the books tie out." },
    { to: "/reports", title: "Reports", body: "Start with the monthly report: one page for directors, as PDF or Excel." },
  ],
  accountant: [
    ...COMMON,
    { to: "/payments", title: "Payments", body: "M-Pesa and bank payments are matched to tenants automatically. Record cash here." },
    { to: "/reconciliation", title: "Reconciliation", body: "Money that arrived without a clear account number waits here for you to assign." },
    { to: "/tax", title: "Tax & eTIMS", body: "Invoices sent to KRA, the few that need fixing, and this month's VAT and rental income tax." },
    { to: "/accounting", title: "Books", body: "Check the books tie out before closing the month." },
  ],
  caretaker: [
    ...COMMON,
    { to: "/water", title: "Water readings", body: "Enter meter readings each month; the bills are worked out for you." },
    { to: "/tenants", title: "Tenants", body: "Phone numbers and units for every tenant." },
  ],
};

export type TourState = { steps: Step[]; index: number } | null;
let state: TourState = null;
const listeners = new Set<() => void>();
export const setTour = (s: TourState) => { state = s; listeners.forEach((l) => l()); };
export const subscribeTour = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const tourState = () => state;

export function startTour(role: string) {
  setTour({ steps: BY_ROLE[role] ?? BY_ROLE.owner, index: 0 });
}

