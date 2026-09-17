import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startModuleDev } from "../../tooling/modules/module-dev/server";

test("standalone development previews simulate consent, interruption and reviewed device retry without effects", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/local-device-preview-"));
  const source = JSON.stringify(
    resolve("tests/fixtures/local-device-requests"),
  );
  await writeFile(
    resolve(directory, "module.ts"),
    `export { module as default } from ${source};`,
  );
  await writeFile(
    resolve(directory, "module-local.ts"),
    `export { default } from ${source};`,
  );
  const fixtures = (
    allow: boolean,
  ) => `import { defineSimulationModule } from '@suite/module-sdk/simulator';
import module from './module';
export default defineSimulationModule(module, { personal: true, deviceAccess: ${allow ? '["export"]' : "[]"}, hostResults: { export: { status: 'cancelled' } } });`;
  await writeFile(resolve(directory, "module.simulation.ts"), fixtures(false));
  const server = await startModuleDev(directory, 0);
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  const state = async () =>
    (await request.get(`${server.origin}/state`)).json();
  const ready = async () =>
    expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 60000 },
    );
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  try {
    await page.goto(server.origin);
    await ready();
    await expect(
      page.getByRole("heading", {
        name: "Standalone device simulation",
        exact: true,
      }),
    ).toBeVisible();
    await expect(button("Simulate device result")).toBeDisabled();
    await page.getByLabel("Server online", { exact: true }).uncheck();
    await page
      .getByLabel("Contract", { exact: true })
      .selectOption("operation:capture");
    await page
      .locator('#fields [name="text"]')
      .fill("Standalone preview capture");
    await button("Submit").click();
    await expect(page.locator("#feedback")).toContainText(
      "Allow this device capability",
    );
    expect((await state()).records.notes).toEqual([]);
    const consent = page.getByLabel(
      "Allow Device notes: export (files.export)",
      { exact: true },
    );
    await consent.check();
    await expect(consent).toBeEnabled();
    await button("Submit").click();
    await expect(page.locator("#feedback")).toHaveText(
      "Saved in the standalone simulation. Device requests are simulated separately.",
    );
    expect((await state()).local.deviceRequests).toHaveLength(1);
    await button("Simulate interrupted result").click();
    await expect(page.locator("#local-feedback")).toContainText(
      "Lock and unlock",
    );
    await expect(button("Clear simulated request")).toBeDisabled();
    await button("Lock simulated profile").click();
    await expect(consent).toBeDisabled();
    await button("Unlock and recover simulated profile").click();
    await expect(page.locator("#local-requests")).toContainText("uncertain");
    await expect(button("Create simulated retry")).toBeDisabled();
    const review = page.getByLabel(
      "I reviewed the uncertain simulated outcome before retrying.",
      { exact: true },
    );
    await review.focus();
    await review.press("Space");
    await button("Create simulated retry").click();
    await expect(button("Simulate device result")).toBeEnabled();
    await button("Simulate device result").click();
    await expect(page.locator("#local-requests")).toContainText(
      '"status":"cancelled"',
    );
    let current = await state();
    expect(current.records.notes).toHaveLength(1);
    expect(
      current.local.deviceRequests.map((r: { state: string }) => r.state),
    ).toEqual(["uncertain", "completed"]);
    expect(current.journal).toEqual([]);
    expect(downloads).toEqual([]);
    const previous = current.revision;
    await writeFile(resolve(directory, "module.simulation.ts"), fixtures(true));
    await expect.poll(async () => (await state()).revision).not.toBe(previous);
    await expect
      .poll(async () => (await state()).status, { timeout: 60000 })
      .toBe("ready");
    const rebuilt = await state();
    await expect(page.locator("#workspace")).toHaveAttribute(
      "data-revision",
      rebuilt.revision,
    );
    await ready();
    await expect(consent).toBeChecked();
    await expect(button("Simulate device result")).toBeDisabled();
    current = await state();
    expect(current.local.deviceRequests).toEqual([]);
    expect(current.records.notes).toEqual([]);
    // A new source generation must reject old-generation actions rather than reuse prior consent.
    const stale = await request.post(`${server.origin}/action`, {
      headers: { "x-module-dev-revision": previous },
      data: { action: "localProfile", locked: true },
    });
    expect(stale.status()).toBe(409);
    await page
      .getByLabel("Contract", { exact: true })
      .selectOption("operation:capture");
    await page.locator('#fields [name="text"]').fill("After fixture reload");
    await button("Submit").click();
    await expect(button("Simulate device result")).toBeEnabled();
    await button("Simulate device result").click();
    await expect(page.locator("#local-requests")).toContainText(
      '"status":"cancelled"',
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir("docs/verification/local-device-simulator", {
      recursive: true,
    });
    await page.locator("#local-controls").screenshot({
      path: "docs/verification/local-device-simulator/wide.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.locator("#local-controls").screenshot({
      path: "docs/verification/local-device-simulator/narrow.png",
    });
    expect(downloads).toEqual([]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
