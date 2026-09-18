import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startModuleDev } from "../../tooling/modules/module-dev/server";

test("corporate preview simulates leased exports, expiry, denial, renewal and source reset without effects", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/lease-preview-"));
  for (const name of ["module.ts", "module.simulation.ts", "view.tsx"])
    await writeFile(
      resolve(directory, name),
      await readFile(
        `tests/fixtures/corporate-lease-simulation/${name}`,
        "utf8",
      ),
    );
  const server = await startModuleDev(directory, 0);
  const area = page.getByRole("region", {
    name: "Module host actions",
    exact: true,
  });
  const downloads: string[] = [];
  page.on("download", (value) => downloads.push(value.suggestedFilename()));
  const state = async () =>
    (await request.get(`${server.origin}/state`)).json();
  const exportNotes = () =>
    area.getByRole("button", { name: "Export notes", exact: true }).click();
  try {
    await page.goto(server.origin);
    await expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 60000 },
    );
    await page
      .getByLabel("Host capability", { exact: true })
      .selectOption("export");
    await expect(page.locator("#lease-status")).toContainText(
      "export: valid. 1 minute remaining.",
    );
    await page.getByLabel("Server online", { exact: true }).uncheck();
    await expect(
      page.getByRole("button", { name: "Renew simulated lease", exact: true }),
    ).toBeDisabled();
    await exportNotes();
    await expect(area.getByRole("status")).toHaveText("Export cancelled");
    await expect(page.locator("#host-actions")).toContainText(
      "simulated (lease)",
    );
    await area
      .getByRole("button", { name: "Show notification", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      "Reconnect before using this host action",
    );
    await page
      .getByLabel("Advance simulated time (minutes)", { exact: true })
      .fill("1");
    await page
      .getByRole("button", { name: "Advance simulated time", exact: true })
      .click();
    await expect(page.locator("#lease-status")).toContainText(
      "export: expired",
    );
    await exportNotes();
    await expect(area.getByRole("alert")).toContainText("lease is expired");
    await page.getByLabel("Server online", { exact: true }).check();
    await page
      .getByRole("button", { name: "Renew simulated lease", exact: true })
      .click();
    await expect(page.locator("#lease-status")).toContainText("export: valid");
    await page.getByText("Permission simulator", { exact: true }).click();
    await page.getByLabel("leased-notes.export", { exact: true }).uncheck();
    await page
      .getByRole("button", { name: "Renew simulated lease", exact: true })
      .click();
    await expect(page.locator("#lease-feedback")).toContainText(
      "permissions do not allow",
    );
    await page.getByLabel("leased-notes.export", { exact: true }).check();
    await page.getByLabel("Server online", { exact: true }).uncheck();
    await exportNotes();
    await expect(area.getByRole("alert")).toContainText("lease is revoked");
    await page.getByLabel("Server online", { exact: true }).check();
    await page
      .getByRole("button", { name: "Renew simulated lease", exact: true })
      .click();
    await expect(page.locator("#lease-status")).toContainText("export: valid");
    await page
      .getByLabel("Lease duration (minutes)", { exact: true })
      .fill("-1");
    await page
      .getByRole("button", { name: "Revoke simulated lease", exact: true })
      .click();
    await expect(page.locator("#lease-status")).toContainText(
      "export: revoked",
    );
    const before = await state();
    const invalid = await request.post(`${server.origin}/action`, {
      headers: { "x-module-dev-revision": before.revision },
      data: {
        action: "hostLease",
        capability: "notify",
        task: "renew",
        remainingMs: 60000,
      },
    });
    expect(invalid.status()).toBe(400);
    expect((await invalid.json()).code).toBe("LEASE_UNDECLARED");
    await writeFile(
      resolve(directory, "module.simulation.ts"),
      `import { defineSimulationModule } from "@suite/module-sdk/simulator";\nimport module from "./module";\nexport default defineSimulationModule(module, { hostLeases: { export: { remainingMs: 120000 } } });\n`,
    );
    await expect
      .poll(async () => (await state()).revision, { timeout: 60000 })
      .not.toBe(before.revision);
    await expect(page.locator("#lease-status")).toContainText(
      "export: valid. 2 minutes remaining.",
      { timeout: 60000 },
    );
    const after = await state();
    expect(after.hostElapsedMs).toBe(0);
    expect(after.hostActions).toEqual([]);
    expect(after.journal).toEqual([]);
    expect(after.events).toEqual([]);
    expect(after.audits).toEqual([]);
    const stale = await request.post(`${server.origin}/action`, {
      headers: { "x-module-dev-revision": before.revision },
      data: { action: "hostLease", capability: "export", task: "revoke" },
    });
    expect(stale.status()).toBe(409);
    await page.getByLabel("Server online", { exact: true }).uncheck();
    await exportNotes();
    await expect(area.getByRole("status")).toHaveText("Download offered");
    expect(downloads).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir("docs/verification/corporate-lease-simulator", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/corporate-lease-simulator/wide.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Revoke simulated lease", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#lease-status")).toContainText(
      "export: revoked",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: "docs/verification/corporate-lease-simulator/narrow.png",
      fullPage: true,
    });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
