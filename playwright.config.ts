import { defineConfig, devices } from "@playwright/test";
import { generateKeyPairSync } from "node:crypto";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: "http://localhost:4300",
    trace: "retain-on-failure",
    headless: true,
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    {
      command: "pnpm dev:api",
      // A disposable key for the managed test API, never a production or persisted signing secret.
      env: {
        CAPABILITY_LEASE_PRIVATE_KEY: generateKeyPairSync("ed25519")
          .privateKey.export({ type: "pkcs8", format: "pem" })
          .toString(),
      },
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
