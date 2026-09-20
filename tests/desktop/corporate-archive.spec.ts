import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporatePortability } from "../support/corporate-portability/journey";
import {
  nativePortabilityDevice,
  type PortabilityDevice,
} from "../support/corporate-portability/devices";

for (const [kind, journey] of [
  ["encrypted archive", corporatePortability],
] as const) {
  test(`actual offline native ${kind} exports restore with a new device key and empty protected store`, async () => {
    test.setTimeout(240000);
    const directory = await mkdtemp(
      resolve(tmpdir(), "suite-native-portability-"),
    );
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
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
      device = await nativePortabilityDevice(resolve(directory, "source"));
      device.page.setDefaultTimeout(15000);
      await journey({
        archive: true,
        source: device.page,
        api,
        directory,
        offline: (value) => device!.offline(value),
        exportFile: (button, path) => device!.exportFile(button, path),
        replaceDevice: async () => {
          await device!.close();
          device = await nativePortabilityDevice(
            resolve(directory, "destination"),
          );
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
}
