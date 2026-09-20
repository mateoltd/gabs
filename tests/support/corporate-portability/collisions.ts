import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { assertSchema, type ResourceRecord } from "@suite/module-sdk";
import { SavedWorkRecoverySchema } from "@suite/module-sdk/platform";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";
import type { corporatePortability } from "./journey";

/** Export a real reassigned draft, then choose its destination afresh on an empty device. */
export async function corporateCollisionPortability(
  options: Parameters<typeof corporatePortability>[0] & {
    choice: "original" | "reassigned";
  },
) {
  let page = options.source;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const me = await (await options.api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const scope = { userId: me.user.id as string, workspaceId };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await options.api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: workspaceId,
      name: "Imported collision drafts",
      currency: "EUR",
    },
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
  const navigate = (name: string) =>
    page
      .getByRole("navigation", {
        name: name === "Settings" ? "Preferences" : "Main navigation",
        exact: true,
      })
      .getByRole("link", { name, exact: true })
      .click();
  const enable = async () => {
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await navigate("Settings");
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
  await navigate("Contacts");
  await expect(
    page.getByRole("button", { name: "New contacts", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => !!(await portabilityStorage(page, scope))?.installed.contacts,
    )
    .toBe(true);
  await options.offline(true);
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Collision contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const entry = (await portabilityStorage(page, scope)).journal[0];
  if (!entry.call.moduleVersion)
    throw Error("The captured source contract is missing");
  const originalId = (entry.call.input as { id: string }).id;
  const existing = await command("create", {
    id: originalId,
    data: {
      name: "Original corporate contact",
      kind: "person",
      relationship: "customer",
    },
  });
  await options.offline(false);
  await expect
    .poll(async () => (await portabilityStorage(page, scope)).journal[0].state)
    .toBe("conflict");
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", {
      name: "Original corporate contact",
      exact: true,
    }),
  });
  await expect(row).toBeVisible();
  await options.offline(true);
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Phone", { exact: true }).fill("444");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await options.offline(false);
  await page
    .getByRole("group", {
      name: "Pending create: Collision contact",
      exact: true,
    })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Separate corporate contact");
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  await selectValue(page, "Record for saved draft 1", "separate");
  await page
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await portabilityStorage(page, scope)).journal.find(
          (item) => item.id !== entry.id,
        )?.state,
    )
    .toBe("accepted");
  await options.offline(true);
  await navigate("Settings");
  await page.getByRole("button", { name: /^Saved records and drafts/ }).click();
  const source = page.getByRole("dialog", {
    name: "Records and drafts",
    exact: true,
  });
  const path = resolve(options.directory, "collision-draft.json");
  await options.exportFile(
    source.getByRole("button", { name: "Export saved draft", exact: true }),
    path,
  );
  const bytes = await readFile(path);
  const input: unknown = JSON.parse(bytes.toString());
  assertSchema(SavedWorkRecoverySchema, input);
  if (input.selection !== "draft" || !input.review?.collision?.targetId)
    throw Error("Expected actual reassigned draft export");
  expect(input.entry).toBeUndefined();
  expect(input.target?.id).toBe(originalId);
  expect(input.review.collision.ready).not.toBe(true);
  expect(input.review.collision.targetId).not.toBe(originalId);
  const separate = await command("get", {
    id: input.review.collision.targetId,
  });
  const originals = [existing, separate];
  const updated: ResourceRecord[] = [];
  for (const record of originals)
    updated.push(
      await command("update", {
        id: record.id,
        baseVersion: record.version,
        data: { ...record.data, phone: "999", email: "current@example.test" },
      }),
    );
  page = await options.replaceDevice();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enable();
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  let imported = page.getByRole("dialog", {
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
  await expect(
    imported.getByRole("button", { name: "Confirm restoration", exact: true }),
  ).toBeDisabled();
  await selectValue(page, "Draft to restore", options.choice);
  await imported
    .getByRole("button", { name: "Back to imported copies", exact: true })
    .click();
  await imported
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  await expect(
    imported.getByRole("button", { name: "Confirm restoration", exact: true }),
  ).toBeDisabled();
  const picker = imported.getByRole("combobox", {
    name: "Draft to restore",
    exact: true,
  });
  await picker.focus();
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", {
    name:
      options.choice === "original"
        ? "Original draft before reassignment"
        : "Reassigned draft",
    exact: true,
  });
  await option.focus();
  await page.keyboard.press("Enter");
  await expect(picker).toHaveAttribute("aria-expanded", "false");
  const evidence = resolve("docs/verification/imported-collision-drafts");
  await mkdir(evidence, { recursive: true });
  const name = `${options.evidenceName}-${options.choice}`;
  await page.screenshot({
    path: resolve(evidence, `${name}-choice.png`),
    animations: "disabled",
  });
  const native = await page.evaluate(() => Boolean(window.suiteDesktop));
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await imported
    .getByRole("button", { name: "Confirm restoration", exact: true })
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
  await page.reload();
  await navigate("Contacts");
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit record", exact: true });
  const chosen = options.choice === "original" ? updated[0] : updated[1];
  const untouched = options.choice === "original" ? updated[1] : updated[0];
  await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(
    String(chosen.data.name),
  );
  await expect(editor.getByLabel("Email", { exact: true })).toHaveValue(
    "current@example.test",
  );
  await expect(
    editor.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await selectValue(page, "Use value for phone", "local");
  await expect(editor.getByLabel("Phone", { exact: true })).toHaveValue("444");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect
    .poll(async () => (await command("get", { id: chosen.id })).version)
    .toBe(chosen.version + 1);
  const result = await command("get", { id: chosen.id });
  expect(result).toMatchObject({
    id: chosen.id,
    version: chosen.version + 1,
    data: { ...chosen.data, phone: "444" },
  });
  expect(await command("get", { id: untouched.id })).toEqual(untouched);
  expect(await readFile(path)).toEqual(bytes);
  const late = await options.api.post(
    `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": entry.id,
        "x-module-version": entry.call.moduleVersion,
      },
      data: { action: "create", resource: "contacts", input: entry.call.input },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
}
