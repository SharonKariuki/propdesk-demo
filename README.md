# PropDesk demo — property management dashboard

A standalone replica of a production property-management dashboard: the
same screens, layouts, navigation, components, styling and workflows. It runs
entirely in the browser on **synthetic data**. Nothing in this repository
comes from a real client. Every person, property, phone number, ID, payment
and figure is generated (see [`src/data/local/seed.ts`](src/data/local/seed.ts)).

It covers buildings and units, tenants (KYC, notice, move-out and move-in
again), payments and receipts, bank reconciliation, water readings, charges,
tenant credits and refunds, expenses, manual income, a double-entry accounting
suite, 17 reports, notifications, an activity log and settings.

> **Nothing leaves the browser.** No SMS, email, M-Pesa, bank or other
> external request is ever made by the demo backend. Messages are written to
> a simulated outbox, and "incoming payments" are simulated. The only network
> requests are the Google Fonts stylesheet and the Unsplash stock photos used
> as building placeholders, as in the original UI.

---

## Quick start

Requirements: Node.js 20 or newer (tested on 22) and npm.

```bash
npm ci
npm run dev          # http://localhost:5180
```

There is no database to install and no `.env` to create. On first load the
app generates the demo portfolio and stores it in the browser (IndexedDB).

| Demo account | Password | Role |
|---|---|---|
| `owner@mawingu.test` | `demo1234` | Owner / Admin: everything |
| `accountant@mawingu.test` | `demo1234` | Accountant: runs the money, cannot reverse it |
| `caretaker@mawingu.test` | `demo1234` | Caretaker: meters, repairs, tenant contacts; no money |

See *Roles and permissions* below.

Click an account on the login page to fill the form.

**Reset:** Settings → *Demo data* → *Reset demo data* (owner only) restores the
original portfolio. Clearing the site's data in the browser does the same.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 5180 (`--strictPort`) |
| `npm run build` | Type-check + production build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc -b` only |
| `npm run lint` | ESLint (0 errors; 23 warnings, all in code inherited from the original) |
| `npm test` | Vitest: the original component and library tests plus the local-backend suite (`src/data/local/__tests__`) |
| `npm run test:e2e` | Playwright. It builds the app twice (see below) and runs the original mocked specs and the local-provider CRUD and responsive specs. Run `npx playwright install chromium` once first |

## Configuration

All configuration lives in [`src/data/config.ts`](src/data/config.ts) and is
read from Vite env variables. See [`.env.example`](.env.example).

| Variable | Default | Meaning |
|---|---|---|
| `VITE_DATA_PROVIDER` | `local` | `local` uses the in-browser demo backend. `http` uses a real API |
| `VITE_API_BASE_URL` | none | Real API root (only with `http`). Required for an `http` production build |
| `VITE_LOCAL_LATENCY_MS` | `250` | Simulated latency, so loading states are visible |
| `VITE_LOCAL_FAILURE_RATE` | `0` | Fraction of GETs that fail with a 503, to exercise error states |

---

## Architecture

The UI was kept as close to the original as possible. Pages and hooks are
unchanged and still call one shared axios client
([`src/lib/api.ts`](src/lib/api.ts)) with the original REST contract. The
data provider is chosen *under* that client:

```
pages / components / hooks  (unchanged UI)
        │  React Query → api.get("/tenants/") …
        ▼
src/lib/api.ts  ── axios client: auth header, 401 → refresh → retry
        │
        ├─ VITE_DATA_PROVIDER=http  → network → your backend (VITE_API_BASE_URL)
        │
        └─ VITE_DATA_PROVIDER=local → axios adapter (src/data/local/adapter.ts)
                 │
                 ▼
           server.ts      router: METHOD + path → handler, auth gate, one request at a time,
                          write-through after each request, rollback on error
                 │
           handlers/      auth · buildings · tenants · payments · charges · credits ·
                          notifications/dashboard · reports/accounting
                 │
           services/      billing (rent run + rent roll) · ledger (double entry) ·
                          serializers (row → API JSON) · payments · notify (outbox) ·
                          documents (CSV / XLSX / PDF) · statements · audit · files
                 │
           db.ts          Repository<T> per table (all / get / find / insert / update / remove)
                 │
           storage.ts     StorageDriver: IndexedDbDriver (browser) | MemoryDriver (tests)
```

Why put the boundary at HTTP? The UI is already written against the real
backend's REST contract, its error shapes and its auth flow. Answering that
same contract locally means:

- No UI code knows which provider it is talking to.
- Switching to a real backend is a configuration change.
- Validation errors come back in Django REST Framework's `{ field: ["message"] }`
  form, so the existing error handling (`lib/apiError.ts`) shows them unchanged.

The local backend is loaded lazily. An `http` build does not include it at all.

### Persistence and consistency

- Every table is held in memory and written to IndexedDB after each request
  that changes something, so changes survive page refreshes.
- If a handler fails, its partial changes are rolled back.
- Requests are processed one at a time, like a single-worker server.
- Other tabs of the same browser pick up changes through a `BroadcastChannel`.
- Balances, unit statuses, dashboard KPIs, reports and the general ledger are
  never stored. They are derived on request from the same rows:
  - Rent run: [`services/billing.ts`](src/data/local/services/billing.ts), a port of the backend's monthly rent roll.
  - Journal entries: [`services/ledger.ts`](src/data/local/services/ledger.ts), a port of its posting rules.
- Because of that, a payment, void, credit or expense is reflected
  everywhere at once. The app's existing React Query invalidation refetches
  the affected screens. The test suite checks that the trial balance and
  balance sheet always balance.

### What is reused from the original

- All UI code: pages, components, hooks, routes, styles and the Tailwind theme.
- The shared types (`src/lib/types.ts`), the zod form validation, `taxService`,
  `receiptService`, date and money helpers, and the original unit and e2e tests.
- Business rules ported from the backend:
  - Rent roll roll-forward and VAT (16% on commercial rent).
  - Deposits (1 month residential, 3 months commercial) and deposit edits booked as payments.
  - Water meter readings chained per unit.
  - Combined commercial spaces.
  - Quarterly billing.
  - Void and requeue to Reconciliation.
  - Credit notes and refunds.
  - The chart of accounts and its locked expense categories.
  - Accrual posting rules.

### Deviations from the original UI

The workflows, pages, routes and data contract are the original's. The visual
design is not: the app has been restyled to a new design system (below).
Beyond that, changes are kept to the minimum:

- **Branding.** All client branding, names, places and unit codes were replaced with the
  fictional *Mawingu Properties*. This covers copy, placeholders, comments and test fixtures.
- **Login page.** A demo-accounts panel, shown in local mode only.
- **Settings.** A *Roles & permissions* card (matrix plus team role management) and a *Demo data* reset card (owner, local mode only).
- **RBAC.** Navigation, routes and buttons follow the role permission matrix; a *No access* screen replaces pages a role cannot use.
- **Password reset.** The page shows the reset link, because no email is sent (local mode only).
- **Avatars.** Initials avatars are drawn locally instead of by a third-party service.
- **Sentry.** Removed.
- **Two layout fixes** for latent overflow bugs that only appear with realistic
  data, caught by the 360px e2e sweep:
  - The dashboard "This morning / Recent payments" grid items gained `min-w-0`.
  - The mobile payment card's action row can wrap.

---

## Design system

The look is *quiet financial software*: the numbers are the loudest thing on the screen.

- **Background:** one flat, cool stone colour (`#f3f4f1`). No gradient wash.
- **Surfaces:** white cards and solid white controls with thin borders. No glass or blur.
- **One coloured surface:** the ledger-green hero card (`#123b32`) for the month's collections.
- **Gold** (`#e0a03a`) only marks "now": today in calendars, the current month's bar, the tour highlight.
- **Status** is shown only as pale pills with dark text.
- **Labels** are plain sentence case. There are no all-caps mono eyebrows.
- **Dates** read as `3 Nov 2026` in new screens; typed dates stay `dd/mm/yyyy`.
- **Type:** Inter at 400/500/600, with tabular figures in every money column.

Where it lives:

| Layer | File |
|---|---|
| Tokens (colour, wash, glass, radius, elevation, dark mode) | [`src/index.css`](src/index.css) |
| Type scale, weights, mono, colour names | [`tailwind.config.js`](tailwind.config.js) |
| Primitives (Card, Button, Badge, Table, Input, PageHeader, Stat, Modal) | `src/components/ui/` |
| Screen kit (hero card, quick actions, KPI tile, list row, notice banner, filter chips, segmented control, split and property bars, actual-vs-expected chart) | [`src/components/ds.tsx`](src/components/ds.tsx) |
| Shell: glass sidebar; floating glass tab bar with a centre **+** (phones) | `src/components/Sidebar.tsx`, `MobileNav.tsx` |

**How existing screens were restyled.** The older pages were restyled through the
tokens rather than rewritten. The legacy colour names they use (`navy`, `teal`,
`sage`, `coral`, `ochre`, `ink`) are remapped:

- Interaction and figures → ink
- `coral` → the red status colour
- `ochre` → the amber status colour

In the same spirit, every uppercase tracked label renders as a mono eyebrow.

**Recomposed screens.** Three screens were rebuilt to match the reference design:

- **Home** (`/dashboard`): greeting, the black *Collected* hero card, four quick
  actions, Outstanding and Occupancy, recent payments with *Matched* or *Partial*
  pills, collected-vs-expected bars (6M/12M) and *By property* bars.
- **Payments:** *Received today* with an M-Pesa/bank split, a reminders notice,
  and payments grouped by day on phones.
- **Income:** the new first tab of Reports (`/reports`). It shows 6M/12M,
  collected with growth, collection rate, outstanding and *By property*, served
  by `GET /reports/income-overview/`.

Quick actions and tabs follow the role: a caretaker's tab bar shows Buildings
and Water instead of Payments and Reports, and a caretaker's hero card shows
occupancy instead of money.

---

## Roles and permissions (RBAC)

One matrix, [`src/lib/permissions.ts`](src/lib/permissions.ts), decides who may do what. It is enforced in two places:

- **API (the real protection).** Every route is mapped to the permission it needs in
  [`src/data/local/handlers/access.ts`](src/data/local/handlers/access.ts).
  - A request from a role without that permission gets **403**, and the refusal is
    written to the Activity log as *Refused*.
  - A route missing from the table is refused for everyone. A test fails if any route has no rule.
- **UI.** The same matrix hides navigation items, guards routes with a *No access* screen,
  and hides buttons the role cannot use (`useCan()` / `<RequirePermission>`).

| Area | Owner / Admin | Accountant | Caretaker |
|---|---|---|---|
| Properties: view | ✓ | ✓ | ✓ |
| Properties and units: add, edit, delete, change rent | ✓ | | |
| Log maintenance | ✓ | ✓ | ✓ |
| Tenants: view | ✓ | ✓ | ✓ |
| Tenants: register, edit, notice, move out | ✓ | ✓ | |
| KYC: upload documents | ✓ | ✓ | ✓ |
| KYC: verify or reject | ✓ | ✓ | |
| Statements: PDF, email, CSV export | ✓ | ✓ | |
| Payments: view and record; reconciliation | ✓ | ✓ | |
| Void payments; credits and refunds; add charges | ✓ | | |
| Water readings | ✓ | ✓ | ✓ |
| Expenses and manual income | ✓ | ✓ | |
| Accounting and reports | ✓ | ✓ | |
| Notifications (send SMS and email) | ✓ | ✓ | |
| Activity log; change team roles; reset demo | ✓ | | |

The owner changes roles under **Settings → Roles & permissions**. The card shows
the full matrix to everyone. You cannot change your own role, and the last owner
cannot be demoted.

To change what a role can do, edit `ROLE_PERMISSIONS` in `src/lib/permissions.ts`.
The API and the UI both follow it.

A real backend can send a `permissions` array on the user object; the UI uses that
list in preference to the role defaults. The backend must enforce the same rules
itself: the UI only hides what the server would refuse.

## What works

Create, view, edit and delete persist across reloads and update the dashboard
and related records. The edit and delete operations match the original app:
records with money history are voided, moved out or archived rather than
hard-deleted, exactly as there.

| Area | Operations |
|---|---|
| Buildings | Create (3-step wizard with units and photo), view, edit, change or remove photo, delete (refused once a property has tenancy, expense or income history) |
| Units | Bulk create, list and filter, adjust rent and statement wording, combine or split commercial spaces, log maintenance (books an expense) |
| Tenants | Register (books the deposit), view, edit (deposit edits post deposit payments), notice, move out with an itemised deposit settlement (refund as amount or %), record the refund as sent, settlement statement PDF, move in again, KYC upload, verify and reject, signed lease upload and lease card, statement PDF with a deposit section, simulated statement emails, CSV export |
| Payments | Record, void (single or whole reference; bank credits can return to Reconciliation), receipts (on screen and PDF), simulated re-send, simulated incoming payment |
| Reconciliation | Assign unmatched bank credits to tenants |
| Water and charges | Meter readings with previous-reading chaining and meter replacement; Add Charge (late fee, parking, damage recharge) |
| Credits and refunds | Credit notes and account credits, hold and release, void with preview, refunds scheduled or sent, mark sent, cancel and void |
| Expenses and income | Create, list, filter and delete; manual income by account |
| Accounting | Balance sheet, P&L, trial balance (balances and movements), general ledger (by account and journal), chart of accounts, petty cash, budget vs actual. Each downloads as CSV, XLSX or PDF |
| Reports | Monthly management report (headline figures against last month, 12-month trend, arrears by age, property table, largest overdue balances, written summary) as PDF, Excel or print; 16 further reports grouped into four areas, with filters and CSV, XLSX and PDF export. P&L and the trial balance live in Books |
| Deposits | Register of deposits held, refunds owed and every settlement, checked against the books |
| Books checks | Tenant accounts, the deposit register and refunds owed each reconciled to their ledger account; debits equal credits |
| Short-stay | Three nightly-let units: booking calendar, add or cancel bookings, simulated calendar sync, simulated payout import, payout matching, occupancy, average nightly rate, platform fees, 2% tourism levy |
| Tax & eTIMS | VAT rent invoices and credit notes with simulated KRA invoice numbers and QR, failures with reasons and retry, VAT and Monthly Rental Income estimates |
| Help | Help drawer with task articles, a glossary and meaning-aware search (also in the top search box); one-minute tour per role |
| Notifications | Templates, send to one, all or in-arrears tenants (simulated), history, SMS wallet |
| Activity, Settings | Audit trail with filters; profile edit, password change, login history, view preferences, demo reset |

Loading (skeletons), empty, success (toasts), validation (field errors from
the API) and error states (retry) are the original components. Set
`VITE_LOCAL_FAILURE_RATE=0.3` to see the error states.

## What is mocked

| Real system | Local behaviour |
|---|---|
| JWT auth (Django SimpleJWT) | Opaque local tokens naming the user; demo users with SHA-256 password hashes; refresh rotation kept; role permissions enforced per route |
| SMS (Africa's Talking) and email | Written to the notifications table as "sent (simulated)"; a demo SMS wallet is debited per segment; no provider is called |
| M-Pesa and bank feed (IPN) | Seeded bank credits in the Reconciliation queue; `POST /payments/mock/` simulates a notification |
| Password-reset email | The reset link is shown on screen (and logged to the console) instead of emailed |
| Server-side PDF and Excel generation | Generated in the browser (small PDF and XLSX writers in `services/documents.ts`) |
| File storage (KYC documents, photos, evidence) | Blobs in IndexedDB; seeded documents are clearly marked sample images |
| Cron jobs (monthly rent run) | Run when the app is used: any month not yet billed is raised on the next request |
| Sentry | Removed |
| Avatar service | Initials avatars drawn locally (the original sent names to a third-party service) |
| Property photos (Unsplash) | Building pictures drawn locally as SVG, so the demo works offline |
| KRA eTIMS | Simulated: invoice numbers, control unit and QR links are generated in the browser; nothing is sent to KRA |
| Airbnb and other platforms | Simulated: calendar sync and payout reports are generated; commission rates are assumptions |

---

## Replacing the local provider with a real backend

1. **Provide the API.** The backend must serve the same REST contract the
   original Django API serves. The authoritative list of endpoints, payloads
   and response shapes is the local implementation:
   - Routes: `src/data/local/handlers/*.ts` (105 of them).
   - Response JSON: `src/data/local/services/serializers.ts`.
   - Types: `src/lib/types.ts` and the interfaces in `src/hooks/*`.

   Requirements to match:
   - Auth: `POST /auth/login/` returns `{ access, refresh, user }`.
     `POST /auth/refresh/` returns `{ access, refresh? }`, and rotated refresh
     tokens must replace the old one. Protected endpoints take
     `Authorization: Bearer <access>` and answer 401 when it has expired.
   - Errors: DRF style, either `{ detail: "…" }` or `{ field: ["…"] }`.
   - Downloads: return the file with a `Content-Disposition: attachment; filename="…"` header.
2. **Allow the origin.** Enable CORS on the backend for the app's origin.
   Credentials are not needed; the token travels in a header.
3. **Configure the build:**
   ```bash
   VITE_DATA_PROVIDER=http VITE_API_BASE_URL=https://api.example.com/api npm run build
   ```
   With `http` set, the demo backend is left out of the bundle entirely, and
   the demo-only touches below are hidden automatically.
4. **Optional clean-up.** Once you no longer need the demo, you can delete
   `src/data/local/`. Then remove:
   - The lazy `import("@/data/local/adapter")` branch in `src/lib/api.ts`.
   - Three small demo-only additions, each guarded by `isLocalProvider`:
     - `DemoAccounts` in `pages/LoginPage.tsx`.
     - `DemoDataCard` in `pages/SettingsPage.tsx`.
     - The `demo_reset_link` display in `pages/PasswordResetPage.tsx`.

No page, hook or component needs to change.

Partial swap: because the switch is an axios adapter, you can also route some
paths to the network and the rest locally while a backend is being built. Do
this by wrapping `localAdapter` and the default adapter in one function in
`api.ts`.

## Testing

- **Unit and integration** (`npm test`, 232 tests):
  - The original suites.
  - `src/data/local/__tests__/server.test.ts`. It checks:
    - Every read endpoint answers 200, and auth, roles and 404s behave.
    - The seed is populated and consistent.
    - The books balance, and the dashboard and arrears report agree.
    - CRUD round trips with validation errors.
    - Payment → balance → dashboard → void.
    - Water-reading chaining, credits and refunds, expense → P&L, the simulated outbox.
    - Reconciliation assign and requeue, move-out and move-in again, file exports.
    - Persistence across a restart, and reset.
- **End-to-end** (`npm run test:e2e`). It builds the app twice:
  - On port 4173 with `VITE_DATA_PROVIDER=http`: the original specs, which
    intercept `/api/**` in the test.
  - On port 4176 with `VITE_DATA_PROVIDER=local`:
    - `crud.local.spec.ts` creates a building, units, a tenant, a payment and
      an expense through the UI. It checks the dashboard moves, reloads to prove
      persistence, then deletes.
    - `responsive.local.spec.ts` checks every route at 360, 768 and 1366px on
      the seeded data.

## Known limitations

- **Single browser.** Data lives in this browser's IndexedDB. It is not shared
  between devices or users, and a private window starts fresh. (If IndexedDB is
  unavailable, the app falls back to memory and data lasts until the tab
  closes.)
- **Reports and accounting are faithful in layout and internally consistent,
  but simplified compared with the Python originals.**
  - The general ledger is derived rather than stored, so there is no separate
    "rebuild ledger" step.
  - Credits apply to the open balance as a whole rather than charge by charge.
  - Budget vs Actual uses the rent-roll basis, because there is no budget editor.
  - Late fees, parking and water are posted per charge as in the original;
    payments are not FIFO-allocated across periods for the ledger.
- **Security is demo-grade by design.** Tokens are not signed and passwords
  are SHA-256 in browser storage. Roles are enforced by the local API for
  realism, not for protection.
- **Time-relative seed.** The seed runs nine months back from the day it is
  first generated, and the monthly rent run catches up as months pass. Reset to
  regenerate around today.
- **Original warnings kept.** Console warnings inherited from the original
  (React Router v7 future flags, Recharts sizing on first paint) and its
  bundle-size advisory are unchanged.

## Project layout

```
src/
  data/
    config.ts           provider switch (VITE_DATA_PROVIDER …)
    local/              the in-browser backend (see Architecture)
  pages/ components/ features/ hooks/ lib/   the dashboard UI (from the original)
e2e/                    Playwright specs (original mocked + *.local.spec.ts)
```

## Deposit accounting

A deposit is a liability until the tenant leaves. At move-out the whole deposit leaves
"Tenant Security Deposits Held" (2100) in one settlement entry:

| Part of the deposit | Goes to | Effect |
|---|---|---|
| Unpaid rent deducted | 1040 Accounts Receivable | Shown as a credit on the tenant's account and statement |
| Damage, cleaning, utilities, other | 4260 Deposit Deductions Kept | Income |
| Refund | 2150 Deposit Refunds Payable | Owed to the tenant until recorded as sent, then paid from 1030 |

Deductions plus the refund must equal the deposit; the API refuses anything else, and a
settled deposit cannot be edited. `GET /accounting/checks/` proves the registers tie to the
ledger. Older browser data is regenerated automatically (schema version 2).
