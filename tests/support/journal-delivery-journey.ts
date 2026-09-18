import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function journalDeliveryJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restart(): Promise<Page>;
  narrow(): Promise<void>;
  loseReply(
    key: string,
    revoke: () => Promise<void>,
  ): Promise<{ done: Promise<void> }>;
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
  const roles = (
    await pool.query(
      "select id from suite.roles where workspace_id=$1 and 'contacts.contacts.write'=any(permissions)",
      [scope.workspaceId],
    )
  ).rows.map((r) => r.id);
  const lost = await options.loseReply(captured[0].id, async () => {
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.write') where workspace_id=$1",
      [scope.workspaceId],
    );
  });
  await options.offline(false);
  await lost.done;
  const journal = async () => (await options.storage(page, scope)).journal;
  await expect
    .poll(async () => (await journal()).map((e) => e.state), { timeout: 45000 })
    .toEqual(["pending", "pending", "accepted"]);
  await expect
    .poll(async () => (await journal())[0].attempts)
    .toBeGreaterThanOrEqual(2);
  expect((await journal())[0]).toMatchObject({
    id: captured[0].id,
    delivery: "uncertain",
  });
  await expect(
    page.getByText(/The outcome of an earlier attempt is unknown/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toBeDisabled();
  expect((await journal())[0].error).toContain(
    "Your role does not allow this action.",
  );
  const committed = await pool.query(
    "select count(*)::int as n from suite.idempotency where workspace_id=$1 and key=$2",
    [scope.workspaceId, captured[0].id],
  );
  expect(committed.rows[0].n).toBe(1);
  page = await options.restart();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await expect(
    page.getByText(/The outcome of an earlier attempt is unknown/),
  ).toBeVisible();
  expect((await journal())[0]).toMatchObject({
    id: captured[0].id,
    state: "pending",
    delivery: "uncertain",
  });
  await expect(
    page.getByRole("button", { name: "Review", exact: true }),
  ).toBeDisabled();
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
  await mkdir("docs/verification/journal-delivery", { recursive: true });
  await page.screenshot({
    path: `docs/verification/journal-delivery/${options.kind}-pending.png`,
  });
  await pool.query(
    "update suite.roles set permissions=array_append(permissions,'contacts.contacts.write') where workspace_id=$1 and id=any($2::uuid[])",
    [scope.workspaceId, roles],
  );
  await expect
    .poll(async () => (await journal()).map((e) => e.state), { timeout: 45000 })
    .toEqual(["accepted", "accepted", "accepted"]);
  const accepted = await journal();
  expect(accepted.map((e) => e.id)).toEqual(captured.map((e) => e.id));
  expect(
    accepted.every((e) => !e.delivery && !e.error && !e.supersededBy),
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
}
