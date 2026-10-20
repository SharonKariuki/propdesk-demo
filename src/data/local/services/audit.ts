/**
 * The director's Activity log. Handlers call `logEvent` for each named action
 * and `logChange` for field-by-field edits; both share the request's id so the
 * Activity page folds them into one entry, as the real audit trail does.
 */
import { repos } from "../context";
import type { LocalRequest } from "../http";
import type { AuditRow } from "../schema";
import { nowIso } from "../util";

interface EventInput {
  action: string;
  summary: string;
  objectType: string;
  objectId?: number | null;
  objectLabel?: string;
  financial?: boolean;
}

export function logEvent(req: LocalRequest | null, e: EventInput, kind: AuditRow["kind"] = "event") {
  repos().audit.insert({
    created_at: nowIso(),
    kind,
    action: e.action,
    summary: e.summary,
    object_type: e.objectType,
    object_id: e.objectId ?? null,
    object_label: e.objectLabel ?? "",
    old_values: {},
    new_values: {},
    is_financial: Boolean(e.financial),
    actor: req?.user?.id ?? null,
    source: req ? "web" : "system",
    source_detail: "",
    request_id: req?.requestId ?? "",
  });
}

/** Record what an edit changed. Fields whose value did not move are skipped. */
export function logChange(
  req: LocalRequest,
  objectType: string,
  objectId: number,
  objectLabel: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  financial = false,
) {
  const oldValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      oldValues[key] = before[key];
      newValues[key] = after[key];
    }
  }
  if (Object.keys(newValues).length === 0) return;
  repos().audit.insert({
    created_at: nowIso(),
    kind: "change",
    action: "update",
    summary: `Changed ${Object.keys(newValues).map((k) => k.replace(/_/g, " ")).join(", ")}`,
    object_type: objectType,
    object_id: objectId,
    object_label: objectLabel,
    old_values: oldValues,
    new_values: newValues,
    is_financial: financial,
    actor: req.user?.id ?? null,
    source: "web",
    source_detail: "",
    request_id: req.requestId,
  });
}
