/**
 * Auth endpoints. Tokens are opaque local strings naming the user — there is
 * no signing, because nothing leaves the browser. Demo accounts and their
 * passwords are listed on the login page and in the README.
 */
import { ROLE_LABELS, permissionsForRole, type Role } from "@/lib/permissions";

import { repos } from "../context";
import { badRequest, fieldError, forbidden, HttpError, notFound, type Router } from "../http";
import type { UserRow } from "../schema";
import { logChange, logEvent } from "../services/audit";
import { serializeAudit } from "../services/serializers";
import { bodyObject, idParam, nowIso, randomId, sha256, str } from "../util";

const ROLE_DISPLAY = ROLE_LABELS;
const ROLES = Object.keys(ROLE_LABELS) as Role[];

/** The signed-in user as the UI sees it — role, its permissions, and the two
 *  legacy flags the original screens read (derived from the permissions). */
export function serializeUser(u: UserRow) {
  const permissions = permissionsForRole(u.role);
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    first_name: u.first_name,
    last_name: u.last_name,
    role: u.role,
    role_display: ROLE_DISPLAY[u.role],
    permissions,
    can_record_money: permissions.includes("payments.record"),
    can_forgive_money: permissions.includes("payments.void"),
  };
}

const accessToken = (u: UserRow) => `local-access.${u.id}.${randomId()}`;
const refreshToken = (u: UserRow) => `local-refresh.${u.id}.${randomId()}`;

/** The user a bearer token names, or null. */
export function userFromToken(header: string | undefined): UserRow | null {
  const match = /^Bearer local-access\.(\d+)\./.exec(header ?? "");
  if (!match) return null;
  return repos().users.get(Number(match[1])) ?? null;
}

function recordAttempt(email: string, successful: boolean) {
  repos().loginAttempts.insert({
    email,
    ip_address: "127.0.0.1",
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    successful,
    attempted_at: nowIso(),
  });
}

function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 8) problems.push("This password is too short. It must contain at least 8 characters.");
  if (/^\d+$/.test(password)) problems.push("This password is entirely numeric.");
  if (["password", "12345678", "qwerty123"].includes(password.toLowerCase())) problems.push("This password is too common.");
  return problems;
}

export function registerAuth(router: Router) {
  router.post("/auth/login/", async (req) => {
    const body = bodyObject(req.body);
    const email = str(body.email).toLowerCase();
    const password = str(body.password);
    const user = repos().users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.password_hash !== (await sha256(password))) {
      recordAttempt(email, false);
      throw badRequest("No active account found with the given credentials");
    }
    recordAttempt(user.email, true);
    logEvent({ ...req, user }, {
      action: "login", summary: "Signed in", objectType: "user", objectId: user.id, objectLabel: user.email,
    }, "auth");
    return { access: accessToken(user), refresh: refreshToken(user), user: serializeUser(user) };
  }, { public: true });

  router.post("/auth/refresh/", (req) => {
    const match = /^local-refresh\.(\d+)\./.exec(str(bodyObject(req.body).refresh));
    const user = match ? repos().users.get(Number(match[1])) : undefined;
    if (!user) throw new HttpError(401, { detail: "Token is invalid or expired", code: "token_not_valid" });
    return { access: accessToken(user), refresh: refreshToken(user) };
  }, { public: true });

  router.post("/auth/logout/", () => ({}), { public: true });

  router.get("/auth/me/", (req) => serializeUser(req.user!));

  router.patch("/auth/me/", (req) => {
    const body = bodyObject(req.body);
    const patch: Partial<UserRow> = {};
    if (body.first_name !== undefined) patch.first_name = str(body.first_name);
    if (body.last_name !== undefined) patch.last_name = str(body.last_name);
    if (body.email !== undefined) {
      const email = str(body.email).toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest({ email: ["Enter a valid email address."] });
      if (repos().users.find((u) => u.email === email && u.id !== req.user!.id)) {
        throw badRequest({ email: ["A user with that email already exists."] });
      }
      patch.email = email;
    }
    const user = repos().users.update(req.user!.id, patch);
    logEvent(req, { action: "profile_update", summary: "Updated their profile", objectType: "user", objectId: user.id, objectLabel: user.email });
    return serializeUser(user);
  });

  router.post("/auth/change-password/", async (req) => {
    const body = bodyObject(req.body);
    const user = req.user!;
    if (user.password_hash !== (await sha256(str(body.current_password)))) {
      throw badRequest({ current_password: ["Your current password is incorrect."] });
    }
    const next = str(body.new_password);
    const problems = passwordProblems(next);
    if (problems.length) throw badRequest({ new_password: problems });
    repos().users.update(user.id, { password_hash: await sha256(next) });
    logEvent(req, { action: "password_change", summary: "Changed their password", objectType: "user", objectId: user.id, objectLabel: user.email }, "auth");
    return { detail: "Password changed." };
  });

  // Password reset: no email is sent. The reset link is returned in the
  // response (and logged to the console) so the flow can be completed locally.
  router.post("/auth/password-reset/", (req) => {
    const email = str(bodyObject(req.body).email).toLowerCase();
    const user = repos().users.find((u) => u.email === email);
    const detail = "If that address has an account, a reset link is on its way.";
    if (!user) return { detail };
    const token = randomId("reset");
    repos().resetTokens.insert({ token, user: user.id, created_at: nowIso(), used: false });
    const link = `/reset-password/confirm/${token}`;
    console.info(`[local data] Password reset link (demo — not emailed): ${window.location.origin}${link}`);
    return { detail, demo_reset_link: link };
  }, { public: true });

  router.post("/auth/password-reset/confirm/", async (req) => {
    const body = bodyObject(req.body);
    const row = repos().resetTokens.find((t) => t.token === str(body.token) && !t.used);
    if (!row) throw badRequest("Reset link is invalid or has expired.");
    const problems = passwordProblems(str(body.new_password));
    if (problems.length) throw badRequest({ new_password: problems });
    repos().users.update(row.user, { password_hash: await sha256(str(body.new_password)) });
    repos().resetTokens.update(row.id, { used: true });
    return { detail: "Password has been reset." };
  }, { public: true });

  router.get("/auth/login-audit/", (req) => {
    const all = [...repos().loginAttempts.all()].reverse();
    const visible = req.user!.role === "owner" ? all : all.filter((a) => a.email === req.user!.email);
    return visible.slice(0, 50).map((a) => ({ email: a.email, ip_address: a.ip_address, user_agent: a.user_agent, successful: a.successful, attempted_at: a.attempted_at }));
  });

  // ── team & roles (permission: users.manage) ──
  router.get("/auth/users/", () => repos().users.all().map(serializeUser));

  router.patch("/auth/users/:id/", (req) => {
    const target = repos().users.get(idParam(req.params.id));
    if (!target) throw notFound("User not found.");
    const role = str(bodyObject(req.body).role) as Role;
    if (!ROLES.includes(role)) throw fieldError("role", `"${role}" is not a valid choice.`);
    if (target.id === req.user!.id) throw forbidden("You cannot change your own role.");
    if (target.role === "owner" && role !== "owner" && repos().users.filter((u) => u.role === "owner").length === 1) {
      throw badRequest("There must always be at least one owner.");
    }
    const before = { role: target.role };
    const updated = repos().users.update(target.id, { role });
    logChange(req, "user", target.id, target.email, before, { role });
    logEvent(req, { action: "role_change", summary: `Changed ${target.email} from ${ROLE_DISPLAY[before.role]} to ${ROLE_DISPLAY[role]}`, objectType: "user", objectId: target.id, objectLabel: target.email });
    return serializeUser(updated);
  });

  router.get("/auth/activity/", (req) => {
    const q = req.query;
    const before = Number(q.get("before") ?? 0);
    const actor = q.get("actor") ?? "";
    const source = q.get("source") ?? "";
    const text = (q.get("q") ?? "").toLowerCase();
    const from = q.get("date_from") ?? "";
    const to = q.get("date_to") ?? "";
    const financial = q.get("financial") === "1";
    let rows = [...repos().audit.all()].sort((a, b) => b.id - a.id);
    if (before) rows = rows.filter((r) => r.id < before);
    if (actor === "system") rows = rows.filter((r) => r.actor === null);
    else if (actor) rows = rows.filter((r) => r.actor === Number(actor));
    if (source) rows = rows.filter((r) => r.source === source);
    if (financial) rows = rows.filter((r) => r.is_financial);
    if (from) rows = rows.filter((r) => r.created_at.slice(0, 10) >= from);
    if (to) rows = rows.filter((r) => r.created_at.slice(0, 10) <= to);
    if (text) {
      rows = rows.filter((r) => `${r.summary} ${r.object_label} ${r.action}`.toLowerCase().includes(text));
    }
    const PAGE = 50;
    const page = rows.slice(0, PAGE);
    const people = before ? undefined : repos().users.all().map((u) => ({
      id: u.id, label: `${u.first_name} ${u.last_name}`.trim(), role: ROLE_DISPLAY[u.role],
    }));
    return {
      results: page.map(serializeAudit),
      next_before: rows.length > PAGE ? page[page.length - 1].id : null,
      ...(people ? { people } : {}),
    };
  });
}
