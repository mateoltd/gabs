import "dotenv/config";
import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporateCollisionPortability } from "../support/corporate-portability/collisions";
import {
  nativePortabilityDevice,
  type PortabilityDevice,
} from "../support/corporate-portability/devices";

for (const choice of ["original", "reassigned"] as const)
  test(`imports an actual collision draft with a fresh ${choice} choice`, async () => {
    test.setTimeout(240000);
    const directory = await mkdtemp(resolve(tmpdir(), "suite-command-import-"));
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let device: PortabilityDevice | undefined;
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
      await corporateCollisionPortability({
        source: device.page,
        api,
        choice,
        directory,
        evidenceName: "native",
        offline: (value) => device!.offline(value),
        exportFile: (button, path) => device!.exportFile(button, path),
        replaceDevice: async () => {
          await device!.close();
          device = await launch("destination");
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
