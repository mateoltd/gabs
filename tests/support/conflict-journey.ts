import { resourceDraftKey } from "../../packages/client/src/modules/drafts";
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import type { ResourceRecord } from "@suite/module-sdk";
import { selectValue } from "../e2e/controls.helpers";
export async function conflictJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  legacyBase?: boolean;
  forgetOriginal?(scope: {
    userId: string;
    workspaceId: string;
  }): Promise<void>;
  offline(value: boolean): Promise<void>;
  restart(): Promise<Page>;
  narrow(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
    "idempotency-key": randomUUID(),
  };
  const created = await api.post("/api/v1/workspaces", {
    headers,
    data: {
      id: scope.workspaceId,
      name: "Conflict review acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const version = (
    await (
      await api.get(
        `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
      )
    ).json()
  ).version;
  const command = async (
    action: "create" | "update",
    input: Record<string, unknown>,
  ) => {
    const result = await api.post(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": version,
        },
        data: { resource: "contacts", action, input },
      },
    );
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()) as ResourceRecord;
  };
  const original = await command("create", {
    data: {
      name: "Original name",
      kind: "person",
      relationship: "customer",
      email: "original@example.test",
      phone: "111",
    },
  });
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  const record = () =>
    page.getByRole("row").filter({
      has: page.getByRole("cell", { name: "Original name", exact: true }),
    });
  await expect(record()).toBeVisible();
  await options.offline(true);
  await record().getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Local name");
  await page.getByLabel("Phone", { exact: true }).fill("222");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (options.legacyBase) await options.forgetOriginal!(scope);
  const remote = await command("update", {
    id: original.id,
    baseVersion: original.version,
    data: {
      ...original.data,
      name: "Server name",
      email: "server@example.test",
      phone: "333",
    },
  });
  await options.offline(false);
  await expect
    .poll(async () => (await options.storage(page, scope)).journal[0]?.state)
    .toBe("conflict");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  const comparison = () =>
    dialog.getByRole("region", { name: "Conflict comparison", exact: true });
  await expect(comparison()).toContainText(
    options.legacyBase ? "original values were not retained" : "Original name",
  );
  await expect(comparison()).toContainText("Local name");
  await expect(comparison()).toContainText("Server name");
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByLabel("Name", { exact: true })).toBeDisabled();
  await mkdir("docs/verification/conflict-review", { recursive: true });
  await page.screenshot({
    path: `docs/verification/conflict-review/${options.kind}${options.legacyBase ? "-legacy" : ""}-comparison.png`,
  });
  await selectValue(page, "Use value for name", "local");
  await selectValue(page, "Use value for phone", "remote");
  if (options.legacyBase)
    await selectValue(page, "Use value for email", "remote");
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Local name",
  );
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(
    "server@example.test",
  );
  await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("333");
  await dialog
    .getByLabel("Address", { exact: true })
    .fill("Preserved review edit");
  const entryId = (await options.storage(page, scope)).journal[0].id;
  const draftKey = resourceDraftKey("contacts", "contacts", { entryId });
  await expect
    .poll(
      async () =>
        (await options.storage(page, scope)).drafts[draftKey]?.address,
    )
    .toBe("Preserved review edit");
  const saved = (await options.storage(page, scope)).draftReviews![draftKey];
  expect(saved.comparison!.choices).toEqual({
    name: "local",
    phone: "remote",
    ...(options.legacyBase ? { email: "remote" } : {}),
  });
  page = await options.restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  // A process starts at Overview; a browser reload retains the current module route.
  if (
    !(await page
      .getByRole("button", { name: "Resume review", exact: true })
      .isVisible())
  )
    await page.locator('a[href$="/contacts"]').click();
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expect(dialog.getByLabel("Address", { exact: true })).toHaveValue(
    "Preserved review edit",
  );
  await expect(
    dialog.getByRole("combobox", { name: "Use value for name", exact: true }),
  ).toContainText("Your change");
  await expect(
    dialog.getByRole("combobox", { name: "Use value for phone", exact: true }),
  ).toContainText("Server value");
  // Another writer changes the same field and an unrelated field while this review is retained.
  const newer = await command("update", {
    id: original.id,
    baseVersion: remote.version,
    data: {
      ...remote.data,
      name: "Server changed again",
      email: "newest@example.test",
    },
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      (await options.storage(page, scope)).journal.map((e) => e.state),
    )
    .toEqual(["conflict", "conflict"]);
  await page.getByRole("button", { name: "Review", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expect(comparison()).toContainText("Server changed again");
  await expect(comparison()).toContainText("Server name");
  await expect(
    dialog.getByRole("combobox", { name: "Use value for phone", exact: true }),
  ).toHaveCount(0);
  await selectValue(page, "Use value for name", "remote");
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(
    "newest@example.test",
  );
  await expect(dialog.getByLabel("Address", { exact: true })).toHaveValue(
    "Preserved review edit",
  );
  await options.narrow();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode()
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  await comparison().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/conflict-review/${options.kind}${options.legacyBase ? "-legacy" : ""}-narrow.png`,
  });
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () =>
      (await options.storage(page, scope)).journal.map((e) => e.state),
    )
    .toEqual(["conflict", "conflict", "accepted"]);
  const state = await options.storage(page, scope);
  expect(state.journal[0].supersededBy).toBe(state.journal[1].id);
  expect(state.journal[1].supersededBy).toBe(state.journal[2].id);
  expect(state.draftReviews?.[draftKey]).toBeUndefined();
  expect(state.drafts[draftKey]).toBeUndefined();
  const final = await pool.query(
    "select data,version from suite.module_records where workspace_id=$1 and module_id='contacts' and id=$2",
    [scope.workspaceId, original.id],
  );
  expect(final.rows[0]).toEqual({
    version: newer.version + 1,
    data: { ...newer.data, address: "Preserved review edit" },
  });
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action='contacts.contacts.update'",
        [scope.workspaceId],
      )
    ).rows[0].n,
  ).toBe(3);
}
