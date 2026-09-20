import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporatePortability } from "../support/corporate-portability/journey";
import {
  browserPortabilityDevice,
  nativePortabilityDevice,
  type PortabilityDevice,
} from "../support/corporate-portability/devices";

for (const [sourceSurface, destinationSurface] of [
  ["web", "web"],
  ["web", "desktop"],
  ["desktop", "web"],
] as const) {
  test(`actual offline ${sourceSurface} exports restore in a fresh ${destinationSurface} device with current authority`, async ({
    browser,
  }) => {
    test.setTimeout(120000);
    const directory = await mkdtemp(resolve(tmpdir(), "suite-cross-device-"));
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let device: PortabilityDevice | undefined;
    const launch = (surface: "web" | "desktop", role: string) =>
      surface === "web"
        ? browserPortabilityDevice(browser)
        : nativePortabilityDevice(resolve(directory, role));
    try {
      expect(
        (
          await api.post("/auth/development", {
            headers: { origin: "http://localhost:4300" },
            data: { email: "owner@demo.local" },
          })
        ).ok(),
      ).toBe(true);
      device = await launch(sourceSurface, "source");
      await corporatePortability({
        source: device.page,
        api,
        directory,
        offline: (value) => device!.offline(value),
        exportFile: (button, path) => device!.exportFile(button, path),
        replaceDevice: async () => {
          await device!.close();
          device = await launch(destinationSurface, "destination");
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
