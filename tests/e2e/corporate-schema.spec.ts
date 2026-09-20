import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporateSchemaRecovery } from "../support/corporate-portability/schema";
import {
  browserPortabilityDevice,
  nativePortabilityDevice,
  type PortabilityDevice,
} from "../support/corporate-portability/devices";

for (const surface of ["web", "desktop"] as const)
  test(`${surface} recovers exported drafts across retired resources and changed fields`, async ({
    browser,
  }) => {
    test.setTimeout(240000);
    const directory = await mkdtemp(
      resolve(tmpdir(), "suite-schema-recovery-"),
    );
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let device: PortabilityDevice | undefined;
    let destination = 0;
    const launch = (name: string) =>
      surface === "web"
        ? browserPortabilityDevice(browser)
        : nativePortabilityDevice(resolve(directory, name));
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
      await corporateSchemaRecovery({
        source: device.page,
        api,
        directory,
        surface,
        offline: (value) => device!.offline(value),
        exportFile: (button, path) => device!.exportFile(button, path),
        replaceDevice: async () => {
          await device!.close();
          device = await launch(`destination-${++destination}`);
          device.page.setDefaultTimeout(15000);
          return device.page;
        },
      });
    } finally {
      try {
        await device?.close();
      } finally {
        await api.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
