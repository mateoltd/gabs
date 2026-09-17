import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startModuleDev } from "../../tooling/modules/module-dev/server";

test("independent preview simulates typed host outcomes, revocation and offline failure without device effects", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/host-preview-"));
  const id = `host-preview-${randomUUID().slice(0, 8)}`;
  for (const name of ["module.ts", "module-server.ts", "view.tsx"])
    await writeFile(
      resolve(directory, name),
      (
        await readFile(`tests/fixtures/host-capabilities/${name}`, "utf8")
      ).replaceAll("custom-notes", id),
    );
  const server = await startModuleDev(directory, 0);
  const area = page.getByRole("region", {
    name: "Module host actions",
    exact: true,
  });
  const downloads: string[] = [];
  page.on("download", (file) => downloads.push(file.suggestedFilename()));
  const ready = async () => {
    await expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 60000 },
    );
    await expect(
      area.getByRole("button", { name: "Export notes", exact: true }),
    ).toBeVisible();
  };
  const applyResult = async (alias: string, result: unknown) => {
    await page
      .getByLabel("Host capability", { exact: true })
      .selectOption(alias);
    await page
      .getByLabel("Simulated result (JSON)", { exact: true })
      .fill(JSON.stringify(result));
    await page
      .getByRole("button", { name: "Apply simulated result", exact: true })
      .click();
    await expect(page.locator("#host-feedback")).toHaveText(
      "Simulated result updated. No device action was performed.",
    );
  };
  try {
    await page.goto(server.origin);
    await ready();
    await expect(page.getByLabel("Contract", { exact: true })).toBeHidden();
    await expect(page.locator("#policy")).toHaveText(
      "No resource or operation contracts declared.",
    );
    await expect(page.locator("#records")).toHaveText("No resources declared.");
    await expect(page.locator("#host-controls")).toContainText(
      "This preview does not download files",
    );
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Download offered");
    await expect(page.locator("#host-actions")).toContainText("simulated");
    expect(downloads).toEqual([]);
    await applyResult("export", { status: "cancelled" });
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Export cancelled");
    await page
      .getByLabel("Simulated result (JSON)", { exact: true })
      .fill('{"status":"invented"}');
    await page
      .getByRole("button", { name: "Apply simulated result", exact: true })
      .click();
    await expect(page.locator("#host-feedback")).not.toHaveText(
      "Simulated result updated. No device action was performed.",
    );
    const current = await (await request.get(`${server.origin}/state`)).json();
    expect(current.hostResults.export).toEqual({ status: "cancelled" });
    await page.getByText("Permission simulator", { exact: true }).click();
    await page.getByLabel(`${id}.export`, { exact: true }).uncheck();
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      `Missing permission: ${id}.export`,
    );
    await expect(
      page.locator("#host-actions").getByRole("row").last(),
    ).toContainText(`Missing permission: ${id}.export`);
    await page.getByLabel(`${id}.export`, { exact: true }).check();
    await page.getByLabel("Server online", { exact: true }).uncheck();
    await area
      .getByRole("button", { name: "Export notes", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      "Reconnect before using this host action",
    );
    await expect(
      page.locator("#host-actions").getByRole("row").last(),
    ).toContainText("rejected");
    expect(
      (await (await request.get(`${server.origin}/state`)).json()).journal,
    ).toEqual([]);
    await page.getByLabel("Server online", { exact: true }).check();
    await applyResult("peers", {
      enabled: true,
      configured: true,
      peers: [{ id: "test-peer", address: "127.0.0.1", port: 49180, seen: 1 }],
    });
    await area
      .getByRole("button", { name: "Inspect local network", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("1 network peers");
    const before = await (await request.get(`${server.origin}/state`)).json();
    const unknown = await request.post(`${server.origin}/action`, {
      headers: { "x-module-dev-revision": before.revision },
      data: {
        action: "host",
        call: {
          moduleId: id,
          moduleVersion: "1.0.0",
          capability: "undeclared",
          input: {},
        },
      },
    });
    expect(unknown.status()).toBe(400);
    expect((await unknown.json()).code).toBe("CAPABILITY_UNDECLARED");
    await writeFile(
      resolve(directory, "module.simulation.ts"),
      `import { defineSimulationModule } from "@suite/module-sdk/simulator";\nimport module from "./module";\nexport default defineSimulationModule(module, { hostResults: { notify: { requested: true } } });\n`,
    );
    await expect
      .poll(
        async () =>
          (await (await request.get(`${server.origin}/state`)).json()).revision,
      )
      .not.toBe(before.revision);
    await expect
      .poll(
        async () =>
          (await (await request.get(`${server.origin}/state`)).json())
            .hostResults?.notify,
        { timeout: 60000 },
      )
      .toEqual({ requested: true });
    const rebuilt = await (await request.get(`${server.origin}/state`)).json();
    await expect(page.locator("#workspace")).toHaveAttribute(
      "data-revision",
      rebuilt.revision,
    );
    await ready();
    await area
      .getByRole("button", { name: "Show notification", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Notification requested");
    const after = await (await request.get(`${server.origin}/state`)).json();
    expect(after.hostActions).toHaveLength(1);
    expect(after.audits).toEqual([]);
    expect(after.events).toEqual([]);
    expect(downloads).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await mkdir("docs/verification/host-simulator", { recursive: true });
    await page.screenshot({
      path: "docs/verification/host-simulator/wide.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/host-simulator/narrow.png",
      fullPage: true,
    });
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
