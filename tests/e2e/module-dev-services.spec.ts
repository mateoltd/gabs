import { test, expect } from "@playwright/test";
import { cp, mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { startModuleDev } from "../../tooling/module-dev/server";
import AxeBuilder from "@axe-core/playwright";
test.use({ actionTimeout: 10000 });

test("preview executes independent providers, revokes grants and reloads typed provider fixtures", async ({
  page,
}) => {
  test.setTimeout(120000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/service-preview-"));
  await cp("tests/fixtures/service-preview", directory, { recursive: true });
  const catalog = await readFile(
    "packages/module-catalog/src/index.ts",
    "utf8",
  );
  const server = await startModuleDev(directory, 0, [
    resolve(directory, "provider"),
  ]);
  const view = page.getByRole("region", { name: "Custom notes workspace" });
  try {
    await page.goto(server.origin);
    await expect(view.getByLabel("Note name")).toBeVisible({ timeout: 45000 });
    await expect(page.locator("#providers")).toContainText(
      "Initial provider fixture",
    );
    await view.getByLabel("Note name").fill("Shared transaction");
    await view.getByRole("button", { name: "Save note" }).click();
    await expect(view.getByRole("list", { name: "Saved notes" })).toContainText(
      "Verified Shared transaction",
    );
    await expect(page.locator("#providers")).toContainText(
      "Shared transaction",
    );
    await expect(page.locator("#audits")).toContainText(
      "preview-provider.recorded",
    );
    await page
      .getByText("Module grants and provider permissions", { exact: true })
      .click();
    const grant = page.getByLabel(
      "service-notes: record (preview-provider.record)",
      { exact: true },
    );
    await grant.uncheck();
    await view.getByLabel("Note name").fill("Denied by grant");
    await view.getByRole("button", { name: "Save note" }).click();
    await expect(view).toContainText("Grant service-notes access");
    await expect(page.locator("#providers")).not.toContainText(
      "Denied by grant",
    );
    await grant.check();
    await page.getByLabel("preview-provider.write", { exact: true }).uncheck();
    await view.getByRole("button", { name: "Save note" }).click();
    await expect(view).toContainText(
      "Missing permission: preview-provider.write",
    );
    await page.getByLabel("preview-provider.write", { exact: true }).check();
    await view.getByLabel("Note name").fill("Allowed again");
    await view.getByRole("button", { name: "Save note" }).click();
    await expect(view.getByRole("list", { name: "Saved notes" })).toContainText(
      "Verified Allowed again",
    );
    const fixture = resolve(directory, "provider/module.simulation.ts");
    await writeFile(
      fixture,
      (await readFile(fixture, "utf8"))
        .replace("Verified ", "Reloaded ")
        .replace("Initial provider fixture", "Changed provider fixture"),
    );
    await expect(page.locator("#providers")).toContainText(
      "Changed provider fixture",
      { timeout: 45000 },
    );
    await view.getByLabel("Note name").fill("New fixture");
    await view.getByRole("button", { name: "Save note" }).click();
    await expect(view.getByRole("list", { name: "Saved notes" })).toContainText(
      "Reloaded New fixture",
    );
    await expect(page.locator("#providers")).not.toContainText("Allowed again");
    await page
      .getByText("Module grants and provider permissions", { exact: true })
      .click();
    await expect(view.locator(".page-heading p")).toHaveCSS("opacity", "1");
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/module-services-preview", {
      recursive: true,
    });
    await page.screenshot({
      path: "docs/verification/module-services-preview/wide.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/module-services-preview/narrow.png",
      fullPage: true,
    });
    expect(await readFile("packages/module-catalog/src/index.ts", "utf8")).toBe(
      catalog,
    );
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
