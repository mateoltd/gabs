import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/desktop",
  workers: 1,
  timeout: 45000,
  use: { trace: "retain-on-failure" },
  outputDir: "test-results/desktop",
  webServer: {
    command: "pnpm dev:api",
    url: "http://localhost:4310/health",
    reuseExistingServer: true,
  },
});
