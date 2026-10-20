/** Buildings, units, combined spaces, cover photos and maintenance. */
import type { PropertyType, UnitClassification, UnitType } from "@/lib/types";

import { repos } from "../context";
import { badRequest, created, fieldError, fileResponse, noContent, notFound, type LocalRequest, type Router } from "../http";
import type { BuildingRow, UnitRow } from "../schema";
import { logChange, logEvent } from "../services/audit";
import { occupantOf, unitStatus } from "../services/billing";
import { deleteFile, readFile, saveFile } from "../services/files";
import {
  byLabel, serializeBuilding, serializeBuildingDetail, serializeMaintenance, serializeUnit,
} from "../services/serializers";
import {
  bodyObject, dateField, idParam, intField, money, nowIso, requiredStr, round2, str, todayIso,
} from "../util";

const UNIT_TYPES: UnitType[] = ["single", "double", "bedsitter", "1br", "2br", "3br", "shop"];
const PROPERTY_TYPES: PropertyType[] = ["rental", "farm", "expense_only"];

function getBuilding(req: LocalRequest): BuildingRow {
  const b = repos().buildings.get(idParam(req.params.id));
  if (!b) throw notFound();
  return b;
}

function getUnit(id: number): UnitRow {
  const u = repos().units.get(id);
  if (!u) throw notFound();
  return u;
}

/** A short code from a building name, used to suggest unit labels. */
function codeFor(name: string) {
  const words = name.replace(/[^A-Za-z ]/g, " ").split(/\s+/).filter(Boolean);
  return (words.map((w) => w[0]).join("").slice(0, 3) || "BLD").toUpperCase();
}

function buildingFields(body: Record<string, unknown>, existing?: BuildingRow) {
  const out: Partial<BuildingRow> = {};
  if (!existing || body.name !== undefined) {
    const name = requiredStr(body.name, "name");
    const clash = repos().buildings.find((b) => b.name.toLowerCase() === name.toLowerCase() && b.id !== existing?.id);
    if (clash) throw fieldError("name", "A building with this name already exists.");
    out.name = name;
  }
  if (body.address !== undefined) out.address = str(body.address);
  if (body.notes !== undefined) out.notes = str(body.notes);
  if (body.total_floors !== undefined && str(body.total_floors) !== "") {
    out.total_floors = intField(body.total_floors, "total_floors", { min: 0, max: 100 });
  }
  if (body.property_type !== undefined) {
    const t = str(body.property_type) as PropertyType;
    if (!PROPERTY_TYPES.includes(t)) throw fieldError("property_type", `"${t}" is not a valid choice.`);
    out.property_type = t;
  }
  return out;
}

function unitFields(raw: Record<string, unknown>, buildingId: number, existing?: UnitRow): Partial<UnitRow> {
  const out: Partial<UnitRow> = {};
  if (!existing || raw.label !== undefined) {
    const label = requiredStr(raw.label, "label").toUpperCase();
    const clash = repos().units.find((u) => u.label.toUpperCase() === label && u.id !== existing?.id);
    if (clash) throw fieldError("label", `Unit label ${label} is already in use.`);
    out.label = label;
  }
  if (!existing || raw.floor !== undefined) out.floor = intField(raw.floor ?? 0, "floor", { min: 0, max: 100 });
  if (!existing || raw.unit_type !== undefined) {
    const t = str(raw.unit_type || "1br") as UnitType;
    if (!UNIT_TYPES.includes(t)) throw fieldError("unit_type", `"${t}" is not a valid choice.`);
    out.unit_type = t;
  }
  if (!existing || raw.classification !== undefined) {
    const c = (str(raw.classification) || (out.unit_type === "shop" ? "BUSINESS" : "RESIDENTIAL")) as UnitClassification;
    if (c !== "RESIDENTIAL" && c !== "BUSINESS") throw fieldError("classification", `"${c}" is not a valid choice.`);
    out.classification = c;
  }
  if (!existing || raw.monthly_rent !== undefined) out.monthly_rent = money(raw.monthly_rent, "monthly_rent");
  if (raw.notes !== undefined) out.notes = str(raw.notes);
  if (raw.statement_descriptor !== undefined) out.statement_descriptor = str(raw.statement_descriptor);
  if (!existing) out.building = buildingId;
  return out;
}

function newUnit(fields: Partial<UnitRow>): Omit<UnitRow, "id"> {
  const now = nowIso();
  return {
    building: fields.building!,
    label: fields.label!,
    floor: fields.floor ?? 0,
    unit_type: fields.unit_type ?? "1br",
    classification: fields.classification ?? "RESIDENTIAL",
    monthly_rent: fields.monthly_rent ?? 0,
    notes: fields.notes ?? "",
    statement_descriptor: fields.statement_descriptor ?? "",
    under_maintenance: false,
    combined_into: null,
    vacant_since: todayIso(),
    created_at: now,
    updated_at: now,
  };
}

export function registerBuildings(router: Router) {
  router.get("/buildings/", () =>
    [...repos().buildings.all()].sort((a, b) => a.name.localeCompare(b.name)).map(serializeBuilding));

  router.post("/buildings/", (req) => {
    const fields = buildingFields(bodyObject(req.body));
    const now = nowIso();
    const building = repos().buildings.insert({
      name: fields.name!,
      code: codeFor(fields.name!),
      address: fields.address ?? "",
      total_floors: fields.total_floors ?? 1,
      property_type: fields.property_type ?? "rental",
      notes: fields.notes ?? "",
      water_rate: 150,
      photo_file: null,
      photo_version: null,
      created_at: now,
      updated_at: now,
    });
    logEvent(req, { action: "building_create", summary: `Added property ${building.name}`, objectType: "building", objectId: building.id, objectLabel: building.name });
    return created(serializeBuilding(building));
  });

  router.get("/buildings/:id/", (req) => serializeBuildingDetail(getBuilding(req)));

  router.patch("/buildings/:id/", (req) => {
    const building = getBuilding(req);
    const before = { ...building };
    const fields = buildingFields(bodyObject(req.body), building);
    const updated = repos().buildings.update(building.id, { ...fields, updated_at: nowIso() });
    logChange(req, "building", updated.id, updated.name, before, fields);
    return serializeBuilding(updated);
  });

  router.delete("/buildings/:id/", (req) => {
    const building = getBuilding(req);
    const r = repos();
    const units = r.units.filter((u) => u.building === building.id);
    const unitIds = new Set(units.map((u) => u.id));
    if (r.tenants.find((t) => unitIds.has(t.unit))) {
      throw badRequest("This property has tenancy history, so it cannot be deleted. Its records stay for the statements and the books.");
    }
    if (r.expenses.find((e) => e.building === building.id) || r.manualIncome.find((m) => m.building === building.id)) {
      throw badRequest("This property has expenses or income recorded against it, so it cannot be deleted.");
    }
    for (const m of r.maintenance.filter((m) => unitIds.has(m.unit))) r.maintenance.remove(m.id);
    for (const u of units) r.units.remove(u.id);
    void deleteFile(building.photo_file);
    r.buildings.remove(building.id);
    logEvent(req, { action: "building_delete", summary: `Deleted property ${building.name}`, objectType: "building", objectId: building.id, objectLabel: building.name });
    return noContent();
  });

  router.post("/buildings/:id/bulk-create-units/", (req) => {
    const building = getBuilding(req);
    const raw = bodyObject(req.body).units;
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest({ units: ["Add at least one unit."] });
    const prepared = raw.map((u) => unitFields(u as Record<string, unknown>, building.id));
    const labels = prepared.map((u) => u.label!);
    const dupe = labels.find((l, i) => labels.indexOf(l) !== i);
    if (dupe) throw badRequest({ units: [`Unit label ${dupe} appears twice.`] });
    for (const fields of prepared) repos().units.insert(newUnit(fields));
    logEvent(req, { action: "units_create", summary: `Added ${prepared.length} unit(s) to ${building.name}`, objectType: "building", objectId: building.id, objectLabel: building.name });
    return created(serializeBuildingDetail(building));
  });

  // ── cover photo ──
  router.get("/buildings/:id/photo/", async (req) => {
    const building = getBuilding(req);
    const blob = await readFile(building.photo_file);
    if (!blob) throw notFound("This property has no photo.");
    return fileResponse(blob, `building-${building.id}.jpg`);
  });

  router.put("/buildings/:id/photo/", async (req) => {
    const building = getBuilding(req);
    const photo = bodyObject(req.body).photo;
    if (!(photo instanceof Blob)) throw badRequest({ photo: ["No photo was sent."] });
    if (photo.size > 8 * 1024 * 1024) throw badRequest({ photo: ["The photo must be under 8 MB."] });
    const previous = building.photo_file;
    const fileId = await saveFile(photo);
    const updated = repos().buildings.update(building.id, { photo_file: fileId, photo_version: String(Date.now()), updated_at: nowIso() });
    await deleteFile(previous);
    logEvent(req, { action: "photo_set", summary: `Changed the photo of ${building.name}`, objectType: "building", objectId: building.id, objectLabel: building.name });
    return serializeBuilding(updated);
  });

  router.delete("/buildings/:id/photo/", async (req) => {
    const building = getBuilding(req);
    await deleteFile(building.photo_file);
    repos().buildings.update(building.id, { photo_file: null, photo_version: null, updated_at: nowIso() });
    return noContent();
  });

  // ── units ──
  router.get("/units/", (req) => {
    const q = req.query;
    const building = q.get("building");
    const status = q.get("status");
    const unitType = q.get("unit_type");
    let units = [...repos().units.all()];
    if (building) units = units.filter((u) => u.building === Number(building));
    if (unitType) units = units.filter((u) => u.unit_type === unitType);
    // Units let as part of another unit's space are not separately lettable.
    if (status === "vacant") units = units.filter((u) => !u.combined_into && !occupantOf(u) && !u.under_maintenance);
    else if (status) units = units.filter((u) => unitStatus(u) === status);
    units.sort((a, b) => a.building - b.building || byLabel(a, b));
    return units.map(serializeUnit);
  });

  router.get("/units/status-summary/", (req) => {
    const building = req.query.get("building");
    const units = repos().units.filter((u) => (!building || u.building === Number(building)) && !u.combined_into);
    const summary = { total: units.length, vacant: 0, occupied_paid: 0, occupied_partial: 0, occupied_unpaid: 0, arrears: 0 };
    for (const u of units) summary[unitStatus(u)] += 1;
    return summary;
  });

  router.post("/units/", (req) => {
    const body = bodyObject(req.body);
    const buildingId = Number(body.building);
    if (!repos().buildings.get(buildingId)) throw fieldError("building", "Select a property.");
    const unit = repos().units.insert(newUnit(unitFields(body, buildingId)));
    logEvent(req, { action: "unit_create", summary: `Added unit ${unit.label}`, objectType: "unit", objectId: unit.id, objectLabel: unit.label });
    return created(serializeUnit(unit));
  });

  router.patch("/units/:id/", (req) => {
    const unit = getUnit(idParam(req.params.id));
    const before = { ...unit };
    const fields = unitFields(bodyObject(req.body), unit.building, unit);
    const updated = repos().units.update(unit.id, { ...fields, updated_at: nowIso() });
    logChange(req, "unit", unit.id, unit.label, before, fields, "monthly_rent" in fields);
    return serializeUnit(updated);
  });

  router.post("/units/:id/reconfigure-space/", (req) => {
    const head = getUnit(idParam(req.params.id));
    const r = repos();
    const tenant = occupantOf(head);
    if (!tenant || head.combined_into) throw badRequest("Only a let unit at the head of a space can be reconfigured.");
    const body = bodyObject(req.body);
    const add = (Array.isArray(body.add) ? body.add : []).map(Number);
    const remove = (Array.isArray(body.remove) ? body.remove : []).map(Number);
    let delta = 0;
    for (const id of add) {
      const u = getUnit(id);
      if (u.building !== head.building) throw badRequest(`${u.label} is in another property.`);
      if (u.classification !== "BUSINESS") throw badRequest(`${u.label} is not a commercial unit.`);
      if (occupantOf(u) || u.combined_into) throw badRequest(`${u.label} is not vacant.`);
      r.units.update(u.id, { combined_into: head.id, vacant_since: null });
      delta += u.monthly_rent;
    }
    for (const id of remove) {
      const u = getUnit(id);
      if (u.combined_into !== head.id) throw badRequest(`${u.label} is not part of this space.`);
      r.units.update(u.id, { combined_into: null, vacant_since: todayIso() });
      delta -= u.monthly_rent;
    }
    const rent = body.monthly_rent !== undefined && str(body.monthly_rent) !== ""
      ? money(body.monthly_rent, "monthly_rent")
      : round2(Math.max(0, tenant.monthly_rent + delta));
    const before = { monthly_rent: tenant.monthly_rent };
    r.tenants.update(tenant.id, { monthly_rent: rent, updated_at: nowIso() });
    logEvent(req, { action: "space_reconfigure", summary: `Changed the space let to tenant #${tenant.id}`, objectType: "unit", objectId: head.id, objectLabel: head.label, financial: true });
    logChange(req, "tenant", tenant.id, `Tenant #${tenant.id}`, before, { monthly_rent: rent }, true);
    return serializeUnit(r.units.get(head.id)!);
  });

  // ── maintenance (logging one also books its cost as an expense) ──
  router.get("/maintenance/", (req) => {
    const unit = req.query.get("unit");
    return repos().maintenance
      .filter((m) => !unit || m.unit === Number(unit))
      .sort((a, b) => b.reported_date.localeCompare(a.reported_date))
      .map(serializeMaintenance);
  });

  router.post("/maintenance/", (req) => {
    const body = bodyObject(req.body);
    const unit = getUnit(Number(body.unit));
    const description = requiredStr(body.description, "description");
    const cost = money(body.cost || "0", "cost");
    const date = dateField(body.reported_date || todayIso(), "reported_date")!;
    const r = repos();
    let expenseId: number | null = null;
    if (cost > 0) {
      const category = r.expenseCategories.find((c) => c.account_code === "5200");
      const [y, m] = date.split("-").map(Number);
      expenseId = r.expenses.insert({
        date, building: unit.building, unit: unit.id, category: category?.id ?? 1, amount: cost,
        description: `Maintenance — ${unit.label}: ${description}`, reference: "", period_month: m, period_year: y,
        notes: str(body.notes), petty_cash: cost <= 5000, created_at: nowIso(), updated_at: nowIso(),
      }).id;
    }
    const row = r.maintenance.insert({
      unit: unit.id, description, cost, reported_date: date,
      status: (str(body.status) as "open") || "open", notes: str(body.notes), expense: expenseId, created_at: nowIso(),
    });
    logEvent(req, { action: "maintenance_log", summary: `Logged maintenance on ${unit.label}`, objectType: "unit", objectId: unit.id, objectLabel: unit.label, financial: cost > 0 });
    return created(serializeMaintenance(row));
  });
}

