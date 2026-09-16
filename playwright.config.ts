import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  use: { baseURL: "http://localhost:4300", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: "pnpm dev:api",
      url: "http://localhost:4310/health",
      reuseExistingServer: true,
    },
    {
      command:
        "pnpm --filter @suite/web build && pnpm --filter @suite/web preview",
      url: "http://localhost:4300",
      reuseExistingServer: true,
    },
  ],
});
