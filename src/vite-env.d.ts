/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "local" (default): in-browser demo data. "http": the real API at VITE_API_BASE_URL. */
  readonly VITE_DATA_PROVIDER?: "local" | "http";
  readonly VITE_API_BASE_URL?: string;
  /** Simulated latency for the local provider, in ms. */
  readonly VITE_LOCAL_LATENCY_MS?: string;
  /** Fraction (0–1) of local GET requests that fail, to exercise error states. */
  readonly VITE_LOCAL_FAILURE_RATE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
