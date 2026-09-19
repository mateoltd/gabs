import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ResourceRecord } from "@suite/module-sdk";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function recordOrderJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  legacy?: boolean;
  writeStorage(
    page: Page,
    scope: { userId: string; workspaceId: string },
    state: ModuleStorage,
  ): Promise<void>;
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  reconnect(): Promise<void>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  loseReply(key: string): Promise<void>;
  dispatched(): Promise<string[]>;
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
  };
  const created = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Same-record recovery acceptance",
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
    const response = await api.post(
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
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as ResourceRecord;
  };
  const original = await command("create", {
    data: {
      name: "Sequenced contact",
      kind: "person",
      relationship: "customer",
      email: "original@example.test",
      phone: "111",
      address: "Original office",
    },
  });
  const independent = await command("create", {
    data: {
      name: "Independent contact",
      kind: "person",
      relationship: "customer",
      phone: "888",
    },
  });
  const journal = async () => (await options.storage(page, scope)).journal;
  const nav = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  const group = () =>
    page.getByRole("group", {
      name: "Pending update: Sequenced contact",
      exact: true,
    });
  const edit = async (name: string, field: string, value: string) => {
    const row = page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel(field, { exact: true }).fill(value);
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await nav();
  await expect(
    page.getByRole("cell", { name: "Sequenced contact", exact: true }),
  ).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
  await options.offline(true);
  await edit("Sequenced contact", "Phone", "222");
  await edit("Sequenced contact", "Phone", "333");
  await edit("Sequenced contact", "Email", "final@example.test");
  await edit("Independent contact", "Phone", "999");
  const saved = await journal();
  expect(saved.map((e) => e.dependencies)).toEqual([
    [],
    [saved[0].id],
    [saved[1].id],
    [],
  ]);
  expect(
    saved.every(
      (e) => (e.call.input as { baseVersion: number }).baseVersion === 1,
    ),
  ).toBe(true);
  if (options.legacy) {
    const state = await options.storage(page, scope);
    for (const entry of state.journal) entry.dependencies = [];
    delete state.journal[0].delivery;
    await options.writeStorage(page, scope, state);
  }
  page = await options.restartOffline();
  await nav();
  const freshness = page
    .getByRole("status")
    .filter({ hasText: "Offline copy." });
  await expect(freshness).toContainText("This information may be out of date.");
  const downloaded = freshness.locator("time");
  await expect(downloaded).toBeVisible();
  const downloadedAt = Date.parse((await downloaded.getAttribute("datetime"))!);
  expect(downloadedAt).toBeGreaterThan(0);
  expect(downloadedAt).toBeLessThanOrEqual(Date.now());
  if (!options.legacy) {
    await mkdir("docs/verification/resource-cache", { recursive: true });
    await freshness.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `docs/verification/resource-cache/${options.kind}-wide.png`,
    });
    await options.narrow();
    await freshness.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/verification/resource-cache/${options.kind}-narrow.png`,
    });
    await options.wide();
  }
  expect((await journal()).map((e) => e.call)).toEqual(
    saved.map((e) => e.call),
  );
  await expect(group()).toHaveCount(3);
  for (let i = 0; i < 3; i++) {
    const summary = group()
      .nth(i)
      .getByText("View saved change", { exact: true });
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(group().nth(i).locator("details")).toHaveAttribute("open", "");
  }
  await expect(group().nth(0)).toContainText("222");
  await expect(group().nth(1)).toContainText("333");
  await expect(group().nth(2)).toContainText("final@example.test");
  await expect(group().nth(1)).toContainText(
    options.legacy
      ? "Waiting for the outcomes of older edits"
      : "Waiting for prerequisite changes",
  );
  const evidence = `docs/verification/${options.legacy ? "legacy-order" : "record-order"}`;
  await mkdir(evidence, { recursive: true });
  await group().nth(1).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `${evidence}/${options.kind}-saved.png`,
  });
  await options.narrow();
  await group().nth(1).scrollIntoViewIfNeeded();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode()
        .include(".module-pending")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${evidence}/${options.kind}-narrow.png`,
  });
  await options.wide();
  // A disjoint corporate edit must survive all queued writes, including explicit review.
  await command("update", {
    id: original.id,
    baseVersion: original.version,
    data: { ...original.data, address: "Server office" },
  });
  if (options.legacy) {
    // The old host sent this exact request but did not retain its reply or delivery evidence.
    const response = await api.post(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": saved[0].id,
          "x-module-version": saved[0].call.moduleVersion!,
        },
        data: {
          resource: saved[0].call.resource,
          action: saved[0].call.action,
          input: saved[0].call.input,
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    await options.loseReply("never-dispatch-this-key"); // observe every actual renderer request
  } else await options.loseReply(saved[0].id);
  await options.reconnect();
  if (options.legacy) {
    await expect
      .poll(async () => (await journal()).map((e) => e.state))
      .toEqual(["pending", "pending", "pending", "accepted"]);
    expect((await journal())[0].attempts).toBe(0);
    expect(await options.dispatched()).toEqual([saved[3].id]);
    await group()
      .nth(0)
      .getByRole("button", { name: "Resolve outcome", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Resolve pending change", exact: true })
      .getByRole("button", { name: "Check and resolve", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect
    .poll(async () => (await journal()).map((e) => e.state), { timeout: 45000 })
    .toEqual(["accepted", "conflict", "pending", "accepted"]);
  const sent = await options.dispatched();
  expect(sent.filter((id) => id === saved[0].id)).toHaveLength(
    options.legacy ? 0 : 2,
  );
  expect(sent.indexOf(saved[1].id)).toBeGreaterThan(
    sent.lastIndexOf(saved[0].id),
  );
  expect(sent).not.toContain(saved[2].id);
  const readRow = async (id: string) =>
    (
      await pool.query(
        "select data,version from suite.module_records where workspace_id=$1 and module_id='contacts' and resource='contacts' and id=$2",
        [scope.workspaceId, id],
      )
    ).rows[0];
  expect(await readRow(original.id)).toMatchObject({
    version: 3,
    data: {
      phone: "222",
      email: "original@example.test",
      address: "Server office",
    },
  });
  expect(await readRow(independent.id)).toMatchObject({
    version: 2,
    data: { phone: "999" },
  });
  await nav();
  await expect(group()).toHaveCount(2);
  await group()
    .nth(0)
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expect(
    dialog.getByRole("region", { name: "Conflict comparison", exact: true }),
  ).toContainText("333");
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await selectValue(page, "Use value for phone", "local");
  await expect(dialog.getByLabel("Phone", { exact: true })).toHaveValue("333");
  await expect(dialog.getByLabel("Address", { exact: true })).toHaveValue(
    "Server office",
  );
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["accepted", "conflict", "accepted", "accepted", "accepted"]);
  const final = await journal();
  expect(final[1].supersededBy).toBe(final[4].id);
  expect(final[4].dependencies).toEqual([saved[0].id]);
  expect(final[2].dependencies).toEqual([final[4].id]);
  expect(final[2].call).toEqual(saved[2].call);
  expect(await readRow(original.id)).toEqual({
    version: 5,
    data: {
      ...original.data,
      phone: "333",
      email: "final@example.test",
      address: "Server office",
    },
  });
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action='contacts.contacts.update'",
        [scope.workspaceId],
      )
    ).rows[0].n,
  ).toBe(5);
  await expect(group()).toHaveCount(0);
  await expect(
    page.getByRole("cell", { name: "final@example.test", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/${options.kind}-recovered.png`,
  });
}
