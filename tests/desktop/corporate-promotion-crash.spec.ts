import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporatePortability } from "../support/corporate-portability/journey";
import { nativePortabilityDevice } from "../support/corporate-portability/devices";
import { storageCrashWorker } from "../support/corporate-portability/storage-crash";
import { promotionCrash } from "../support/corporate-portability/promotion-crash";

for (const selection of ["request", "draft"] as const)
  for (const target of ["main", "utility"] as const)
    for (const phase of ["before", "committed"] as const)
      test(`${selection} restoration survives ${target} death ${phase} local commit`, async () => {
        test.setTimeout(240000);
        const directory = await mkdtemp(
          resolve(tmpdir(), "suite-promotion-crash-"),
        );
        const destination = resolve(directory, "destination");
        const api = await request.newContext({
          baseURL: "http://localhost:4310",
        });
        let device:
          Awaited<ReturnType<typeof nativePortabilityDevice>> | undefined;
        try {
          const crash = { target, phase },
            worker = await storageCrashWorker(directory, crash);
          expect(
            (
              await api.post("/auth/development", {
                headers: { origin: "http://localhost:4300" },
                data: { email: "owner@demo.local" },
              })
            ).ok(),
          ).toBe(true);
          device = await nativePortabilityDevice(resolve(directory, "source"));
          await corporatePortability({
            archive: true,
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
              return device.page;
            },
            confirmRestoration: async (context) => {
              if (context.input.selection !== selection) {
                await context.page
                  .getByRole("button", {
                    name: "Confirm restoration",
                    exact: true,
                  })
                  .click();
                return context.page;
              }
              return promotionCrash(context, {
                crash,
                worker,
                device: device!,
                restart: async () => {
                  await device!.close();
                  device = await nativePortabilityDevice(destination, {
                    reuse: true,
                  });
                  return device;
                },
              });
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
          ).toHaveValue("Unrelated destination draft");
        } finally {
          try {
            await device?.close();
          } finally {
            await api.dispose();
            await rm(directory, { recursive: true, force: true });
          }
        }
      });
