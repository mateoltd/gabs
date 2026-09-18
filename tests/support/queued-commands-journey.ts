import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { publishExecutableFixture } from "./executable-fixture";
import { assignHostFixture } from "./host-capability-journey";
import { selectValue } from "../e2e/controls.helpers";
import module from "../fixtures/queued-notes/module";

export async function queuedCommandsJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  workspaceOnly?: boolean;
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  reconnect(): Promise<void>;
  loseReply(key: string): Promise<void>;
  dispatched(): Promise<string[]>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const id = `queued-${randomUUID().slice(0, 8)}`;
  const pkg = await publishExecutableFixture({
    id,
    name: "Queued notes",
    sourceDirectory: "tests/fixtures/queued-notes",
  });
  expect(pkg.manifest.clientRequirements).toMatchObject({
    home: { "client.queue": 1 },
  });
  const otherId = options.workspaceOnly
    ? `queued-other-${randomUUID().slice(0, 8)}`
    : undefined;
  if (otherId)
    await publishExecutableFixture({
      id: otherId,
      name: "Other queued notes",
      sourceDirectory: "tests/fixtures/queued-notes",
    });
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
      name: "Queued command acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await assignHostFixture(pool, scope.workspaceId, id);
  if (otherId) await assignHostFixture(pool, scope.workspaceId, otherId);
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      scope.workspaceId,
      [id, ...(otherId ? [otherId] : [])].flatMap((id) =>
        module.permissions.map((p) => p.replaceAll(module.id, id)),
      ),
    ],
  );
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  const open = async () => {
    await page.getByRole("link", { name: "Queued notes", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Queued notes workspace", exact: true })
        .getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeVisible();
  };
  await open();
  if (otherId) {
    await page
      .getByRole("link", { name: "Other queued notes", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", {
          name: "Other queued notes workspace",
          exact: true,
        })
        .getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await options.storage(page, scope)).installed[otherId]?.version,
      )
      .toBeTruthy();
    await open();
  }
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
  const capture = async (name: string) => {
    await page.getByLabel("Note name", { exact: true }).fill(name);
    await page
      .getByRole("button", { name: "Save pending note", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Saved provisionally:" }),
    ).toBeVisible();
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  };
  await capture("Keep after restart");
  await capture("Reject this note");
  await capture("Independent note");
  const journal = async () =>
    (await options.storage(page, scope)).journal.filter(
      (e) => e.call.moduleId === id,
    );
  expect(
    (await journal()).map((e) => [e.state, e.delivery, e.attempts]),
  ).toEqual(Array(3).fill(["pending", "unsubmitted", 0]));
  const originals = (await journal()).map((e) => ({ id: e.id, call: e.call }));
  if (options.workspaceOnly) {
    await page
      .getByLabel("Note name", { exact: true })
      .fill("Dependent background note");
    await page
      .getByRole("button", { name: "Save dependent note", exact: true })
      .click();
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
    const before = (await journal()).map((entry) => ({
      id: entry.id,
      call: entry.call,
      dependencies: entry.dependencies,
    }));
    expect(before[3].dependencies).toEqual([before[2].id]);
    await page
      .getByRole("link", { name: "Other queued notes", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", {
          name: "Other queued notes workspace",
          exact: true,
        })
        .getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeVisible();
    await capture("Other module pending note");
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    page = await options.restartOffline();
    // A native cold start opens Overview. Select a host route without mounting a module.
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await options.loseReply(originals[0].id);
    await options.reconnect();
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => (await journal()).map((entry) => entry.state), {
        timeout: 60000,
      })
      .toEqual(["accepted", "rejected", "accepted", "accepted"]);
    expect(
      (await journal()).map((entry) => ({
        id: entry.id,
        call: entry.call,
        dependencies: entry.dependencies,
      })),
    ).toEqual(before);
    expect((await journal())[1].businessError).toEqual({ reason: "rejected" });
    expect(
      (await options.dispatched()).filter((key) => key === originals[0].id)
        .length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (
        await pool.query(
          "select data->>'name' name from suite.module_records where workspace_id=$1 and module_id=$2 order by name",
          [scope.workspaceId, id],
        )
      ).rows.map((row) => row.name),
    ).toEqual([
      "Dependent background note",
      "Independent note",
      "Keep after restart",
    ]);
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
          [scope.workspaceId, `${id}.notes.create`],
        )
      ).rows[0].n,
    ).toBe(3);
    await expect
      .poll(async () =>
        (await options.storage(page, scope)).journal
          .filter((entry) => entry.call.moduleId === otherId)
          .map((entry) => entry.state),
      )
      .toEqual(["accepted"]);
    expect(
      (
        await pool.query(
          "select data->>'name' name from suite.module_records where workspace_id=$1 and module_id=$2",
          [scope.workspaceId, otherId],
        )
      ).rows,
    ).toEqual([{ name: "Other module pending note" }]);
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
          [scope.workspaceId, `${otherId}.notes.create`],
        )
      ).rows[0].n,
    ).toBe(1);
    await mkdir("docs/verification/workspace-synchronization", {
      recursive: true,
    });
    await page.screenshot({
      path: `docs/verification/workspace-synchronization/${options.kind}-settings.png`,
    });
    await options.narrow();
    await page.screenshot({
      path: `docs/verification/workspace-synchronization/${options.kind}-settings-narrow.png`,
    });
    return;
  }
  page = await options.restartOffline();
  await open();
  await page
    .getByRole("button", { name: "Saved commands (3)", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Saved commands",
    exact: true,
  });
  await expect(
    dialog.getByText("Pending submission", { exact: true }),
  ).toHaveCount(3);
  await dialog.getByText("View saved input", { exact: true }).first().click();
  await dialog.getByText("1 field", { exact: true }).first().click();
  await expect(dialog).toContainText("Keep after restart");
  expect((await journal()).map((e) => ({ id: e.id, call: e.call }))).toEqual(
    originals,
  );
  await mkdir("docs/verification/queued-commands", { recursive: true });
  await page.screenshot({
    path: `docs/verification/queued-commands/${options.kind}-offline.png`,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await options.loseReply(originals[0].id);
  await options.reconnect();
  await open();
  await expect
    .poll(async () => (await journal())[0].attempts)
    .toBeGreaterThan(0);
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "select count(*)::int n from suite.module_records where workspace_id=$1 and module_id=$2",
            [scope.workspaceId, id],
          )
        ).rows[0].n,
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Saved commands (3)", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Saved commands", exact: true });
  await expect(
    dialog.getByRole("button", { name: "Retry pending commands", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Retry pending commands", exact: true })
    .click();
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["accepted", "rejected", "accepted"]);
  await expect(dialog.getByText("Accepted", { exact: true })).toHaveCount(2);
  await expect(dialog.getByText("Rejected", { exact: true })).toBeVisible();
  expect((await journal()).map((e) => ({ id: e.id, call: e.call }))).toEqual(
    originals,
  );
  expect((await journal())[1].businessError).toEqual({ reason: "rejected" });
  expect(
    (await options.dispatched()).filter((key) => key === originals[0].id)
      .length,
  ).toBeGreaterThanOrEqual(2);

  const rows = await pool.query(
    "select data->>'name' as name from suite.module_records where workspace_id=$1 and module_id=$2 order by name",
    [scope.workspaceId, id],
  );
  expect(rows.rows.map((r) => r.name)).toEqual([
    "Independent note",
    "Keep after restart",
  ]);
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.notes.create`],
      )
    ).rows[0].n,
  ).toBe(2);
  await page.keyboard.press("Escape");
  await options.offline(true);
  await capture("Recover accepted result");
  const uncertainKey = (await journal())[3].id;
  await options.loseReply(uncertainKey);
  await options.reconnect();
  await open();
  await expect
    .poll(async () => (await journal())[3].delivery)
    .toBe("uncertain");
  await page
    .getByRole("button", { name: "Saved commands (4)", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Saved commands", exact: true });
  await dialog
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  const resolution = page.getByRole("dialog", {
    name: "Resolve command outcome",
    exact: true,
  });
  await resolution
    .getByRole("button", {
      name: "Recover result or stop retries",
      exact: true,
    })
    .click();
  await expect(resolution).toHaveCount(0);
  await expect.poll(async () => (await journal())[3].state).toBe("accepted");
  expect((await journal())[3].id).toBe(uncertainKey);
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, id],
      )
    ).rows[0].n,
  ).toBe(3);
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.notes.create`],
      )
    ).rows[0].n,
  ).toBe(3);
  await options.narrow();
  await page.screenshot({
    path: `docs/verification/queued-commands/${options.kind}-accepted-narrow.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await options.wide();
  await pool.query(
    "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
    [scope.workspaceId, `${id}.capture`],
  );
  await page.reload();
  await open();
  await expect(
    page.getByRole("button", { name: "Save pending note", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Saved commands (4)", exact: true }),
  ).toHaveCount(0);
  expect(await journal()).toHaveLength(4);
}
