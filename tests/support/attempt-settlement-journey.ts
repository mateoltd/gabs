import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function attemptSettlementJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restart(): Promise<Page>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  blockOriginalAndLoseSettlement(
    key: string,
    loseSettlement?: boolean,
  ): Promise<void>;
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
      name: "Uncertain delivery acceptance",
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
  await page.getByLabel("Name", { exact: true }).fill("Uncertain contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await save();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New notes", exact: true }).click();
  await page.getByRole("combobox", { name: "Contact Id", exact: true }).click();
  await page
    .getByRole("option", { name: "Uncertain contact (pending)", exact: true })
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
  await options.blockOriginalAndLoseSettlement(captured[0].id);
  await options.offline(false);
  const journal = async () => (await options.storage(page, scope)).journal;
  await expect
    .poll(async () => (await journal())[0].attempts)
    .toBeGreaterThanOrEqual(1);
  await page
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Resolve pending change",
    exact: true,
  });
  await expect(dialog).toContainText("stop further retries");
  await expect(dialog).toHaveClass(/is-open/);
  await expect(dialog).toHaveCSS("opacity", "1");
  await mkdir("docs/verification/attempt-settlement", { recursive: true });
  await page.screenshot({
    path: `docs/verification/attempt-settlement/${options.kind}-confirmation.png`,
  });
  await options.narrow();
  let modalAxe = new AxeBuilder({ page });
  if (options.kind === "native") modalAxe = modalAxe.setLegacyMode();
  expect(
    (
      await modalAxe
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/attempt-settlement/${options.kind}-confirmation-narrow.png`,
  });
  await options.wide();
  await dialog
    .getByRole("button", { name: "Check and resolve", exact: true })
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
    dialog.getByRole("button", { name: "Check and resolve", exact: true }),
  ).toBeEnabled();
  expect((await journal())[0].state).toBe("pending");
  page = await options.restart();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Resolve pending change",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Check and resolve", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["rejected", "pending", "accepted"]);
  await expect(
    page.getByText(/The server confirmed this change did not commit/),
  ).toBeVisible();
  const late = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        origin: "http://localhost:4300",
        "x-csrf-token": me.csrfToken,
        "idempotency-key": captured[0].id,
        "x-module-version": captured[0].call.moduleVersion!,
      },
      data: {
        action: captured[0].call.action,
        resource: captured[0].call.resource,
        input: captured[0].call.input,
      },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  await options.narrow();
  let axe = new AxeBuilder({ page });
  if (options.kind === "native") axe = axe.setLegacyMode();
  expect(
    (
      await axe
        .include("#main-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("heading", { name: "Pending changes", exact: true })
    .locator("..")
    .scrollIntoViewIfNeeded();
  await mkdir("docs/verification/attempt-settlement", { recursive: true });
  await page.screenshot({
    path: `docs/verification/attempt-settlement/${options.kind}-resolved.png`,
  });
  await page.getByRole("button", { name: "Review", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Corrected contact");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await journal()).map((e) => e.state), { timeout: 45000 })
    .toEqual(["rejected", "accepted", "accepted", "accepted"]);
  const accepted = await journal();
  expect(accepted.slice(0, 3).map((e) => e.id)).toEqual(
    captured.map((e) => e.id),
  );
  expect(accepted[0].supersededBy).toBe(accepted[3].id);
  expect(accepted[1].dependencies).toEqual([accepted[3].id]);
  expect(
    accepted.slice(1).every((e) => !e.delivery && !e.error && !e.supersededBy),
  ).toBe(true);
  const records = (
    await pool.query(
      "select module_id,resource,data from suite.module_records where workspace_id=$1",
      [scope.workspaceId],
    )
  ).rows;
  expect(records).toHaveLength(3);
  expect(records.find((r) => r.resource === "notes").data.contactId).toBe(
    (captured[0].call.input as { id: string }).id,
  );
  expect(records.find((r) => r.resource === "contacts").data.name).toBe(
    "Corrected contact",
  );
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action='module.attempt.cancel' and target_id=$2",
        [scope.workspaceId, captured[0].id],
      )
    ).rows[0].n,
  ).toBe(1);
  const audits = (
    await pool.query(
      "select action,count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.create','contacts.notes.create','projects.projects.create') group by action order by action",
      [scope.workspaceId],
    )
  ).rows;
  expect(audits).toEqual([
    { action: "contacts.contacts.create", n: 1 },
    { action: "contacts.notes.create", n: 1 },
    { action: "projects.projects.create", n: 1 },
  ]);
  // Exercise the other authoritative outcome through the same real interface.
  await options.offline(true);
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Committed before recovery");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "other");
  await save();
  const committed = (await journal())[4];
  await options.blockOriginalAndLoseSettlement(committed.id, false);
  const effect = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        origin: "http://localhost:4300",
        "x-csrf-token": me.csrfToken,
        "idempotency-key": committed.id,
        "x-module-version": committed.call.moduleVersion!,
      },
      data: {
        action: committed.call.action,
        resource: committed.call.resource,
        input: committed.call.input,
      },
    },
  );
  expect(effect.ok(), await effect.text()).toBe(true);
  await options.offline(false);
  await expect
    .poll(async () => (await journal())[4].delivery)
    .toBe("uncertain");
  await page
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Resolve pending change", exact: true })
    .getByRole("button", { name: "Check and resolve", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await journal())[4]).toMatchObject({
    id: committed.id,
    state: "accepted",
    result: await effect.json(),
  });
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action='contacts.contacts.create'",
        [scope.workspaceId],
      )
    ).rows[0].n,
  ).toBe(2);
}
