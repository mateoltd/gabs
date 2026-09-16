import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "platform.spec.ts",
  workers: 1,
  timeout: 45000,
  use: { baseURL: "http://localhost:4301", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command:
        "PORT=4311 APP_ORIGIN=http://localhost:4301 API_ORIGIN=http://localhost:4311 pnpm dev:api",
      url: "http://localhost:4311/health",
      reuseExistingServer: false,
    },
    {
      command:
        "API_PROXY=http://localhost:4311 pnpm --filter @suite/web build && API_PROXY=http://localhost:4311 pnpm --filter @suite/web exec vite preview --host 127.0.0.1 --port 4301",
      url: "http://localhost:4301",
      reuseExistingServer: false,
    },
  ],
});
