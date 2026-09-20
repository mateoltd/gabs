import { test, expect, request } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  archiveLifecycle,
  holdArchiveAuthority,
} from "../support/corporate-portability/archive-lifecycle";
import { corporatePortability } from "../support/corporate-portability/journey";
import { browserPortabilityDevice } from "../support/corporate-portability/devices";

test("expired and interrupted archive admission preserves recoverable work", async ({
  browser,
}) => {
  test.setTimeout(240000);
  const directory = await mkdtemp(
    resolve(tmpdir(), "suite-archive-lifecycle-"),
  );
  const api = await request.newContext({ baseURL: "http://localhost:4310" });
  let device: Awaited<ReturnType<typeof browserPortabilityDevice>> | undefined;
  try {
    expect(
      (
        await api.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    device = await browserPortabilityDevice(browser);
    device.page.setDefaultTimeout(15000);
    await corporatePortability({
      archive: true,
      evidenceName: "web-to-web",
      archiveReviewCheck: (context) =>
        archiveLifecycle(context, {
          surface: "web-lifecycle",
          hold: () => holdArchiveAuthority(device!.page),
          restart: () => device!.restart(),
        }),
      source: device.page,
      api,
      directory,
      offline: (value) => device!.offline(value),
      exportFile: (button, path) => device!.exportFile(button, path),
      replaceDevice: async () => {
        await device!.close();
        device = await browserPortabilityDevice(browser);
        device.page.setDefaultTimeout(15000);
        await device.page.clock.install();
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
