import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { corporatePortability } from "../support/corporate-portability/journey";
import { nativePortabilityDevice } from "../support/corporate-portability/devices";
import { promotionCrash } from "../support/corporate-portability/promotion-crash";
import { crashSettlementReply } from "../support/corporate-portability/settlement-crash";

test("restoration retries the original decision after main dies with its server reply held", async () => {
  test.setTimeout(240000);
  const directory = await mkdtemp(resolve(tmpdir(), "suite-settlement-crash-"));
  const destination = resolve(directory, "destination");
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
        device = await nativePortabilityDevice(destination);
        return device.page;
      },
      confirmRestoration: async (context) => {
        if (context.input.selection !== "request") {
          await context.page
            .getByRole("button", { name: "Confirm restoration", exact: true })
            .click();
          return context.page;
        }
        return promotionCrash(context, {
          committed: false,
          evidenceName: "native-promotion-settlement-reply-lost",
          interrupt: () => crashSettlementReply(context, device!),
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
    await expect(device.page.getByLabel("Name", { exact: true })).toHaveValue(
      "Unrelated destination draft",
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
