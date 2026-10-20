/**
 * Request/response primitives for the local backend: a tiny router that maps
 * METHOD + path pattern to a handler, the request object handlers receive,
 * and the HttpError they throw to answer with a 4xx — shaped like Django REST
 * Framework's errors so `lib/apiError.ts` reads them unchanged.
 */
import type { UserRow } from "./schema";

export type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface LocalRequest {
  method: Method;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
  user: UserRow | null;
  /** Shared by every audit row this request writes. */
  requestId: string;
}

export interface LocalResponse {
  status: number;
  data: unknown;
  headers?: Record<string, string>;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(typeof body === "object" && body && "detail" in body ? String((body as { detail: unknown }).detail) : `HTTP ${status}`);
  }
}

export const badRequest = (body: string | Record<string, string[] | string>) =>
  new HttpError(400, typeof body === "string" ? { detail: body } : body);
export const notFound = (what = "Not found.") => new HttpError(404, { detail: what });
export const forbidden = (detail = "You do not have permission to perform this action.") =>
  new HttpError(403, { detail });

/** A field error in DRF's `{ field: ["message"] }` shape. */
export const fieldError = (field: string, message: string) => badRequest({ [field]: [message] });

export type Handler = (req: LocalRequest) => unknown | Promise<unknown>;

interface Route {
  method: Method;
  /** The pattern as registered, e.g. "/tenants/:id/" — the key for access rules. */
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  public: boolean;
}

export class Router {
  private routes: Route[] = [];

  /** Patterns use `:name` segments, e.g. `/tenants/:id/move-out/`. */
  on(method: Method, path: string, handler: Handler, opts: { public?: boolean } = {}) {
    const keys: string[] = [];
    const source = path
      .replace(/\/+$/, "")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/:(\w+)/g, (_, key: string) => {
        keys.push(key);
        return "([^/]+)";
      });
    this.routes.push({ method, path: path.endsWith("/") ? path : path + "/", pattern: new RegExp(`^${source}/?$`), keys, handler, public: !!opts.public });
    return this;
  }

  get(path: string, handler: Handler, opts?: { public?: boolean }) {
    return this.on("GET", path, handler, opts);
  }
  post(path: string, handler: Handler, opts?: { public?: boolean }) {
    return this.on("POST", path, handler, opts);
  }
  patch(path: string, handler: Handler) {
    return this.on("PATCH", path, handler);
  }
  put(path: string, handler: Handler) {
    return this.on("PUT", path, handler);
  }
  delete(path: string, handler: Handler) {
    return this.on("DELETE", path, handler);
  }

  match(method: Method, path: string) {
    const clean = path.replace(/\/+$/, "") || "/";
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(clean);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1]);
      });
      return { route, params };
    }
    return null;
  }

  list() {
    return this.routes.map((r) => ({ method: r.method, path: r.path, public: r.public }));
  }

  /** True when some other method answers this path — for 405 vs 404. */
  hasPath(path: string) {
    const clean = path.replace(/\/+$/, "") || "/";
    return this.routes.some((r) => r.pattern.test(clean));
  }
}

/** A file response (PDF, CSV, XLSX…) with the download name the UI reads. */
export function fileResponse(blob: Blob, filename: string): LocalResponse {
  return {
    status: 200,
    data: blob,
    headers: {
      "content-type": blob.type,
      "content-disposition": `attachment; filename="${filename}"`,
    },
  };
}

/** Marker so a handler can choose its status code (201, 204…). */
export class Respond {
  constructor(
    readonly status: number,
    readonly data: unknown,
    readonly headers?: Record<string, string>,
  ) {}
}
export const created = (data: unknown) => new Respond(201, data);
export const noContent = () => new Respond(204, null);
