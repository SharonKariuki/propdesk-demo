/**
 * Synthetic demo dataset — every name, phone number, ID and figure here is
 * invented. It is generated with a fixed-seed random generator, relative to
 * today's date, so the books always run up to the current month and the same
 * browser always gets the same data.
 *
 * The seed is built through the real services (billing, payments) rather than
 * written as raw rows, so balances, receipts and the ledger are consistent
 * from the first page load.
 */
import { database, repos } from "./context";
import type { LocalDatabase } from "./db";
import {
  SCHEMA_VERSION, TABLE_NAMES, type AccountRow, type BuildingRow, type PaymentSource, type Tables,
  type TenantRow, type UnitRow,
} from "./schema";
import { currentBalance, ensureBilling, vatOn } from "./services/billing";
import { saveFile } from "./services/files";
import { recordPayment } from "./services/payments";
import {
  currentKey, daysInMonth, fromMonthKey, isoDate, keyOfIso, monthKey, monthLabel, round2, sha256,
  todayIso,
} from "./util";

// ─── deterministic randomness ────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(20261019);
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T,>(items: readonly T[]) => items[Math.floor(rand() * items.length)];
const chance = (p: number) => rand() < p;
const roundTo = (n: number, step: number) => Math.round(n / step) * step;

// ─── synthetic people ────────────────────────────────────────────────────────
const FIRST = [
  "Achieng", "Wanjiru", "Kamau", "Otieno", "Njeri", "Akinyi", "Kiprono", "Chebet", "Mutua", "Wairimu",
  "Omondi", "Nyambura", "Kibet", "Atieno", "Muthoni", "Odhiambo", "Wambui", "Kipchumba", "Auma", "Moraa",
  "Nyokabi", "Juma", "Halima", "Amina", "Hassan", "Brian", "Faith", "Kevin", "Dennis", "Esther", "Joy",
  "Caroline", "Collins", "Purity", "Victor", "Lilian", "Ian", "Diana", "Felix", "Gladys", "Eric", "Winnie",
  "Samuel", "Ruth", "Daniel", "Naomi", "Joseph", "Lucy", "Moses", "Cynthia", "George", "Beatrice",
  "Stephen", "Maureen", "Tabitha", "Wycliffe", "Rehema", "Zawadi", "Baraka", "Imani",
] as const;
const LAST = [
  "Otieno", "Kamau", "Wanjiku", "Mwangi", "Ochieng", "Kiplagat", "Mutiso", "Nduta", "Onyango", "Chege",
  "Wekesa", "Barasa", "Kipkemboi", "Muriuki", "Owino", "Gitau", "Nyaga", "Korir", "Simiyu", "Mbugua",
  "Okoth", "Kilonzo", "Wafula", "Rotich", "Musyoka", "Oduya", "Githinji", "Maina", "Achola", "Langat",
  "Nzioka", "Omollo", "Kirui", "Wanyama", "Kahindi", "Mumbua",
] as const;
const BUSINESSES: [string, string][] = [
  ["Tumaini", "Clinic Ltd"], ["Baraka", "Hardware"], ["Sunrise", "Pharmacy"], ["Mzizi", "Cafe"],
  ["Kijiji", "Electronics"], ["Neema", "Salon & Spa"], ["Upendo", "Agrovet"], ["Bidii", "Stationers"],
  ["Furaha", "Boutique"], ["Jenga", "Tech Hub"],
];

let personCounter = 0;
function person() {
  personCounter += 1;
  const first = pick(FIRST);
  let last = pick(LAST);
  if (last === first) last = pick(LAST);
  return {
    first_name: first,
    last_name: last,
    phone: `+2547000${String(10000 + personCounter * 7).slice(-5)}`,
    email: chance(0.82) ? `${first}.${last}${personCounter}`.toLowerCase() + "@example.com" : "",
    id_number: String(20000000 + Math.floor(rand() * 19999999)),
    kra_pin: chance(0.75) ? `A${String(between(100000000, 999999999))}${String.fromCharCode(65 + between(0, 25))}` : "",
  };
}

// ─── chart of accounts (standard Kenyan property COA) ────────────────────────
const HEADERS: [string, string, AccountRow["account_type"]][] = [
  ["1000", "Assets", "asset"], ["2000", "Liabilities", "liability"], ["3000", "Equity", "equity"],
  ["4000", "Income / Revenue", "income"], ["5000", "Operating Expenses", "expense"],
  ["6000", "Fixed and Non-Operating Costs", "expense"],
];
const ACCOUNTS: [string, string, AccountRow["account_type"], string][] = [
  ["1010", "Petty Cash", "asset", "1000"],
  ["1020", "Operating Bank Account", "asset", "1000"],
  ["1030", "Tenant Security Deposit Bank Account", "asset", "1000"],
  ["1040", "Accounts Receivable (Rent Arrears)", "asset", "1000"],
  ["1050", "Prepaid Expenses", "asset", "1000"],
  ["1060", "Investment Property / Land", "asset", "1000"],
  ["1350", "Buildings & Improvements", "asset", "1000"],
  ["1360", "Accumulated Depreciation", "asset", "1000"],
  ["1370", "Furniture & Office Equipment", "asset", "1000"],
  ["2010", "Accounts Payable (Suppliers/Contractors)", "liability", "2000"],
  ["2020", "Accrued Expenses", "liability", "2000"],
  ["2100", "Tenant Security Deposits Held", "liability", "2000"],
  ["2500", "Mortgages Payable / Bank Loans", "liability", "2000"],
  ["2600", "VAT Payable", "liability", "2000"],
  ["2700", "PAYE Payable", "liability", "2000"],
  ["2800", "NSSF/NHIF Payables", "liability", "2000"],
  ["3100", "Owner's Capital / Share Capital", "equity", "3000"],
  ["3200", "Owner's Drawings / Dividends", "equity", "3000"],
  ["3300", "Retained Earnings", "equity", "3000"],
  ["4110", "Residential Rental Income", "income", "4000"],
  ["4120", "Commercial Rental Income", "income", "4000"],
  ["4150", "Service Charge / Utilities Reimbursed by Tenants", "income", "4000"],
  ["4200", "Late Payment Fees / Penalties", "income", "4000"],
  ["4250", "Parking Fees", "income", "4000"],
  ["4300", "Farm / Agricultural Income", "income", "4000"],
  ["5100", "Property Management Fees", "expense", "5000"],
  ["5200", "Repairs & Maintenance", "expense", "5000"],
  ["5210", "Plumbing & Electrical", "expense", "5000"],
  ["5220", "Cleaning & Garbage Collection", "expense", "5000"],
  ["5230", "Gardening & Landscaping", "expense", "5000"],
  ["5300", "Utilities (Common Areas)", "expense", "5000"],
  ["5400", "Marketing & Advertising", "expense", "5000"],
  ["5500", "Legal & Professional Fees", "expense", "5000"],
  ["5600", "Security Services", "expense", "5000"],
  ["5700", "Property Management Software", "expense", "5000"],
  ["5800", "Caretaking Services", "expense", "5000"],
  ["5900", "Travel and Vehicle Expenses", "expense", "5000"],
  ["5910", "Salaries and Wages", "expense", "5000"],
  ["5920", "Office Expenses", "expense", "5000"],
  ["5930", "Commissions", "expense", "5000"],
  ["5940", "Bank Fees", "expense", "5000"],
  ["5950", "Farm Inputs / Operating Costs", "expense", "5000"],
  ["6100", "Insurance", "expense", "6000"],
  ["6200", "Property Taxes - Land Rates", "expense", "6000"],
  ["6300", "Property Taxes - Land Rent", "expense", "6000"],
  ["6400", "Interest Expense (Mortgages)", "expense", "6000"],
  ["6500", "Corporate Tax", "expense", "6000"],
  ["6600", "Depreciation Expense", "expense", "6000"],
];
/** Every expense account is offered as a locked category. */
const CATEGORY_CODES = ACCOUNTS.filter(([, , type]) => type === "expense").map(([code]) => code);

// ─── portfolio ───────────────────────────────────────────────────────────────
interface BuildingPlan {
  name: string;
  code: string;
  address: string;
  property_type: BuildingRow["property_type"];
  floors: number;
  water_rate: number;
  units: { label: string; floor: number; type: UnitRow["unit_type"]; rent: number; business?: boolean }[];
}

function residentialUnits(code: string, floors: number, perFloor: number, types: UnitRow["unit_type"][], rentRange: [number, number]) {
  const out: BuildingPlan["units"] = [];
  for (let f = 1; f <= floors; f++) {
    for (let i = 0; i < perFloor; i++) {
      const type = types[(f + i) % types.length];
      const bump = type === "2br" || type === "double" ? 1.25 : 1;
      out.push({ label: `${code}${f}${String.fromCharCode(65 + i)}`, floor: f, type, rent: roundTo(between(...rentRange) * bump, 500) });
    }
  }
  return out;
}

function plan(): BuildingPlan[] {
  return [
    {
      name: "Mawingu Court - Kilimani", code: "KC", address: "Plot 14, Kirichwa Road, Kilimani, Nairobi",
      property_type: "rental", floors: 4, water_rate: 150,
      units: residentialUnits("KC", 4, 4, ["1br", "2br", "1br", "2br"], [19000, 24000]),
    },
    {
      name: "Baraka Plaza - Ruaka", code: "BP", address: "Limuru Road, Ruaka Town",
      property_type: "rental", floors: 2, water_rate: 180,
      units: Array.from({ length: 10 }, (_, i) => ({
        label: `BP${String(i + 1).padStart(2, "0")}`, floor: i < 5 ? 0 : 1, type: "shop" as const,
        rent: roundTo(between(26000, 58000), 1000), business: true,
      })),
    },
    {
      name: "Mawingu Gardens - Syokimau", code: "SG", address: "Off Mombasa Road, Syokimau, Machakos",
      property_type: "rental", floors: 3, water_rate: 120,
      units: residentialUnits("SG", 3, 6, ["bedsitter", "1br", "bedsitter", "1br", "bedsitter", "2br"], [9000, 13500]),
    },
    {
      name: "Riverbend Flats - Kasarani", code: "RF", address: "Mwiki Road, Kasarani, Nairobi",
      property_type: "rental", floors: 3, water_rate: 130,
      units: residentialUnits("RF", 3, 5, ["single", "double", "single", "bedsitter", "double"], [6500, 9500]),
    },
    { name: "Mawingu Farm - Kajiado", code: "MF", address: "Isinya Road, Kajiado County", property_type: "farm", floors: 0, water_rate: 0, units: [] },
    { name: "Head Office - Westlands", code: "HO", address: "3rd Floor, Parklands Road, Westlands", property_type: "expense_only", floors: 1, water_rate: 0, units: [] },
  ];
}

type Profile = "prompt" | "late" | "partial" | "chronic" | "advance";
const PROFILES: [Profile, number][] = [["prompt", 0.62], ["late", 0.14], ["partial", 0.1], ["chronic", 0.08], ["advance", 0.06]];
function profile(): Profile {
  let x = rand();
  for (const [p, w] of PROFILES) {
    if ((x -= w) <= 0) return p;
  }
  return "prompt";
}

function sourceFor(): PaymentSource {
  const x = rand();
  return x < 0.6 ? "mpesa" : x < 0.9 ? "bank" : x < 0.97 ? "cash" : "cheque";
}

const LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789";
const code = (n: number) => Array.from({ length: n }, () => LETTERS[between(0, LETTERS.length - 1)]).join("");
function referenceFor(source: PaymentSource, date: string) {
  if (source === "mpesa") return `S${String.fromCharCode(65 + Number(date.slice(5, 7)))}${code(8)}`;
  if (source === "bank") return `FT${date.replace(/-/g, "").slice(2)}${between(10000, 99999)}`;
  if (source === "cheque") return `CHQ${between(100000, 999999)}`;
  return `RCT-${between(1000, 9999)}`;
}

/** A synthetic "document" image, clearly marked as a sample. */
function sampleDocument(label: string, name: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" rx="18" fill="#eef2f7"/><rect x="20" y="20" width="600" height="360" rx="12" fill="#fff" stroke="#94a3b8"/><text x="40" y="80" font-family="sans-serif" font-size="28" fill="#0f2a43">${label}</text><text x="40" y="140" font-family="sans-serif" font-size="22" fill="#334155">${name}</text><text x="40" y="340" font-family="sans-serif" font-size="20" fill="#dc2626">SAMPLE — synthetic demo document</text></svg>`;
  return new Blob([svg], { type: "image/svg+xml" });
}

// ─── generation ──────────────────────────────────────────────────────────────
export async function generateSeed(target: LocalDatabase) {
  rand = mulberry32(20261019);
  personCounter = 0;
  target.tables = Object.fromEntries(TABLE_NAMES.map((n) => [n, []])) as unknown as Tables;
  const today = todayIso();
  const nowKey = currentKey();
  const startKey = nowKey - 8;
  const start = fromMonthKey(startKey);
  target.meta = {
    schema_version: SCHEMA_VERSION,
    seeded_at: new Date().toISOString(),
    books_start: isoDate(start.year, start.month, 1),
    sms_wallet: 1250,
    opening: { bank: 1_850_000, land: 24_000_000, buildings: 96_000_000, petty_cash_float: 20_000 },
    counters: {},
  };
  const r = repos();
  if (database() !== target) throw new Error("Seed target must be the active database");

  // Users.
  const users = [
    { email: "owner@mawingu.test", username: "owner", first_name: "Amani", last_name: "Njoroge", role: "owner" as const },
    { email: "accountant@mawingu.test", username: "accountant", first_name: "Grace", last_name: "Wambui", role: "accountant" as const },
    { email: "caretaker@mawingu.test", username: "caretaker", first_name: "Peter", last_name: "Ochieng", role: "caretaker" as const },
  ];
  const passwordHash = await sha256("demo1234");
  for (const u of users) r.users.insert({ ...u, password_hash: passwordHash });
  const owner = 1;
  const accountant = 2;

  // Chart of accounts and the locked expense categories.
  const created = new Date(start.year, start.month - 1, 1).toISOString();
  for (const [codeNo, name, type] of HEADERS) {
    r.accounts.insert({ code: codeNo, name, account_type: type, parent_code: "", is_header: true, description: "" });
  }
  for (const [codeNo, name, type, parent] of ACCOUNTS) {
    r.accounts.insert({ code: codeNo, name, account_type: type, parent_code: parent, is_header: false, description: "" });
  }
  for (const codeNo of CATEGORY_CODES) {
    const account = r.accounts.find((a) => a.code === codeNo)!;
    r.expenseCategories.insert({ name: account.name, description: "", account_code: codeNo, created_at: created });
  }
  const category = (codeNo: string) => r.expenseCategories.find((c) => c.account_code === codeNo)!.id;

  // Buildings and units.
  const buildingIds: Record<string, number> = {};
  for (const p of plan()) {
    const b = r.buildings.insert({
      name: p.name, code: p.code, address: p.address, total_floors: p.floors, property_type: p.property_type,
      notes: "", water_rate: p.water_rate, photo_file: null, photo_version: null, created_at: created, updated_at: created,
    });
    buildingIds[p.code] = b.id;
    for (const u of p.units) {
      r.units.insert({
        building: b.id, label: u.label, floor: u.floor, unit_type: u.type,
        classification: u.business ? "BUSINESS" : "RESIDENTIAL", monthly_rent: u.rent, notes: "",
        statement_descriptor: "", under_maintenance: false, combined_into: null, vacant_since: null,
        created_at: created, updated_at: created,
      });
    }
  }
  const unitByLabel = (label: string) => r.units.find((u) => u.label === label)!;

  // Combined space: BP05 is let together with BP06.
  const bp05 = unitByLabel("BP05");
  const bp06 = unitByLabel("BP06");
  r.units.update(bp06.id, { combined_into: bp05.id });

  // Which units stand empty today, and which were vacated during the books.
  const vacantToday = new Set(["KC4D", "SG3E", "SG2F", "RF3B", "BP09", "RF2D"]);
  const turnover = new Set(["KC2C", "SG1D", "RF1A", "BP03", "SG3E", "RF3B"]);
  r.units.update(unitByLabel("RF2D").id, { under_maintenance: true, notes: "Roof leak repairs in progress" });

  const profiles = new Map<number, Profile>();
  let businessIndex = 0;

  const makeTenant = (unit: UnitRow, moveIn: string, opts: Partial<TenantRow> = {}) => {
    const business = unit.classification === "BUSINESS";
    const who = business
      ? (() => {
          const [first, last] = BUSINESSES[businessIndex++ % BUSINESSES.length];
          const p = person();
          return { ...p, first_name: first, last_name: last, email: `accounts@${first.toLowerCase()}-demo.example.com` };
        })()
      : person();
    const rent = unit.id === bp05.id ? unit.monthly_rent + bp06.monthly_rent : unit.monthly_rent;
    const kyc = chance(0.72) ? "verified" : chance(0.5) ? "pending" : chance(0.7) ? "not_started" : "rejected";
    const t = r.tenants.insert({
      ...who,
      care_of: business && chance(0.3) ? `${pick(FIRST)} ${pick(LAST)} (Director)` : "",
      emergency_contact: business ? "" : `${pick(FIRST)} ${pick(LAST)}`,
      emergency_phone: business ? "" : `+2547001${String(between(10000, 99999))}`,
      unit: unit.id, monthly_rent: rent, deposit_paid: round2(rent * (business ? 3 : 1)), agreed_deposit: null,
      deposit_refund_percentage: 100, deposit_refund_amount: 0, due_day: 5, is_billable: true,
      billing_frequency: "monthly", status: "active", move_in_date: moveIn, move_out_date: null,
      notice_date: null, intended_move_out_date: null, move_out_notes: "", notes: "",
      kyc_status: kyc, kyc_verified_at: kyc === "verified" ? `${moveIn}T09:30:00.000Z` : null,
      kyc_verified_by: kyc === "verified" ? owner : null,
      kyc_notes: kyc === "rejected" ? "ID photo is blurred — please re-upload a clear copy." : "",
      created_at: `${moveIn}T08:00:00.000Z`, updated_at: `${moveIn}T08:00:00.000Z`,
      ...opts,
    });
    profiles.set(t.id, opts.is_billable === false ? "prompt" : profile());
    return t;
  };

  const booksStart = target.meta.books_start;
  const randomPastDate = (minMonthsAgo: number, maxMonthsAgo: number) => {
    const k = nowKey - between(minMonthsAgo, maxMonthsAgo);
    const { year, month } = fromMonthKey(k);
    return isoDate(year, month, between(1, 25));
  };

  // Tenancies: a former tenant on turnover units, then the current one.
  for (const unit of r.units.all()) {
    if (unit.combined_into) continue;
    const building = r.buildings.get(unit.building)!;
    if (building.property_type !== "rental") continue;
    let nextMoveIn: string;
    if (turnover.has(unit.label)) {
      const formerIn = randomPastDate(14, 30);
      const leaveKey = nowKey - between(2, 6);
      const leave = fromMonthKey(leaveKey);
      const moveOut = isoDate(leave.year, leave.month, between(20, daysInMonth(leave.year, leave.month)));
      const former = makeTenant(unit, formerIn);
      const pct = chance(0.6) ? 100 : pick([50, 75, 0]);
      r.tenants.update(former.id, {
        status: "moved_out", move_out_date: moveOut, notice_date: isoDate(leave.year, leave.month, 1),
        intended_move_out_date: moveOut, deposit_refund_percentage: pct,
        deposit_refund_amount: round2((former.deposit_paid * pct) / 100),
        move_out_notes: pct < 100 ? "Part of the deposit kept for repainting and a broken window." : "Left in good order.",
      });
      const next = fromMonthKey(leaveKey + 1);
      nextMoveIn = isoDate(next.year, next.month, between(1, 10));
      if (vacantToday.has(unit.label)) {
        r.units.update(unit.id, { vacant_since: moveOut });
        continue;
      }
    } else {
      if (vacantToday.has(unit.label)) {
        r.units.update(unit.id, { vacant_since: isoDate(start.year, start.month, between(1, 20)) });
        continue;
      }
      nextMoveIn = chance(0.7) ? randomPastDate(10, 36) : randomPastDate(1, 7);
    }
    if (nextMoveIn > today) nextMoveIn = today;
    makeTenant(unit, nextMoveIn);
  }

  // A rent-free caretaker on Riverbend's ground floor.
  const caretakerUnit = r.units.insert({
    building: buildingIds.RF, label: "RF0A", floor: 0, unit_type: "single", classification: "RESIDENTIAL",
    monthly_rent: 0, notes: "Caretaker's room", statement_descriptor: "", under_maintenance: false,
    combined_into: null, vacant_since: null, created_at: created, updated_at: created,
  });
  makeTenant(caretakerUnit, randomPastDate(18, 30), { is_billable: false, monthly_rent: 0, deposit_paid: 0, notes: "Caretaker — housed as part of the job, not charged rent.", kyc_status: "verified" });

  // One commercial letting invoiced a quarter in advance.
  const quarterly = r.tenants.find((t) => t.unit === unitByLabel("BP08").id && t.status === "active");
  if (quarterly) r.tenants.update(quarterly.id, { billing_frequency: "quarterly" });

  // Opening balances for tenancies that predate the books.
  const openingKey = keyOfIso(booksStart) - 1;
  const openingPeriod = fromMonthKey(openingKey);
  for (const t of r.tenants.all()) {
    if (t.move_in_date >= booksStart || !t.is_billable) continue;
    const p = profiles.get(t.id)!;
    const owed = p === "chronic" ? t.monthly_rent * between(1, 2) : p === "partial" ? roundTo(t.monthly_rent * rand() * 0.6, 100) : p === "advance" ? -roundTo(t.monthly_rent * 0.5, 100) : 0;
    if (owed === 0) continue;
    r.charges.insert({
      tenant: t.id, period_month: openingPeriod.month, period_year: openingPeriod.year,
      expected_rent: round2(owed), expected_vat: 0, waived_amount: 0, is_opening: true,
    });
  }

  // Bill every month, then read water, then collect.
  ensureBilling();
  for (let k = startKey; k <= nowKey; k++) {
    const { year, month } = fromMonthKey(k);
    const lastDay = daysInMonth(year, month);
    const isCurrent = k === nowKey;
    const dayLimit = isCurrent ? Number(today.slice(8, 10)) : lastDay;

    // Water: residential blocks read on the 25th for that month.
    for (const t of r.tenants.all()) {
      const unit = r.units.get(t.unit)!;
      const b = r.buildings.get(unit.building)!;
      if (b.code === "BP" || !t.is_billable) continue;
      if (t.move_in_date > isoDate(year, month, 25) || (t.move_out_date && t.move_out_date < isoDate(year, month, 1))) continue;
      if (isCurrent && dayLimit < 25) continue;
      const prev = r.utilityCharges
        .filter((u) => u.unit === unit.id && u.charge_type === "utility")
        .sort((a, b2) => monthKey(b2.period_year, b2.period_month) - monthKey(a.period_year, a.period_month))[0];
      const opening = prev?.closing_reading ?? between(120, 900);
      const used = between(2, 13);
      r.utilityCharges.insert({
        tenant: t.id, unit: unit.id, posting_date: isoDate(year, month, 25), period_month: month, period_year: year,
        label: `Water — ${monthLabel(year, month)} (${used} units)`, opening_reading: opening, closing_reading: opening + used,
        units: used, amount: round2(used * b.water_rate), notes: "", charge_type: "utility", expense_category: null,
      });
    }

    // Collections.
    for (const t of r.tenants.all()) {
      if (!t.is_billable) continue;
      const moveInKey = keyOfIso(t.move_in_date);
      const moveOutKey = t.move_out_date ? keyOfIso(t.move_out_date) : Infinity;
      if (k < moveInKey || k > moveOutKey) continue;
      const p = profiles.get(t.id)!;
      if (t.billing_frequency === "quarterly" && (month - 1) % 3 !== 0) continue;
      const due = t.billing_frequency === "quarterly"
        ? round2((t.monthly_rent + vatOn(t, t.monthly_rent)) * 3)
        : round2(t.monthly_rent + vatOn(t, t.monthly_rent));
      const water = r.utilityCharges
        .filter((u) => u.tenant === t.id && u.period_month === month && u.period_year === year)
        .reduce((s, u) => s + u.amount, 0);
      let amount = 0;
      let day = between(1, 5);
      switch (p) {
        case "prompt": amount = due + water; break;
        case "late": amount = due + water; day = between(8, 22); break;
        case "partial": amount = roundTo((due + water) * (0.5 + rand() * 0.35), 100); day = between(3, 18); break;
        case "chronic": amount = chance(0.55) ? due + water : 0; day = between(10, 27); break;
        case "advance": amount = (k - moveInKey) % 2 === 0 ? (due + water) * 2 : 0; day = between(1, 4); break;
      }
      // A tenant clears most arrears every few months.
      if ((p === "partial" || p === "chronic") && chance(0.15)) amount += Math.max(0, roundTo(currentBalance(t.id) * 0.5, 100));
      // The month a tenant moves in, rent is paid on the move-in day.
      if (k === moveInKey) day = Math.max(day, Number(t.move_in_date.slice(8, 10)));
      if (amount <= 0 || day > dayLimit) continue;
      const date = isoDate(year, month, Math.min(day, lastDay));
      // Most bank payments arrive through the bank feed, which records where they came from.
      const source = sourceFor();
      const reference = referenceFor(source, date);
      let bankCredit: number | null = null;
      if (source === "bank" && chance(0.6)) {
        bankCredit = r.bankCredits.insert({
          transaction_id: reference, payment_ref: `ACC ${r.units.get(t.unit)!.label}`, account_number: "01100000000000",
          amount: round2(amount), channel: "Bank transfer", narration: `RENT ${r.units.get(t.unit)!.label} ${t.last_name.toUpperCase()}`,
          detail: "", status: "assigned", received_at: `${date}T07:${String(between(10, 59))}:00.000Z`,
          payer_phone: "", payer_name: `${t.first_name} ${t.last_name}`.toUpperCase(), void_requeue_count: 0, assigned_payment: null,
        }).id;
      }
      const payment = recordPayment(null, {
        tenant: t, amount: round2(amount), payment_date: date, period_month: month, period_year: year,
        source, payment_type: "rent", reference, notes: "", bank_credit: bankCredit,
      });
      if (bankCredit) r.bankCredits.update(bankCredit, { assigned_payment: payment.id });
      // A late fee now and then for the chronic payers.
      if (p === "chronic" && amount === 0 && chance(0.35)) {
        r.utilityCharges.insert({
          tenant: t.id, unit: t.unit, posting_date: isoDate(year, month, 10), period_month: month, period_year: year,
          label: "Late payment fee", opening_reading: null, closing_reading: null, units: null,
          amount: 1000, notes: "", charge_type: "late_fee", expense_category: null,
        });
      }
    }

    // Expenses for the month.
    const exp = (building: string | null, codeNo: string, amount: number, description: string, day = between(1, 28), pettyCash = false) => {
      if (day > dayLimit) return;
      const date = isoDate(year, month, Math.min(day, lastDay));
      r.expenses.insert({
        date, building: building ? buildingIds[building] : null, unit: null, category: category(codeNo),
        amount: round2(amount), description, reference: pettyCash ? `PC-${between(100, 999)}` : `INV-${between(1000, 9999)}`,
        period_month: month, period_year: year, notes: "", petty_cash: pettyCash,
        created_at: `${date}T10:00:00.000Z`, updated_at: `${date}T10:00:00.000Z`,
      });
    };
    exp("KC", "5600", 18000, "Security guards — monthly contract", 28);
    exp("KC", "5220", 6000, "Cleaning services", 27);
    exp("KC", "5800", 12000, "Caretaker wages", 28);
    exp("KC", "5300", between(4500, 7200), "Common-area electricity (KPLC tokens)", between(3, 8));
    exp("BP", "5600", 22000, "Security guards — monthly contract", 28);
    exp("BP", "5220", 8000, "Cleaning & garbage collection", 27);
    exp("BP", "5300", between(9000, 12500), "Common-area power & water", between(3, 8));
    exp("SG", "5600", 15000, "Security guards — monthly contract", 28);
    exp("SG", "5800", 10000, "Caretaker wages", 28);
    exp("SG", "5220", 5000, "Garbage collection", 26);
    exp("RF", "5600", 12000, "Night watchman", 28);
    exp("RF", "5220", 4000, "Cleaning services", 26);
    exp("MF", "5950", between(15000, 45000), pick(["Fertiliser and seed", "Dairy meal and vet supplies", "Irrigation fuel and spares"]), between(5, 20));
    exp("MF", "5910", 18000, "Farm hand wages", 30);
    exp("HO", "5700", 4500, "Property management software subscription", 2);
    exp("HO", "5910", 45000, "Office staff salaries", 30);
    exp("HO", "5920", between(3000, 8000), "Stationery and printing", between(5, 25), true);
    exp("HO", "5940", between(800, 1500), "Bank charges", 30);
    exp("HO", "5900", between(3000, 9000), "Fuel for property visits", between(5, 25), true);
    for (let i = 0; i < between(0, 2); i++) {
      const b = pick(["KC", "SG", "RF", "BP"]);
      const [codeNo, what] = pick([["5200", "General repairs"], ["5210", "Plumbing repair"], ["5210", "Electrical fault repair"], ["5230", "Hedge trimming"]] as const);
      const amount = between(1500, 25000);
      exp(b, codeNo, amount, what, between(1, 28), amount <= 3000);
    }
    if ((month - 1) % 3 === 0) {
      for (const b of ["KC", "BP", "SG", "RF"]) exp(b, "6100", 36000, "Building insurance — quarterly premium", 10);
    }
    if (month === 3) for (const b of ["KC", "BP", "SG", "RF", "MF"]) exp(b, "6200", between(18000, 60000), "Annual land rates", 15);

    // Farm produce and parking takings.
    const income = (building: string, codeNo: string, amount: number, description: string, day: number) => {
      if (day > dayLimit) return;
      const account = r.accounts.find((a) => a.code === codeNo)!;
      const date = isoDate(year, month, Math.min(day, lastDay));
      r.manualIncome.insert({
        date, building: buildingIds[building], account: account.id, amount: round2(amount), description,
        reference: `MI-${between(1000, 9999)}`, period_month: month, period_year: year, notes: "",
        created_at: `${date}T12:00:00.000Z`,
      });
    };
    income("MF", "4300", roundTo(between(35000, 90000), 500), pick(["Milk sales", "Maize sale", "Avocado harvest", "Sale of heifer"]), between(12, 28));
    income("BP", "4250", roundTo(between(6000, 9500), 100), "Parking takings", 28);
  }

  // Two tenants on notice.
  const current = r.tenants.filter((t) => t.status === "active" && t.is_billable);
  for (const t of [current[3], current[17]].filter(Boolean)) {
    const leaving = fromMonthKey(nowKey + 1);
    r.tenants.update(t.id, {
      status: "notice_given", notice_date: isoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1),
      intended_move_out_date: isoDate(leaving.year, leaving.month, between(10, 28)), move_out_notes: "Relocating for work.",
    });
  }

  // Credits and refunds.
  const kcTenant = r.tenants.find((t) => t.status === "active" && r.units.get(t.unit)!.label.startsWith("KC2"));
  if (kcTenant) {
    const last = fromMonthKey(nowKey - 1);
    const charge = r.charges.find((c) => c.tenant === kcTenant.id && c.period_month === last.month && c.period_year === last.year);
    r.credits.insert({
      number: `CN-${String(target.nextSequence("CN")).padStart(4, "0")}`, tenant: kcTenant.id, credit_type: "credit_note",
      reason: "rent_concession", credit_date: isoDate(last.year, last.month, 20), net_amount: 5000, vat_amount: 0, amount: 5000,
      amount_applied: 0, on_hold: false, description: "Water outage for nine days — rent concession", internal_notes: "Agreed with the owner.",
      reference: "", evidence_file: null, evidence_name: "", charge: charge?.id ?? null, utility_charge: null, expense_category: null,
      created_by: owner, created_at: `${isoDate(last.year, last.month, 20)}T11:00:00.000Z`, voided_at: null, voided_by: null, void_reason: "",
    });
  }
  const sgTenant = r.tenants.find((t) => t.status === "active" && r.units.get(t.unit)!.label.startsWith("SG1"));
  if (sgTenant) {
    const date = isoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), Math.min(3, Number(today.slice(8, 10))));
    r.credits.insert({
      number: `CR-${String(target.nextSequence("CR")).padStart(4, "0")}`, tenant: sgTenant.id, credit_type: "account_credit",
      reason: "tenant_paid_cost", credit_date: date, net_amount: 3500, vat_amount: 0, amount: 3500, amount_applied: 3500,
      on_hold: false, description: "Tenant paid the plumber for a burst pipe", internal_notes: "Receipt seen.",
      reference: "PLB-221", evidence_file: null, evidence_name: "", charge: null, utility_charge: null,
      expense_category: category("5210"), created_by: owner, created_at: `${date}T09:00:00.000Z`,
      voided_at: null, voided_by: null, void_reason: "",
    });
  }
  const advance = r.tenants.find((t) => t.status === "active" && profiles.get(t.id) === "advance" && currentBalance(t.id) < -1000);
  if (advance) {
    const credit = round2(-currentBalance(advance.id));
    r.refunds.insert({
      number: `RF-${String(target.nextSequence("RF")).padStart(4, "0")}`, tenant: advance.id,
      amount: round2(Math.min(credit, 2000)), method: "mpesa", paid_to: advance.phone, reference: "", notes: "Overpayment refund requested by tenant.",
      status: "scheduled", sent_on: null, credit: null, created_by: owner, created_at: new Date().toISOString(),
      sent_recorded_by: null, closed_by: null, close_reason: "",
    });
  }

  // The reconciliation queue: bank credits whose reference matched no unit.
  const queue: [number, string, string, string][] = [
    [12500, "ACC KC 2B", "RENT KC 2B JANE", "JANE W"],
    [9800, "ACC SGARDENS", "SG RENT OCT", "M OTIENO"],
    [45000, "ACC BARAKA", "SHOP RENT", "KIJIJI TRADERS"],
    [7600, "ACC RF-12", "RENT RIVERBEND", "K KORIR"],
  ];
  queue.forEach(([amount, ref, narration, name], i) => {
    const day = Math.max(1, Number(today.slice(8, 10)) - i * 2);
    const date = isoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), day);
    r.bankCredits.insert({
      transaction_id: `FT${date.replace(/-/g, "").slice(2)}${between(10000, 99999)}`, payment_ref: ref,
      account_number: "01100000000000", amount, channel: i === 1 ? "M-Pesa paybill" : "Bank transfer", narration,
      detail: "The account reference does not match any unit label.", status: "unmatched",
      received_at: `${date}T0${between(6, 9)}:${between(10, 59)}:00.000Z`,
      payer_phone: i === 1 ? "+254700099123" : "", payer_name: name, void_requeue_count: 0, assigned_payment: null,
    });
  });

  // Maintenance log (costs booked as expenses).
  const jobs: [string, string, number, "open" | "in_progress" | "resolved"][] = [
    ["KC3B", "Kitchen sink leaking", 2800, "resolved"],
    ["SG2A", "Replace bathroom door lock", 1500, "resolved"],
    ["BP02", "Shop shutter jammed", 6500, "resolved"],
    ["RF1C", "Rewire faulty socket", 3200, "resolved"],
    ["RF2D", "Roof leak above unit", 0, "in_progress"],
    ["KC1A", "Balcony light not working", 0, "open"],
  ];
  jobs.forEach(([label, description, cost, status], i) => {
    const unit = unitByLabel(label);
    const k = nowKey - (jobs.length - i) % 4;
    const { year, month } = fromMonthKey(k);
    const date = isoDate(year, month, Math.min(between(3, 20), k === nowKey ? Number(today.slice(8, 10)) : 28));
    let expense: number | null = null;
    if (cost) {
      expense = r.expenses.insert({
        date, building: unit.building, unit: unit.id, category: category(label.startsWith("RF1") ? "5210" : "5200"), amount: cost,
        description: `Maintenance — ${label}: ${description}`, reference: "", period_month: month, period_year: year,
        notes: "", petty_cash: cost <= 3000, created_at: `${date}T13:00:00.000Z`, updated_at: `${date}T13:00:00.000Z`,
      }).id;
    }
    r.maintenance.insert({ unit: unit.id, description, cost, reported_date: date, status, notes: "", expense, created_at: `${date}T13:00:00.000Z` });
  });

  // Sample KYC documents for a few tenants (synthetic images, clearly marked).
  const withDocs = r.tenants.filter((t) => t.kyc_status === "verified" || t.kyc_status === "pending").slice(0, 8);
  for (const t of withDocs) {
    const name = `${t.first_name} ${t.last_name}`;
    for (const [type, label] of [["id_front", "National ID — front"], ["id_back", "National ID — back"]] as const) {
      if (t.kyc_status === "pending" && type === "id_back") continue;
      const fileId = await saveFile(sampleDocument(label, name));
      r.documents.insert({ tenant: t.id, doc_type: type, file_id: fileId, original_name: `${type}-${t.id}.svg`, uploaded_at: t.created_at });
    }
  }

  // Message history (all simulated).
  const recentTenants = r.tenants.filter((t) => t.status !== "moved_out").slice(0, 60);
  for (let k = nowKey - 2; k <= nowKey; k++) {
    const { year, month } = fromMonthKey(k);
    if (k === nowKey && Number(today.slice(8, 10)) < 1) continue;
    for (const t of recentTenants.filter((_, i) => i % 6 === k % 6)) {
      const at = `${isoDate(year, month, 1)}T08:00:00.000Z`;
      r.notifications.insert({
        tenant: t.id, channel: "sms", subject: "Rent reminder",
        body: `Dear ${t.first_name}, a reminder that rent of KES ${t.monthly_rent.toLocaleString()} is due on ${isoDate(year, month, 5)}. — Mawingu Properties.`,
        status: t.phone ? "sent" : "failed", sent_at: t.phone ? at : null, error: t.phone ? "" : "No phone number on file.",
        template_key: "rent_reminder", created_at: at,
      });
    }
  }
  for (const t of r.tenants.filter((t) => t.status === "active" && currentBalance(t.id) > t.monthly_rent).slice(0, 6)) {
    const at = `${isoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), Math.min(10, Number(today.slice(8, 10))))}T09:15:00.000Z`;
    r.notifications.insert({
      tenant: t.id, channel: t.email ? "both" : "sms", subject: "Outstanding balance",
      body: `Dear ${t.first_name}, our records show an outstanding balance of KES ${currentBalance(t.id).toLocaleString()}. Kindly settle it at your earliest convenience. — Mawingu Properties.`,
      status: "sent", sent_at: at, error: "", template_key: "rent_overdue", created_at: at,
    });
  }

  // Activity history: the rent runs, bank notifications and office work.
  const audit = (at: string, entry: { kind?: "event" | "auth"; action: string; summary: string; type: string; id?: number | null; label?: string; financial?: boolean; actor?: number | null; source?: "web" | "bank" | "cron" | "system"; detail?: string }) =>
    r.audit.insert({
      created_at: at, kind: entry.kind ?? "event", action: entry.action, summary: entry.summary, object_type: entry.type,
      object_id: entry.id ?? null, object_label: entry.label ?? "", old_values: {}, new_values: {}, is_financial: Boolean(entry.financial),
      actor: entry.actor ?? null, source: entry.source ?? "web", source_detail: entry.detail ?? "", request_id: `seed_${r.audit.all().length}`,
    });
  for (let k = startKey; k <= nowKey; k++) {
    const { year, month } = fromMonthKey(k);
    audit(`${isoDate(year, month, 1)}T00:05:00.000Z`, { action: "rent_run", summary: `Monthly rent run raised ${monthLabel(year, month)} charges`, type: "billing", source: "cron", detail: "monthly_rent_run", financial: true });
  }
  const recentPayments = [...r.payments.all()].sort((a, b) => a.payment_date.localeCompare(b.payment_date)).slice(-40);
  for (const p of recentPayments) {
    const t = r.tenants.get(p.tenant)!;
    const viaBank = Boolean(p.bank_credit);
    audit(`${p.payment_date}T${viaBank ? "07" : "11"}:${String(between(10, 59))}:00.000Z`, {
      action: "payment_record", summary: `Recorded KES ${p.amount.toLocaleString()} payment from ${t.first_name} ${t.last_name}`,
      type: "payment", id: p.id, label: p.reference, financial: true,
      actor: viaBank ? null : accountant, source: viaBank ? "bank" : "web",
    });
  }
  audit(`${today}T07:45:00.000Z`, { kind: "auth", action: "login", summary: "Signed in", type: "user", id: accountant, label: "accountant@mawingu.test", actor: accountant });

  for (let i = 0; i < 6; i++) {
    r.loginAttempts.insert({
      email: i === 2 ? "owner@mawingu.test" : i % 2 ? "accountant@mawingu.test" : "owner@mawingu.test",
      ip_address: "127.0.0.1", user_agent: "Demo browser", successful: i !== 2,
      attempted_at: new Date(Date.now() - (6 - i) * 86_400_000).toISOString(),
    });
  }

  // Receivables raised for the quarterly letting's full quarter, if needed.
  ensureBilling();
}
