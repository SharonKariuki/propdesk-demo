/**
 * Axios adapter that answers requests from the in-browser backend instead of
 * the network. Installed on the shared client in src/lib/api.ts when
 * VITE_DATA_PROVIDER=local; everything above it — interceptors, hooks, error
 * handling — runs exactly as it does against the real API.
 */
import {
  AxiosError, AxiosHeaders, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig,
} from "axios";

import { handle } from "./server";

function relativeUrl(config: InternalAxiosRequestConfig) {
  const url = config.url ?? "";
  if (/^https?:\/\//.test(url)) {
    // Absolute URL (e.g. the refresh call): keep only what follows the API root.
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/api(?=\/)/, "") + parsed.search;
  }
  return url;
}

function parseBody(data: unknown) {
  if (typeof data === "string") {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

export const localAdapter: AxiosAdapter = async (config) => {
  const headers = AxiosHeaders.from(config.headers as never);
  const result = await handle({
    method: config.method ?? "get",
    url: relativeUrl(config),
    params: config.params as Record<string, unknown> | undefined,
    body: parseBody(config.data),
    authorization: String(headers.get("Authorization") ?? ""),
  });

  let data: unknown = result.data;
  if (config.responseType === "blob" && !(data instanceof Blob)) {
    // Download helpers read an error body out of a Blob, as the browser gives it.
    data = new Blob([JSON.stringify(data ?? {})], { type: "application/json" });
  } else if (!(data instanceof Blob) && data !== null && data !== undefined) {
    // Round-trip through JSON so callers get wire-shaped copies, never live rows.
    data = JSON.parse(JSON.stringify(data));
  }

  const response: AxiosResponse = {
    data,
    status: result.status,
    statusText: String(result.status),
    headers: new AxiosHeaders(result.headers ?? {}),
    config,
    request: { local: true },
  };
  const valid = config.validateStatus ? config.validateStatus(result.status) : result.status >= 200 && result.status < 300;
  if (valid) return response;
  throw new AxiosError(
    `Request failed with status code ${result.status}`,
    result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
    config,
    response.request,
    response,
  );
};
