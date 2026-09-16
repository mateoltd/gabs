import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { startModuleDev } from "../../tooling/module-dev/server";
test.use({ actionTimeout: 10000 });

test("independent React preview exercises real handlers, permissions, offline simulation and rebuild recovery", async ({
  page,
  request,
}) => {
  test.setTimeout(150000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/module-preview-"));
  const id = `preview-${randomUUID().slice(0, 8)}`;
  const catalog = await readFile(
    "packages/module-catalog/src/index.ts",
    "utf8",
  );
  for (const name of ["module.ts", "module-server.ts", "view.tsx", "view.css"])
    await writeFile(
      resolve(directory, name),
      (
        await readFile(`tests/fixtures/custom-notes/${name}`, "utf8")
      ).replaceAll("custom-notes", id),
    );
  await writeFile(
    resolve(directory, "fixtures.json"),
    JSON.stringify({ notes: [{ name: "Initial fixture" }] }),
  );
  const server = await startModuleDev(directory, 0);
  const source = await readFile(resolve(directory, "view.tsx"), "utf8");
  const region = page.getByRole("region", { name: "Custom notes workspace" });
  const ready = async () => {
    await expect(page.locator("#build-status")).toHaveText(
      "Ready. Each source or fixture change starts a fresh simulation.",
      { timeout: 45000 },
    );
    await expect(
      region.getByRole("button", { name: "Save note" }),
    ).toBeVisible();
  };
  try {
    await page.goto(server.origin);
    await ready();
    await expect(
      region.getByText("Initial fixture", { exact: true }),
    ).toBeVisible();
    await region.getByLabel("Note name").fill("Saved through React");
    await region.getByLabel("Note name").press("Enter");
    await expect(
      region.getByText("Saved through React", { exact: true }),
    ).toBeVisible();
    await expect(page.locator("#records")).toContainText("Saved through React");
    expect(
      await page
        .locator("body")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ).not.toBe("rgb(255, 0, 255)");
    expect(
      await region.evaluate((element) => Boolean(element.shadowRoot)),
    ).toBe(true);

    await page.getByText("Permission simulator", { exact: true }).click();
    await page.getByLabel(`${id}.capture`, { exact: true }).uncheck();
    await region.getByLabel("Note name").fill("Denied write");
    await region.getByRole("button", { name: "Save note" }).click();
    await expect(region).toContainText(`Missing permission: ${id}.capture`);
    await expect(page.locator("#records")).not.toContainText("Denied write");
    await page.getByLabel(`${id}.capture`, { exact: true }).check();
    await page.getByLabel(`${id}.notes.read`, { exact: true }).uncheck();
    await expect(region).not.toBeVisible();
    await expect(
      page.getByText("Your simulated permissions do not allow this view."),
    ).toBeVisible();
    await page.getByLabel(`${id}.notes.read`, { exact: true }).check();
    await expect(region).toBeVisible();

    await page.getByLabel("Server online", { exact: true }).uncheck();
    await expect(
      region.getByRole("button", { name: "Save note" }),
    ).toBeDisabled();
    await page
      .getByLabel("Contract", { exact: true })
      .selectOption("resource:notes");
    await page
      .locator("#fields")
      .getByLabel("name", { exact: true })
      .fill("Offline capture");
    await page.locator("#form").getByRole("button", { name: "Submit" }).click();
    await expect(page.locator("#feedback")).toContainText(
      "Pending server acceptance",
    );
    await expect(page.locator("#records")).not.toContainText("Offline capture");
    await page.getByLabel("Server online", { exact: true }).check();
    await page
      .getByRole("button", { name: "Synchronize pending work" })
      .click();
    await expect(page.locator("#journal")).toContainText("accepted");
    await expect(page.locator("#records")).toContainText("Offline capture");

    const before = await (await request.get(`${server.origin}/state`)).json();
    const foreign = await request.post(`${server.origin}/action`, {
      headers: {
        Origin: "https://foreign.invalid",
        "x-module-dev-revision": before.revision,
      },
      data: { action: "network", online: false },
    });
    expect(foreign.status()).toBe(403);
    const noRevision = await request.post(`${server.origin}/action`, {
      data: { action: "network", online: false },
    });
    expect(noRevision.status()).toBe(409);

    await writeFile(
      resolve(directory, "view.tsx"),
      source.replace('title="Custom notes"', 'title="Rebuilt notes"'),
    );
    await expect(
      region.getByRole("heading", { name: "Rebuilt notes", exact: true }),
    ).toBeVisible({ timeout: 45000 });
    await expect(page.locator("#records")).not.toContainText(
      "Saved through React",
    );
    const stale = await request.post(`${server.origin}/action`, {
      headers: { "x-module-dev-revision": before.revision },
      data: { action: "network", online: false },
    });
    expect(stale.status()).toBe(409);

    await writeFile(
      resolve(directory, "view.tsx"),
      source + '\nconst invalid: number = "wrong";\n',
    );
    await expect(page.locator("#build-error")).toContainText("view.tsx", {
      timeout: 45000,
    });
    await expect(page.locator("#build-error")).toContainText("not assignable");
    await expect(page.locator("#workspace")).not.toBeVisible();
    const failed = await request.post(`${server.origin}/action`, {
      headers: { "x-module-dev-revision": before.revision },
      data: { action: "network", online: false },
    });
    expect(failed.status()).toBe(503);
    await writeFile(resolve(directory, "view.tsx"), source);
    await ready();

    await writeFile(
      resolve(directory, "fixtures.json"),
      JSON.stringify({ notes: [{ name: "Reloaded fixture" }] }),
    );
    await expect(
      region.getByText("Reloaded fixture", { exact: true }),
    ).toBeVisible({ timeout: 45000 });
    await expect(
      region.getByText("Initial fixture", { exact: true }),
    ).not.toBeVisible();
    await writeFile(
      resolve(directory, "view.css"),
      ".form-stack { max-width: 500px; } body { background: rgb(255,0,255); }",
    );
    await expect(region.locator(".form-stack")).toHaveCSS(
      "max-width",
      "500px",
      { timeout: 45000 },
    );

    const backend = await readFile(
      resolve(directory, "module-server.ts"),
      "utf8",
    );
    const backendRevision = await page
      .locator("#workspace")
      .getAttribute("data-revision");
    await writeFile(
      resolve(directory, "module-server.ts"),
      backend.replace(
        ".create(input)",
        '.create({ ...input, name: "Server: " + input.name })',
      ),
    );
    await expect(page.locator("#workspace")).not.toHaveAttribute(
      "data-revision",
      backendRevision!,
      { timeout: 45000 },
    );
    await ready();
    await region.getByLabel("Note name").fill("New backend");
    await region.getByRole("button", { name: "Save note" }).click();
    await expect(
      region.getByText("Server: New backend", { exact: true }),
    ).toBeVisible();

    await writeFile(
      resolve(directory, "configuration.json"),
      JSON.stringify({ undeclared: true }),
    );
    await expect(page.locator("#build-error")).toBeVisible({ timeout: 45000 });
    await writeFile(resolve(directory, "configuration.json"), "{}");
    await ready();
    await expect(
      region.getByText("Reloaded fixture", { exact: true }),
    ).toBeVisible();
    await expect(region.locator(".page-heading p")).toHaveCSS("opacity", "1");
    const accessibility = await new AxeBuilder({ page })
      .include("#custom-preview")
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await mkdir("docs/verification/module-preview", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-preview/wide.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await page.screenshot({
      path: "docs/verification/module-preview/narrow.png",
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
