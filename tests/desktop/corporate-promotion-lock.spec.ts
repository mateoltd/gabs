import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporatePortability } from "../support/corporate-portability/journey";
import { nativePortabilityDevice } from "../support/corporate-portability/devices";
import { storageReplyWorker } from "../support/corporate-portability/storage-reply";
import { promotionLock } from "../support/corporate-portability/promotion-lock";

for (const release of ["locked", "unlocked"] as const)
  test(`committed restoration acknowledgement after profile lock while ${release}`, async () => {
    test.setTimeout(240000);
    const directory = await mkdtemp(resolve(tmpdir(), "suite-promotion-lock-"));
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let device: Awaited<ReturnType<typeof nativePortabilityDevice>> | undefined;
    try {
      const worker = await storageReplyWorker(directory);
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
      await corporatePortability({
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
            { storageWorker: worker.entry },
          );
          device.page.setDefaultTimeout(15000);
          return device.page;
        },
        confirmRestoration: async (context) => {
          if (context.input.selection !== "request") {
            await context.page
              .getByRole("button", { name: "Confirm restoration", exact: true })
              .click();
            return context.page;
          }
          return promotionLock(context, { release, worker, device: device! });
        },
      });
      await device.page
        .getByRole("link", { name: "Projects", exact: true })
        .click();
      await device.page
        .getByRole("button", { name: "Resume saved draft", exact: true })
        .click();
      await expect(device.page.getByLabel("Name", { exact: true })).toHaveValue(
        "Preserved across profile lock",
      );
    } finally {
      try {
        await device?.close();
      } finally {
        await api.dispose();
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
