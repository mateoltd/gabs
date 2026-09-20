import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { archiveCapacity } from "../support/corporate-portability/archive-capacity";
import { Pool } from "pg";
import {
  browserPortabilityDevice,
  type PortabilityDevice,
} from "../support/corporate-portability/devices";

test(`large archives recover in explicit count and byte bounded batches`, async ({
  browser,
}) => {
  test.setTimeout(600000);
  const directory = await mkdtemp(resolve(tmpdir(), "suite-archive-capacity-"));
  const api = await request.newContext({
    baseURL: "http://localhost:4310",
  });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let device: PortabilityDevice | undefined;
  try {
    expect(
      (
        await api.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    device = await browserPortabilityDevice(browser);
    device.page.setDefaultTimeout(15000);
    await archiveCapacity({
      page: device.page,
      api,
      pool,
      directory,
      surface: "web",
      offline: (value) => device!.offline(value),
      exportFile: (button, path) => device!.exportFile(button, path),
      replaceDevice: async () => {
        await device!.close();
        device = await browserPortabilityDevice(browser);
        device.page.setDefaultTimeout(15000);
        return device.page;
      },
    });
  } finally {
    try {
      await device?.close();
    } finally {
      await api.dispose();
      await pool.end();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
