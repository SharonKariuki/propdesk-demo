import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config. Two builds are served:
 *
 *  - 4173 — VITE_DATA_PROVIDER=http. The original specs intercept every /api
 *    call in-test (see e2e/helpers.ts), exactly as they did against the real
 *    backend, so they exercise the HTTP path.
 *  - 4176 — VITE_DATA_PROVIDER=local. *.local.spec.ts drive the in-browser
 *    data provider end to end, with no mocking.
 *
 * Projects:
 *  - chromium : desktop journey (1280×800), HTTP build
 *  - mobile   : 375px viewport for the responsive pass, HTTP build
 *  - local    : CRUD against the local provider
 */
const HTTP_PORT = 4173;
const LOCAL_PORT = 4176;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /\.local\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${HTTP_PORT}` },
    },
    {
      name: "mobile",
      testIgnore: /\.local\.spec\.ts$/,
      use: { ...devices["Pixel 7"], viewport: { width: 375, height: 812 }, baseURL: `http://localhost:${HTTP_PORT}` },
    },
    {
      name: "local",
      testMatch: /\.local\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"], baseURL: `http://localhost:${LOCAL_PORT}` },
    },
  ],
  webServer: [
    {
      command: `npx vite build --outDir dist-e2e-http && npx vite preview --outDir dist-e2e-http --port ${HTTP_PORT} --strictPort`,
      url: `http://localhost:${HTTP_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // The URL is never reached: every request is intercepted in the test.
      env: { VITE_DATA_PROVIDER: "http", VITE_API_BASE_URL: "http://localhost:8000/api" },
    },
    {
      command: `npx vite build --outDir dist-e2e-local && npx vite preview --outDir dist-e2e-local --port ${LOCAL_PORT} --strictPort`,
      url: `http://localhost:${LOCAL_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: { VITE_DATA_PROVIDER: "local", VITE_LOCAL_LATENCY_MS: "0" },
    },
  ],
});
