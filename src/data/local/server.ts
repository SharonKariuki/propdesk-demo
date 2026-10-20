/**
 * The in-browser backend: boots the database (seeding it on first run),
 * routes each request to its handler, and persists what changed.
 *
 * Requests are handled one at a time, like a single-worker server, so a
 * mutation and its write-through can never interleave with another request.
 * A handler that throws has its partial changes rolled back.
 */
import { dataConfig } from "../config";
import { setDatabase } from "./context";
import { LocalDatabase } from "./db";
import { hasPermission } from "@/lib/permissions";

import { ROUTE_ACCESS } from "./handlers/access";
import { registerAuth, serializeUser, userFromToken } from "./handlers/auth";
import { registerBuildings } from "./handlers/buildings";
import { registerCharges } from "./handlers/charges";
import { registerCredits } from "./handlers/credits";
import { registerNotifications } from "./handlers/notifications";
import { registerPayments } from "./handlers/payments";
import { registerReports } from "./handlers/reports";
import { registerTenants } from "./handlers/tenants";
import { HttpError, Respond, Router, type LocalRequest, type LocalResponse, type Method } from "./http";
import { generateSeed } from "./seed";
import { logEvent } from "./services/audit";
import { ensureBilling } from "./services/billing";
import { prepareFileUrls } from "./services/files";
import { defaultDriver, type StorageDriver } from "./storage";
import { currentKey, randomId } from "./util";

export interface IncomingRequest {
  method: string;
  /** Path relative to the API root, e.g. "/tenants/7/". May carry a query string. */
  url: string;
  params?: Record<string, unknown>;
  body?: unknown;
  authorization?: string;
}

const router = new Router();
registerAuth(router);
registerBuildings(router);
registerTenants(router);
registerPayments(router);
registerCharges(router);
registerCredits(router);
registerNotifications(router);
registerReports(router);

// Demo housekeeping: restore the synthetic dataset (permission: demo.reset).
router.post("/demo/reset/", async () => {
  await resetDemoData();
  return { detail: "Demo data restored." };
});

/** Routes that would be refused to everyone because no access rule names them. */
export function routesWithoutAccessRule() {
  return router.list().filter((r) => !r.public && !(`${r.method} ${r.path}` in ROUTE_ACCESS)).map((r) => `${r.method} ${r.path}`);
}

let db: LocalDatabase | null = null;
let booting: Promise<LocalDatabase> | null = null;
let billedFor = -1;
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("propdesk-demo") : null;

async function seedInto(target: LocalDatabase) {
  // Clear first: seeding stores sample files as it goes.
  await target.driver.clear();
  await generateSeed(target);
  await target.writeAll();
}

/** Boot (or return) the database. Tests can pass their own driver. */
export function bootDatabase(driver?: StorageDriver): Promise<LocalDatabase> {
  if (!booting) {
    booting = (async () => {
      const instance = new LocalDatabase(driver ?? (await defaultDriver()));
      setDatabase(instance);
      if (!(await instance.load())) await seedInto(instance);
      db = instance;
      await prepareFileUrls();
      return instance;
    })();
  }
  return booting;
}

/** Forget the booted database (tests). */
export function shutdown() {
  db = null;
  booting = null;
  billedFor = -1;
}

export async function resetDemoData() {
  const instance = await bootDatabase();
  await seedInto(instance);
  billedFor = -1;
  channel?.postMessage("reset");
}

// Another tab wrote to the same browser database: pick its changes up.
channel?.addEventListener("message", () => {
  void db?.load();
});

let queue: Promise<unknown> = Promise.resolve();
function serialised<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function toQuery(url: string, params?: Record<string, unknown>) {
  const [path, search = ""] = url.split("?");
  const query = new URLSearchParams(search);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) value.forEach((v) => query.append(key, String(v)));
    else query.set(key, String(value));
  }
  return { path: path.startsWith("/") ? path : `/${path}`, query };
}

/** Handle one request against the local database. Never throws. */
export async function handle(incoming: IncomingRequest): Promise<LocalResponse> {
  const method = incoming.method.toUpperCase() as Method;
  const { path, query } = toQuery(incoming.url, incoming.params);

  if (dataConfig.localLatencyMs > 0) {
    await sleep(dataConfig.localLatencyMs * (0.6 + Math.random() * 0.8));
  }

  return serialised(async () => {
    const instance = await bootDatabase();
    const match = router.match(method, path);
    if (!match) {
      if (router.hasPath(path)) return { status: 405, data: { detail: `Method "${method}" not allowed.` } };
      console.warn(`[local data] No local handler for ${method} ${path}`);
      return { status: 404, data: { detail: "Not found." } };
    }
    const user = userFromToken(incoming.authorization);
    if (!match.route.public && !user) {
      return { status: 401, data: { detail: "Authentication credentials were not provided.", code: "not_authenticated" } };
    }
    if (!match.route.public && user) {
      const access = ROUTE_ACCESS[`${method} ${match.route.path}`];
      const allowed = access === "any"
        || (access !== undefined && (Array.isArray(access) ? access : [access]).some((p) => hasPermission(serializeUser(user), p)));
      if (!allowed) {
        logEvent({ method, path, params: match.params, query, body: null, user, requestId: randomId("req_") }, {
          action: "denied", summary: `Refused ${method} ${match.route.path} — the ${user.role} role lacks the permission`,
          objectType: "permission", objectLabel: `${method} ${match.route.path}`,
        }, "denied");
        await instance.flush();
        return { status: 403, data: { detail: "You do not have permission to perform this action." } };
      }
    }
    if (method === "GET" && !path.startsWith("/auth/") && Math.random() < dataConfig.localFailureRate) {
      return { status: 503, data: { detail: "Simulated outage (VITE_LOCAL_FAILURE_RATE)." } };
    }
    // The monthly rent run, caught up whenever a new month has begun.
    if (billedFor !== currentKey()) {
      ensureBilling();
      await instance.flush();
      billedFor = currentKey();
    }
    const req: LocalRequest = { method, path, params: match.params, query, body: incoming.body, user, requestId: randomId("req_") };
    try {
      const result = await match.route.handler(req);
      await instance.flush();
      if (method !== "GET") channel?.postMessage("changed");
      if (result instanceof Respond) return { status: result.status, data: result.data, headers: result.headers };
      if (result && typeof result === "object" && "status" in result && "data" in result && (result as LocalResponse).data instanceof Blob) {
        return result as LocalResponse;
      }
      return { status: 200, data: result ?? null };
    } catch (err) {
      await instance.rollback();
      if (err instanceof HttpError) return { status: err.status, data: err.body };
      console.error(`[local data] ${method} ${path} failed`, err);
      return { status: 500, data: { detail: "The local data service hit an error. See the console for details." } };
    }
  });
}
