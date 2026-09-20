import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporatePortability } from "../support/corporate-portability/journey";
import {
  browserPortabilityDevice,
  nativePortabilityDevice,
} from "../support/corporate-portability/devices";
import { promotionRevocation } from "../support/corporate-portability/promotion-revocation";

for (const surface of ["web", "desktop"] as const)
  test(`${surface} restoration retains input when an administrator revokes access during settlement`, async ({
    browser,
  }) => {
    test.setTimeout(240000);
    const directory = await mkdtemp(
      resolve(tmpdir(), "suite-promotion-revocation-"),
    );
    const api = await request.newContext({ baseURL: "http://localhost:4310" });
    let device:
      | Awaited<
          ReturnType<
            typeof browserPortabilityDevice | typeof nativePortabilityDevice
          >
        >
      | undefined;
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
      await corporatePortability({
        archive: true,
        source: device.page,
        api,
        directory,
        offline: (value) => device!.offline(value),
        exportFile: (button, path) => device!.exportFile(button, path),
        replaceDevice: async () => {
          await device!.close();
          device = await launch("destination");
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
          return promotionRevocation(context, {
            api,
            surface,
            app: "app" in device! ? device.app : undefined,
          });
        },
      });
      await device.page
        .getByRole("link", { name: "Projects", exact: true })
        .click();
      await device.page
        .getByRole("button", { name: "Resume saved draft", exact: true })
        .click();
      await expect(device.page.getByLabel("Name", { exact: true })).toHaveValue(
        "Preserved during permission changes",
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
