import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { archiveAdmission } from "../support/corporate-portability/archive-admission";
import { admissionWorker } from "../support/corporate-portability/archive-admission-worker";
import { corporatePortability } from "../support/corporate-portability/journey";
import { nativePortabilityDevice } from "../support/corporate-portability/devices";

for (const target of ["utility", "main"] as const)
  for (const phase of ["before", "committed"] as const)
    test(`archive admission survives ${target} death at ${phase} write boundary`, async () => {
      test.setTimeout(240000);
      const directory = await mkdtemp(
        resolve(tmpdir(), "suite-archive-admission-"),
      );
      const destination = resolve(directory, "destination");
      const api = await request.newContext({
        baseURL: "http://localhost:4310",
      });
      let device:
        Awaited<ReturnType<typeof nativePortabilityDevice>> | undefined;
      try {
        const crash = { target, phase };
        const worker = await admissionWorker(directory, crash);
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
          archiveReviewCheck: (context) =>
            archiveAdmission(context, {
              crash,
              worker,
              device: device!,
              restart: async () => {
                await device!.close();
                device = await nativePortabilityDevice(destination, {
                  reuse: true,
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
            device = await nativePortabilityDevice(destination, {
              storageWorker: worker.entry,
            });
            device.page.setDefaultTimeout(15000);
            return device.page;
          },
        });
        await device.page
          .getByRole("link", { name: "Projects", exact: true })
          .click();
        await device.page
          .getByRole("button", { name: "Resume saved draft", exact: true })
          .click();
        await expect(
          device.page.getByLabel("Name", { exact: true }),
        ).toHaveValue("Existing destination project draft");
      } finally {
        try {
          await device?.close();
        } finally {
          await api.dispose();
          await rm(directory, { recursive: true, force: true });
        }
      }
    });
