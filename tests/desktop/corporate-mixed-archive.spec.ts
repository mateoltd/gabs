import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporateReferenceHints } from "../support/corporate-portability/reference-hints";
import { Pool } from "pg";
import {
  nativePortabilityDevice,
  type PortabilityDevice,
} from "../support/corporate-portability/devices";

test(`exports mixed modules and retained command reviews into a third independent device`, async () => {
  test.setTimeout(240000);
  const directory = await mkdtemp(resolve(tmpdir(), "suite-command-import-"));
  const api = await request.newContext({
    baseURL: "http://localhost:4310",
  });
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let device: PortabilityDevice | undefined;
  let generation = 0;
  const launch = (role: string) =>
    nativePortabilityDevice(resolve(directory, role));
  try {
    expect(
      (
        await api.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    device = await launch("source");
    device.page.setDefaultTimeout(15000);
    await corporateReferenceHints({
      source: device.page,
      api,
      pool,
      target: "separate",
      snapshots: true,
      archive: true,
      directory,
      evidenceName: "native",
      offline: (value) => device!.offline(value),
      exportFile: (button, path) => device!.exportFile(button, path),
      replaceDevice: async () => {
        await device!.close();
        device = await launch(`destination-${++generation}`);
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
