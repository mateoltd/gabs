import { defineConfig } from "@playwright/test";
// Native acceptance must not take over the user's desktop.
process.env.SUITE_DESKTOP_TEST_MINIMIZED = "1";
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
