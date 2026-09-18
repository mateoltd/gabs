import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import { assertSchema, type ResourceRecord } from "@suite/module-sdk";
import { ModuleInputRecoverySchema } from "@suite/module-sdk/platform";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function archivedInputJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  reconnect(): Promise<void>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  loseReply(key: string): Promise<void>;
  dispatched(): Promise<string[]>;
  exportInput(button: string): Promise<unknown>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const me = await (await api.get("/api/v1/me")).json();
  let scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  let version: string;
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const workspace = async (name: string) => {
    scope = { ...scope, workspaceId: randomUUID() };
    const result = await api.post("/api/v1/workspaces", {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: { id: scope.workspaceId, name, currency: "EUR" },
    });
    expect(result.ok(), await result.text()).toBe(true);
    version = (
      await (
        await api.get(
          `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
        )
      ).json()
    ).version;
  };
  const command = async (
    action: "create" | "update" | "archive",
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
  const create = (name: string) =>
    command("create", {
      data: { name, kind: "person", relationship: "customer", phone: "111" },
    });
  const journal = async () => (await options.storage(page, scope)).journal;
  const nav = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  const row = (name: string) =>
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
  const pending = (name: string) =>
    page.getByRole("group", { name: `Pending update: ${name}`, exact: true });
  const dialog = () => page.getByRole("dialog");
  const close = () =>
    dialog().getByRole("button", { name: "Close dialog", exact: true }).click();
  const edit = async (name: string, phone: string) => {
    await row(name).getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Phone", { exact: true }).fill(phone);
  };
  const save = async (offline: boolean) => {
    await dialog()
      .getByRole("button", {
        name: offline ? "Save pending change" : "Save",
        exact: true,
      })
      .click();
  };
  const capture = async (name: string) =>
    page.screenshot({
      path: `docs/verification/archived-input/${options.kind}-${name}.png`,
    });
  const exported = async (button: string) => {
    const result = await options.exportInput(button);
    assertSchema(ModuleInputRecoverySchema, result);
    return result;
  };
  await workspace("Archived queued input acceptance");
  const original = await create("Archived queued contact");
  const active = await create("Active pending contact");
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await nav();
  await expect(row("Archived queued contact")).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
  await options.offline(true);
  await edit("Archived queued contact", "222");
  await save(true);
  await expect(dialog()).toHaveCount(0);
  await edit("Active pending contact", "444");
  await save(true);
  await expect(dialog()).toHaveCount(0);
  const saved = await journal();
  await command("archive", { id: original.id, baseVersion: 1 });
  await command("update", {
    id: active.id,
    baseVersion: 1,
    data: { ...active.data, phone: "333" },
  });
  await options.offline(false);
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["conflict", "conflict"]);
  await expect(
    row("Active pending contact").getByRole("button", {
      name: "Archive",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(row("Active pending contact")).toContainText(
    "Resolve pending changes before archiving.",
  );
  await mkdir("docs/verification/archived-input", { recursive: true });
  await capture("blocked");
  await pending("Archived queued contact")
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Recover input", exact: true }),
  ).toBeVisible();
  await expect(
    dialog()
      .getByRole("region", { name: "Archived input", exact: true })
      .getByText("222", { exact: true }),
  ).toBeVisible();
  await expect(dialog().getByRole("textbox")).toHaveCount(0);
  await expect(
    dialog().getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0);
  await mkdir("docs/verification/archived-input", { recursive: true });
  await capture("queued");
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
    await dialog().evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  await capture("narrow");
  await options.wide();
  await close();
  await options.offline(true);
  page = await options.restartOffline();
  await nav();
  await pending("Archived queued contact")
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(
    dialog()
      .getByRole("region", { name: "Archived input", exact: true })
      .getByText("222", { exact: true }),
  ).toBeVisible();
  await close();
  await options.reconnect();
  await nav();
  await pending("Archived queued contact")
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  const copy = await exported("Export input");
  expect(copy).toEqual({
    kind: "module-input-recovery",
    ...scope,
    moduleId: "contacts",
    moduleVersion: version!,
    resource: "contacts",
    input: {
      id: original.id,
      baseVersion: 1,
      data: { ...original.data, phone: "222" },
    },
    status: "unsaved",
  });
  expect((await journal())[0].call).toEqual(saved[0].call);
  expect((await journal())[0].state).toBe("conflict");
  await close();
  await pending("Active pending contact")
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await selectValue(page, "Use value for phone", "local");
  await save(false);
  await expect(dialog()).toHaveCount(0);
  await expect(
    row("Active pending contact").getByRole("button", {
      name: "Archive",
      exact: true,
    }),
  ).toBeEnabled();
  await row("Active pending contact")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(row("Active pending contact")).toHaveCount(0);
  const queuedRows = (
    await pool.query(
      "select id,data,version,archived from suite.module_records where workspace_id=$1 and resource='contacts'",
      [scope.workspaceId],
    )
  ).rows;
  expect(queuedRows.find((r) => r.id === original.id)).toMatchObject({
    version: 2,
    archived: true,
    data: original.data,
  });
  expect(queuedRows.find((r) => r.id === active.id)).toMatchObject({
    version: 4,
    archived: true,
    data: { ...active.data, phone: "444" },
  });
  // Direct/no-cache recovery uses the same read-only editor without inventing a journal.
  await workspace("Archived direct input acceptance");
  const direct = await create("Archived direct contact");
  const uncertain = await create("Uncertain direct contact");
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await nav();
  await edit("Archived direct contact", "555");
  await command("archive", { id: direct.id, baseVersion: 1 });
  await save(false);
  await expect(
    page.getByRole("dialog", { name: "Recover input", exact: true }),
  ).toBeVisible();
  const directCopy = await exported("Export input");
  expect(directCopy.input).toEqual({
    id: direct.id,
    baseVersion: 1,
    data: { ...direct.data, phone: "555" },
  });
  expect(directCopy.status).toBe("unsaved");
  await capture("direct");
  await close();
  await edit("Uncertain direct contact", "777");
  await options.loseReply("next");
  await save(false);
  await expect(
    page.getByRole("region", { name: "Unconfirmed change", exact: true }),
  ).toBeVisible();
  const uncertainCopy = await exported("Export pending input");
  expect(uncertainCopy.status).toBe("unconfirmed");
  if (uncertainCopy.status !== "unconfirmed")
    throw Error("Expected retained pending request");
  expect(uncertainCopy.pendingRequest.input).toEqual({
    id: uncertain.id,
    baseVersion: 1,
    baseData: uncertain.data,
    data: { ...uncertain.data, phone: "777" },
  });
  expect(uncertainCopy.pendingRequest.key).toBe(
    (await options.dispatched()).at(-1),
  );
  await capture("uncertain");
  await dialog()
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check and resolve", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
  const directState = await options.storage(page, scope);
  expect(directState.journal).toEqual([]);
  expect(directState.drafts).toEqual({});
  expect(
    (
      await pool.query(
        "select action,count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.archive','contacts.contacts.update') group by action order by action",
        [scope.workspaceId],
      )
    ).rows,
  ).toEqual([
    { action: "contacts.contacts.archive", n: 1 },
    { action: "contacts.contacts.update", n: 1 },
  ]);
}
