/**
 * Data-provider configuration — the one switch between the in-browser demo
 * backend and a real HTTP API.
 *
 *   VITE_DATA_PROVIDER=local   (default) every request is answered inside the
 *                              browser by src/data/local, persisted to IndexedDB.
 *   VITE_DATA_PROVIDER=http    requests go to VITE_API_BASE_URL over the network.
 *
 * Nothing else in the app knows which one is active: pages and hooks talk to
 * the shared axios client in src/lib/api.ts, which picks its transport here.
 */
export type DataProvider = "local" | "http";

const env = import.meta.env;

/** Exactly "http" selects the real API; anything else (or unset) is the demo. */
function readProvider(): DataProvider {
  return env.VITE_DATA_PROVIDER === "http" ? "http" : "local";
}

export const dataConfig = {
  provider: readProvider(),
  /** Base URL of the real API. Only read when provider is "http". */
  apiBaseUrl: (env.VITE_API_BASE_URL as string | undefined) ?? "",
  /** Simulated network latency for the local provider, in ms (0 disables). */
  localLatencyMs: Number(env.VITE_LOCAL_LATENCY_MS ?? 250),
  /** Fraction (0–1) of local GET requests that fail, to exercise error states. */
  localFailureRate: Number(env.VITE_LOCAL_FAILURE_RATE ?? 0),
};

export const isLocalProvider = dataConfig.provider === "local";
