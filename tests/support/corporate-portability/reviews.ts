import { expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertSchema, type ResourceRecord } from "@suite/module-sdk";
import { SavedWorkRecoverySchema } from "@suite/module-sdk/platform";
import { selectValue } from "../../e2e/controls.helpers";
import type { corporatePortability } from "./journey";

/** A real saved conflict review stays attached to its original request on a fresh device. */
export async function corporateReviewPortability(
  options: Parameters<typeof corporatePortability>[0],
) {
  let page = options.source;
  const me = await (await options.api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await options.api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { id: workspaceId, name: "Imported record reviews", currency: "EUR" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const pkg = await (
    await options.api.get(
      `/api/v1/module/contacts/workspaces/${workspaceId}/artifact`,
    )
  ).json();
  const command = async (
    action: string,
    input: unknown,
    key = randomUUID(),
  ) => {
    const response = await options.api.post(
      `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": key,
          "x-module-version": pkg.version,
        },
        data: { action, resource: "contacts", input },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as ResourceRecord;
  };
  const record = await command("create", {
    id: randomUUID(),
    data: {
      name: "Base contact",
      kind: "person",
      relationship: "customer",
      email: "base@example.test",
    },
  });
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const contacts = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  const enable = async () => {
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await settings();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
  };
  await enable();
  await contacts();
  await expect(
    page.getByRole("cell", { name: "Base contact", exact: true }),
  ).toBeVisible();
  await options.offline(true);
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Base contact", exact: true }),
    })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("First local edit");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  const firstRemote = await command("update", {
    id: record.id,
    baseVersion: record.version,
    data: {
      ...record.data,
      name: "First remote edit",
      email: "first@example.test",
    },
  });
  await options.offline(false);
  const pending = () =>
    page.getByRole("group", {
      name: "Pending update: First local edit",
      exact: true,
    });
  await pending().getByRole("button", { name: "Review", exact: true }).click();
  await selectValue(page, "Use value for name", "local");
  await page
    .getByLabel("Address", { exact: true })
    .fill("Preserved review address");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await options.offline(true);
  await settings();
  await page
    .getByRole("button", { name: /Saved records and drafts \(2\)/ })
    .click();
  const source = page.getByRole("dialog", {
    name: "Records and drafts",
    exact: true,
  });
  const path = resolve(options.directory, "linked-review.json");
  await options.exportFile(
    source.getByRole("button", { name: "Export saved draft", exact: true }),
    path,
  );
  const bytes = await readFile(path);
  const saved: unknown = JSON.parse(bytes.toString());
  assertSchema(SavedWorkRecoverySchema, saved);
  if (
    saved.selection !== "draft" ||
    !saved.entry ||
    saved.entry.call.action !== "update"
  )
    throw Error("The UI did not export the linked update review.");
  expect(saved.review?.entryId).toBe(saved.entry.id);
  expect(saved.data.address).toBe("Preserved review address");
  expect(saved.review?.comparison?.choices.name).toBe("local");
  const latest = await command("update", {
    id: record.id,
    baseVersion: firstRemote.version,
    data: {
      ...firstRemote.data,
      name: "Latest remote edit",
      email: "latest@example.test",
    },
  });
  page = await options.replaceDevice();
  await enable();
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const imported = page.getByRole("dialog", {
    name: "Imported saved work",
    exact: true,
  });
  await expect(
    imported.getByLabel("Saved-work recovery file", { exact: true }),
  ).toBeEnabled();
  await imported
    .getByLabel("Saved-work recovery file", { exact: true })
    .setInputFiles(path);
  await imported
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  await imported
    .getByRole("button", { name: "Confirm restoration", exact: true })
    .click();
  await expect(
    imported.getByText("Restored. The imported copy is retained separately.", {
      exact: true,
    }),
  ).toBeVisible();
  await imported
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await contacts();
  await expect(
    page.getByRole("region", { name: "Saved reviews", exact: true }),
  ).toHaveCount(0);
  await pending()
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue(
    "Preserved review address",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "latest@example.test",
  );
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Latest remote edit",
  );
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const resume = pending().getByRole("button", {
    name: "Resume review",
    exact: true,
  });
  await expect(resume).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue(
    "Preserved review address",
  );
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  const evidence = resolve("docs/verification/imported-record-reviews");
  await mkdir(evidence, { recursive: true });
  const name = options.evidenceName ?? "desktop-to-desktop";
  await page.screenshot({
    path: resolve(evidence, `${name}-review.png`),
    animations: "disabled",
  });
  const native = await page.evaluate(() => Boolean(window.suiteDesktop));
  const a11y = await new AxeBuilder({ page })
    .setLegacyMode(native)
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Save", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidence, `${name}-narrow.png`),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize(viewport);
  await selectValue(page, "Use value for name", "local");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "First local edit",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(pending()).toHaveCount(0);
  const accepted = await command("get", { id: record.id });
  expect(accepted).toMatchObject({
    id: record.id,
    version: latest.version + 1,
    data: {
      name: "First local edit",
      email: "latest@example.test",
      address: "Preserved review address",
    },
  });
  const late = await options.api.post(
    `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": saved.entry.id,
        "x-module-version": saved.entry.call.moduleVersion,
      },
      data: {
        action: "update",
        resource: "contacts",
        input: saved.entry.call.input,
      },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  expect(await readFile(path)).toEqual(bytes);
  return page;
}
