import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function createCollisionJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restart(): Promise<Page>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  loseSettlementReply(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const created = await api.post("/api/v1/workspaces", {
    headers: {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: {
      id: scope.workspaceId,
      name: "Create collision acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New projects", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New contacts", exact: true }),
  ).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
  const save = async () => {
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Collision contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await save();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New notes", exact: true }).click();
  await page.getByRole("combobox", { name: "Contact Id", exact: true }).click();
  await page
    .getByRole("option", { name: "Collision contact (pending)", exact: true })
    .click();
  await page.getByLabel("Text", { exact: true }).fill("Dependent note");
  await save();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Independent project");
  await selectValue(page, "Status", "planned");
  await save();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  const captured = (await options.storage(page, scope)).journal;
  expect(captured).toHaveLength(3);
  expect(captured[1].dependencies).toEqual([captured[0].id]);
  expect(captured.every((e) => e.delivery === "unsubmitted")).toBe(true);

  const journal = async () => (await options.storage(page, scope)).journal;
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
    "x-module-version": captured[0].call.moduleVersion!,
  };
  const originalId = (captured[0].call.input as { id: string }).id;
  // A different authenticated session claims the identity while this client is offline.
  const collision = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "create",
        resource: "contacts",
        input: {
          id: originalId,
          data: {
            name: "Existing corporate record",
            kind: "organization",
            relationship: "supplier",
          },
        },
      },
    },
  );
  expect(collision.ok(), await collision.text()).toBe(true);
  const existing = await collision.json();
  await options.offline(false);
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["conflict", "pending", "accepted"]);
  expect((await journal())[0].errorCode).toBe("RECORD_EXISTS");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Failed create recovery" }),
  ).toContainText("already exists");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Recovered separate contact");
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog).toContainText("Existing server records stay unchanged");
  await expect(dialog).toHaveClass(/is-open/);
  await expect(dialog).toHaveCSS("opacity", "1");
  await mkdir("docs/verification/create-collisions", { recursive: true });
  await page.screenshot({
    path: `docs/verification/create-collisions/${options.kind}-confirmation.png`,
  });
  await options.narrow();
  let axe = new AxeBuilder({ page });
  if (options.kind === "native") axe = axe.setLegacyMode();
  expect(
    (
      await axe
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/verification/create-collisions/${options.kind}-confirmation-narrow.png`,
  });
  await options.wide();
  // Escape returns to the preserved input rather than leaving stacked editors.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered separate contact",
  );
  const action = page.getByRole("button", {
    name: "Create separate record",
    exact: true,
  });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await options.loseSettlementReply();
  await dialog
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "select outcome from suite.idempotency where workspace_id=$1 and key=$2",
            [scope.workspaceId, captured[0].id],
          )
        ).rows[0]?.outcome,
    )
    .toBe("cancelled");
  await expect(
    dialog.getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    }),
  ).toBeEnabled();
  expect((await journal()).map((e) => e.state)).toEqual([
    "conflict",
    "pending",
    "accepted",
  ]);
  page = await options.restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await options.offline(true);
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered separate contact",
  );
  await expect(
    page.getByRole("button", { name: "Create separate record", exact: true }),
  ).toBeDisabled();
  await options.offline(false);
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await dialog
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await journal()).filter((e) => !e.supersededBy).map((e) => e.state),
      { timeout: 45000 },
    )
    .toEqual(["accepted", "accepted", "accepted"]);
  const final = await journal();
  expect(final).toHaveLength(5);
  const parent = final.find((e) => e.id === final[0].supersededBy)!;
  const child = final.find((e) => e.id === final[1].supersededBy)!;
  const newId = (parent.call.input as { id: string }).id;
  expect(newId).not.toBe(originalId);
  expect(final[0].call).toEqual(captured[0].call);
  expect(final[1].call).toEqual(captured[1].call);
  expect(child.call.input).toEqual({
    ...(captured[1].call.input as object),
    data: { contactId: newId, text: "Dependent note" },
  });
  expect(child.dependencies).toEqual([parent.id]);
  const records = (
    await pool.query(
      "select id,module_id,resource,data,version from suite.module_records where workspace_id=$1",
      [scope.workspaceId],
    )
  ).rows;
  expect(records).toHaveLength(4);
  expect(records.find((r) => r.id === originalId)).toMatchObject({
    data: existing.data,
    version: existing.version,
  });
  expect(records.find((r) => r.id === newId).data.name).toBe(
    "Recovered separate contact",
  );
  expect(records.find((r) => r.resource === "notes").data.contactId).toBe(
    newId,
  );
  const late = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: { ...headers, "idempotency-key": captured[0].id },
      data: {
        action: "create",
        resource: "contacts",
        input: captured[0].call.input,
      },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  // Repeating both replacement requests returns their receipts without additional effects.
  for (const entry of [parent, child]) {
    const retry = await api.post(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
      {
        headers: { ...headers, "idempotency-key": entry.id },
        data: {
          action: entry.call.action,
          resource: entry.call.resource,
          input: entry.call.input,
        },
      },
    );
    expect(retry.ok(), await retry.text()).toBe(true);
  }
  expect(
    (
      await pool.query(
        "select action,count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.create','contacts.notes.create','projects.projects.create','module.attempt.cancel') group by action order by action",
        [scope.workspaceId],
      )
    ).rows,
  ).toEqual([
    { action: "contacts.contacts.create", n: 2 },
    { action: "contacts.notes.create", n: 1 },
    { action: "module.attempt.cancel", n: 1 },
    { action: "projects.projects.create", n: 1 },
  ]);
  await expect(
    page.getByRole("cell", { name: "Recovered separate contact", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/verification/create-collisions/${options.kind}-recovered.png`,
  });
  await options.narrow();
  await page.screenshot({
    path: `docs/verification/create-collisions/${options.kind}-recovered-narrow.png`,
  });
}
