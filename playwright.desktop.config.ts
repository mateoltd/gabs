import { defineConfig } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
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
    env: {
      CAPABILITY_LEASE_PRIVATE_KEY: generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString(),
    },
    url: "http://localhost:4310/health",
    reuseExistingServer: true,
  },
});
