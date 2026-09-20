import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { archivePublication } from "../support/corporate-portability/archive-publication";
import { corporatePortability } from "../support/corporate-portability/journey";
import { nativePortabilityDevice } from "../support/corporate-portability/devices";

for (const phase of ["writing", "prepared", "published"] as const)
  test(`native archive publication survives main-process death while ${phase}`, async () => {
    test.setTimeout(240000);
    const directory = await mkdtemp(
      resolve(tmpdir(), "suite-archive-publication-"),
    );
    const source = resolve(directory, "source");
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let device: Awaited<ReturnType<typeof nativePortabilityDevice>> | undefined;
    try {
      expect(
        (
          await api.post("/auth/development", {
            headers: { origin: "http://localhost:4300" },
            data: { email: "owner@demo.local" },
          })
        ).ok(),
      ).toBe(true);
      device = await nativePortabilityDevice(source);
      device.page.setDefaultTimeout(15000);
      await corporatePortability({
        archive: true,
        archiveExportCheck: (context) =>
          archivePublication(context, {
            phase,
            device: device!,
            restart: async () => {
              await device!.close();
              device = await nativePortabilityDevice(source, {
                reuse: true,
                // Open personal first, then inspect corporate work offline before any automatic sync.
                beforeSignIn: async (_, page) => {
                  await page.evaluate(() =>
                    localStorage.removeItem("suite-workspace"),
                  );
                  await page.reload();
                },
              });
              device.page.setDefaultTimeout(15000);
              return device;
            },
          }),
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
