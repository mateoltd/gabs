import "dotenv/config";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "./controls.helpers";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModuleDefinition } from "@suite/module-sdk";
import { buildRegistryConsole } from "../../tooling/modules/registry-console/build";
import { startRegistryConsole } from "../../tooling/modules/registry-console/server";
import { signPackage } from "../../packages/sdk/node/signing";
import { buildServerPackage } from "../../packages/sdk/node/build-server";

test("operator inspects signed artifacts, rejects invalid submissions and reviews, stages and publishes through the console", async ({
  page,
}) => {
  test.setTimeout(90000);
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/console-browser-"));
  const id = `console-ui-${randomUUID().slice(0, 8)}`;
  for (const file of ["module.ts", "module-server.ts"])
    await writeFile(
      resolve(directory, file),
      (
        await readFile(`tests/fixtures/reviewed-notes/${file}`, "utf8")
      ).replaceAll("reviewed-notes", id),
    );
  const module = (
    await import(pathToFileURL(resolve(directory, "module.ts")).href)
  ).default as ModuleDefinition;
  const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
    publicKey = await readFile(`${keys}/public.pem`, "utf8");
  const client = signPackage(module, privateKey),
    server = await buildServerPackage(module, directory, privateKey);
  const clientFile = resolve(directory, "client.json"),
    serverFile = resolve(directory, "server.json");
  await writeFile(clientFile, JSON.stringify(client));
  await writeFile(serverFile, JSON.stringify(server));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  const consoleServer = await startRegistryConsole({
    pool,
    publicKey,
    assets: await buildRegistryConsole(resolve(directory, "assets")),
    port: 0,
  });
  try {
    await page.goto(consoleServer.origin);
    await page
      .getByLabel("Console access code", { exact: true })
      .fill(consoleServer.accessCode);
    await page
      .getByRole("button", { name: "Unlock console", exact: true })
      .click();
    await expect(page.getByText("Common operator tools")).toBeVisible();
    await page.getByText("Submit signed packages", { exact: true }).click();
    await page
      .getByLabel("Client package", { exact: true })
      .setInputFiles(clientFile);
    await page
      .getByRole("button", { name: "Submit packages", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "require a signed server component",
    );
    await page
      .getByLabel("Server package (if required)", { exact: true })
      .setInputFiles(serverFile);
    await page
      .getByRole("button", { name: "Submit packages", exact: true })
      .click();
    const review = page.getByRole("region", {
      name: "Submission review",
      exact: true,
    });
    await expect(
      review.getByRole("heading", { name: id, exact: true }),
    ).toBeVisible();
    await review
      .getByText("Contract, configuration and dependencies", { exact: true })
      .click();
    await expect(review.locator("pre").first()).toContainText(`${id}.capture`);
    await review.getByText("Exact server artifact", { exact: true }).click();
    await expect(review.locator("pre").last()).toContainText("capture");
    await review.getByText("Exact server artifact", { exact: true }).click();
    await review
      .getByText("Contract, configuration and dependencies", { exact: true })
      .click();
    await expect(
      review.getByRole("button", { name: "Approve release", exact: true }),
    ).toBeDisabled();
    await review
      .getByLabel("Review reason", { exact: true })
      .fill(
        "Reviewed signed operation contract, scope and fixture implementation.",
      );
    await review
      .getByRole("checkbox", {
        name: "I reviewed the exact signed contract and artifacts.",
        exact: true,
      })
      .check();
    await mkdir("docs/verification/registry-console", { recursive: true });
    await page.screenshot({
      path: "docs/verification/registry-console/review-wide.png",
      fullPage: true,
    });
    expect(
      (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
        .violations,
    ).toEqual([]);
    await review
      .getByRole("button", { name: "Approve release", exact: true })
      .click();
    await expect(
      review.getByRole("button", { name: "Publish release", exact: true }),
    ).toBeDisabled();
    await review
      .getByRole("button", { name: "Stage server", exact: true })
      .click();
    await expect(
      review.getByRole("button", { name: "Server staged", exact: true }),
    ).toBeDisabled();
    await review
      .getByRole("button", { name: "Publish release", exact: true })
      .click();
    await expect(
      review.getByText("The registry release is available.", { exact: false }),
    ).toBeVisible();
    const releases = await pool.query(
      "select count(*) from suite.module_releases where module_id=$1",
      [id],
    );
    expect(releases.rows[0].count).toBe("1");
    await expect(review.getByText("published", { exact: true })).toHaveCount(2);
    await selectValue(page, "Review state", "published");
    await page.getByLabel("Search modules", { exact: true }).fill(id);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const catalogue = page.getByRole("region", {
      name: "Submission catalogue",
      exact: true,
    });
    await expect(
      catalogue.getByRole("button", { name: `${id} 1.0.0`, exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Search modules", { exact: true })
      .fill("no-matching-release");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(
      catalogue.getByText("No submissions match these filters.", {
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Search modules", { exact: true }).fill(id);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await review.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/registry-console/review-narrow.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    const rejectedFile = resolve(directory, "rejected.json");
    await writeFile(
      rejectedFile,
      JSON.stringify(
        signPackage(
          { ...module, version: "1.0.1", operations: {} },
          privateKey,
        ),
      ),
    );
    await page
      .getByLabel("Client package", { exact: true })
      .setInputFiles(rejectedFile);
    await page
      .getByLabel("Server package (if required)", { exact: true })
      .setInputFiles([]);
    await page
      .getByRole("button", { name: "Submit packages", exact: true })
      .click();
    await expect(
      review.getByText("Version 1.0.1", { exact: true }),
    ).toBeVisible();
    await review
      .getByLabel("Review reason", { exact: true })
      .fill(
        "Rejected fixture: removal of a public operation needs a compatibility plan.",
      );
    await review
      .getByRole("checkbox", {
        name: "I reviewed the exact signed contract and artifacts.",
        exact: true,
      })
      .check();
    await review
      .getByRole("button", { name: "Reject release", exact: true })
      .click();
    await expect(
      review.getByText(
        "Rejected fixture: removal of a public operation needs a compatibility plan.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Publish release", exact: true }),
    ).toHaveCount(0);
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_releases where module_id=$1 and version='1.0.1'",
          [id],
        )
      ).rows[0].count,
    ).toBe("0");
    await page
      .getByRole("button", { name: "Lock console", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Unlock console", exact: true }),
    ).toBeVisible();
    expect(
      (
        await page.request.get(`${consoleServer.origin}/api/submissions`)
      ).status(),
    ).toBe(401);
  } finally {
    await consoleServer.close();
    await pool.end();
    const admin = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    await admin.query("delete from suite.module_releases where module_id=$1", [
      id,
    ]);
    await admin.query(
      "delete from suite.module_review_events where submission_id in (select id from suite.module_submissions where module_id=$1)",
      [id],
    );
    await admin.query(
      "delete from suite.module_submissions where module_id=$1",
      [id],
    );
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
});
