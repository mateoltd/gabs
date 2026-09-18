import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";

export async function resourceHostJourney(options: CommandCorrectionOptions) {
  let page = options.page;
  const { api, pool } = options;
  const removed = options.mode === "resource-viewless";
  const id = `recover-${randomUUID().slice(0, 8)}`,
    name = `Recovery notes ${id.slice(-8)}`;
  const pkg = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/resource-recovery",
  });
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
      name: "Resource recovery acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [scope.workspaceId, id],
  );
  await pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [scope.workspaceId, id],
  );
  await pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [scope.workspaceId, id],
  );
  await pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      scope.workspaceId,
      [`${id}.open`, `${id}.notes.read`, `${id}.notes.write`],
    ],
  );
  const record = await api.post(
    `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
    {
      headers: { ...headers, "x-module-version": pkg.version },
      data: {
        action: "create",
        resource: "notes",
        input: { id: randomUUID(), data: { name: "Original record" } },
      },
    },
  );
  expect(record.ok(), await record.text()).toBe(true);
  const original = await record.json();
  const storage = () => options.storage(page, scope);
  const journal = async () =>
    (await storage()).journal.filter((entry) => entry.call.moduleId === id);
  const settings = async () => {
    await page.evaluate(() => {
      const state = window as typeof window & {
        recoveryNavigation?: unknown[];
      };
      if (!state.recoveryNavigation) {
        state.recoveryNavigation = [];
        for (const method of ["pushState", "replaceState"] as const) {
          const original = history[method].bind(history);
          history[method] = (...args) => {
            state.recoveryNavigation!.push({
              method,
              from: location.href,
              to: args[2],
            });
            return original(...args);
          };
        }
      }
      state.recoveryNavigation.push({ settingsClick: location.href });
    });
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  };
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Original record", exact: true }),
  ).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
  await options.offline(true);
  await page.getByRole("button", { name: "New notes", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Preserved create");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("row")
    .filter({
      has: page.getByRole("cell", { name: "Original record", exact: true }),
    })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Preserved update");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "New notes", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Never submitted draft");
  await expect
    .poll(async () => (await storage()).drafts[`${id}/notes`]?.name)
    .toBe("Never submitted draft");
  await page.keyboard.press("Escape");
  const before = await journal(),
    beforeDrafts = (await storage()).drafts;
  expect(before.map((entry) => entry.call.action)).toEqual([
    "create",
    "update",
  ]);
  const acceptedReply = await api.post(
    `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": before[0].id,
        "x-module-version": pkg.version,
      },
      data: {
        action: before[0].call.action,
        resource: "notes",
        input: before[0].call.input,
      },
    },
  );
  expect(acceptedReply.ok(), await acceptedReply.text()).toBe(true);
  const accepted = await acceptedReply.json();
  const next = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/resource-recovery",
    transform: (file, source) =>
      file === "module.ts"
        ? source
            .replace(/  navigation:.*\n/, "")
            .replace(
              removed ? /    notes: resource\(.*\n/ : /title: "Notes"/,
              removed ? "" : 'title: "Current notes"',
            )
        : source,
  });
  const rollout = await api.post(
    `/api/v1/workspaces/${scope.workspaceId}/platform`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "rollout",
        version: 0,
        value: {
          moduleId: id,
          version: next.version,
          mandatory: false,
          acceptedVersions: [pkg.version],
        },
      },
    },
  );
  expect(rollout.ok(), await rollout.text()).toBe(true);
  // Leave the generated synchronizer before reconnecting; recovery itself must never dispatch.
  await settings();
  await options.reconnect();
  await page.reload();
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page
    .locator(".module-install-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toContainText(`Version ${next.version}`);
  const update = card.getByRole("button", { name: "Update", exact: true });
  if (await update.isVisible()) await update.click();
  await expect(card).toContainText(`Installed ${next.version}`);
  if (!removed) {
    await card.getByRole("button", { name: "Uninstall", exact: true }).click();
    await expect(
      card.getByText("Not installed on this device", { exact: true }),
    ).toBeVisible();
  }
  const inbox = async () => {
    await settings();
    try {
      await page
        .getByRole("button", { name: /^Saved records and drafts/ })
        .click();
    } catch (error) {
      const stored = await storage();
      console.error(
        "Resource recovery diagnostic",
        JSON.stringify({
          kind: options.kind,
          mode: options.mode,
          navigation: await page.evaluate(
            () =>
              (window as typeof window & { recoveryNavigation?: unknown[] })
                .recoveryNavigation,
          ),
          text: (await page.locator("body").innerText()).slice(0, 9000),
          entries: stored.journal.map((entry) => ({
            id: entry.id,
            module: entry.call.moduleId,
            action: entry.call.action,
            state: entry.state,
          })),
          drafts: Object.keys(stored.drafts),
          installed: Object.keys(stored.installed),
          recoveryVersions: stored.recoveryVersions,
          native:
            options.kind === "native"
              ? await page.evaluate(async (scope) => {
                  const snapshot = (await window.suiteDesktop!.cacheRead(
                    scope,
                    "snapshot",
                  )) as
                    | import("../../packages/client/src/index").Snapshot
                    | undefined;
                  return {
                    online: navigator.onLine,
                    bootstrap: snapshot?.bootstrap,
                  };
                }, scope)
              : undefined,
        }),
      );
      throw error;
    }
    const dialog = page.getByRole("dialog", {
      name: "Records and drafts",
      exact: true,
    });
    await expect(dialog).toHaveClass(/is-open/);
    return dialog;
  };
  await pool.query(
    "update suite.roles set permissions=array_remove(array_remove(permissions,$2),$3) where workspace_id=$1",
    [scope.workspaceId, `${id}.notes.write`, `${id}.open`],
  );
  await page.reload();
  await settings();
  await expect(
    page.getByRole("button", { name: /^Saved records and drafts/ }),
  ).toHaveCount(0);
  await pool.query(
    "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and protected",
    [scope.workspaceId, `${id}.notes.write`],
  );
  await page.reload();
  let dialog = await inbox();
  await expect(
    dialog.getByRole("heading", { name: "Notes: draft", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await options.offline(true);
  page = await options.restartOffline();
  dialog = await inbox();
  const change = (action: string) =>
    dialog.locator("li").filter({
      has: page.getByRole("heading", {
        name: `Notes: ${action}`,
        exact: true,
      }),
    });
  await change("update")
    .getByText("View saved change", { exact: true })
    .click();
  await expect(change("update")).toContainText("Original record");
  await expect(change("update")).toContainText("Preserved update");
  await change("draft").getByText("View saved draft", { exact: true }).click();
  await expect(change("draft")).toContainText("Never submitted draft");
  await expect(
    change("create").getByRole("button", {
      name: "Resolve record outcome",
      exact: true,
    }),
  ).toBeDisabled();
  await mkdir("docs/verification/resource-recovery-host", { recursive: true });
  await options.narrow();
  expect(
    await dialog.evaluate((element) => {
      const title = element.querySelector("h2")!.getBoundingClientRect();
      const close = element
        .querySelector('[aria-label="Close dialog"]')!
        .getBoundingClientRect();
      return title.right + 8 <= close.left;
    }),
  ).toBe(true);
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
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
  await page.screenshot({
    path: `docs/verification/resource-recovery-host/${options.kind}-${removed ? "removed" : "uninstalled"}-offline.png`,
  });
  await change("draft")
    .getByText("Never submitted draft", { exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    change("draft").getByText("Never submitted draft", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/verification/resource-recovery-host/${options.kind}-${removed ? "removed" : "uninstalled"}-draft.png`,
  });
  await options.wide();
  await page.keyboard.press("Escape");
  await options.reconnect();
  await page.reload();
  dialog = await inbox();
  const settle = async (action: string) => {
    await change(action)
      .getByRole("button", { name: "Resolve record outcome", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Resolve record outcome", exact: true })
      .getByRole("button", {
        name: "Recover record result or stop retries",
        exact: true,
      })
      .click();
  };
  await options.loseSettlementReply();
  await settle("create");
  await expect(
    page
      .getByRole("dialog", { name: "Resolve record outcome", exact: true })
      .getByRole("alert"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await options.offline(true);
  page = await options.restartOffline();
  await options.reconnect();
  await page.reload();
  dialog = await inbox();
  await settle("create");
  await expect.poll(async () => (await journal())[0].state).toBe("accepted");
  await settle("update");
  await expect
    .poll(async () => (await journal())[1].settlement)
    .toBe("cancelled");
  await options.offline(true);
  page = await options.restartOffline();
  dialog = await inbox();
  await expect(change("create")).toContainText("Accepted");
  await expect(change("update")).toContainText("Original request stopped");
  const final = await journal();
  expect(final[0].result).toEqual(accepted);
  expect(final.map((entry) => entry.call)).toEqual(
    before.map((entry) => entry.call),
  );
  expect(final.map((entry) => entry.attempts)).toEqual([0, 0]);
  expect((await storage()).drafts).toEqual(beforeDrafts);
  if (!removed) expect((await storage()).installed[id]).toBeUndefined();
  const rows = await pool.query(
    "select id,data,version from suite.module_records where workspace_id=$1 and module_id=$2 order by id",
    [scope.workspaceId, id],
  );
  expect(rows.rows).toHaveLength(2);
  expect(rows.rows.find((row) => row.id === original.id)).toMatchObject({
    data: { name: "Original record" },
    version: 1,
  });
  await options.narrow();
  expect(
    await dialog.evaluate((element) => {
      const title = element.querySelector("h2")!.getBoundingClientRect();
      const close = element
        .querySelector('[aria-label="Close dialog"]')!
        .getBoundingClientRect();
      return title.right + 8 <= close.left;
    }),
  ).toBe(true);
  await page.screenshot({
    path: `docs/verification/resource-recovery-host/${options.kind}-${removed ? "removed" : "uninstalled"}-recovered.png`,
  });
}
