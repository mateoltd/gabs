import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { CommandCorrectionOptions } from "./command-correction-journey";

type Scope = { userId: string; workspaceId: string };

/** Download real accepted bases, then capture each dependent write while disconnected. */
export async function captureResourceDependents({
  options,
  page,
  scope,
  headers,
  moduleId,
  action,
  parent,
  open,
}: {
  options: CommandCorrectionOptions;
  page: Page;
  scope: Scope;
  headers: Record<string, string>;
  moduleId: string;
  action: "update" | "archive";
  parent: string;
  open(): Promise<void>;
}): Promise<[string, string]> {
  const targets: [string, string] = [randomUUID(), randomUUID()];
  const version = (await options.storage(page, scope)).installed[moduleId]
    .version;
  for (const [index, id] of targets.entries()) {
    const name = index
      ? "Unselected existing record"
      : "Selected existing record";
    const created = await options.api.post(
      `/api/v1/module/${moduleId}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": version,
        },
        data: {
          action: "create",
          resource: "notes",
          input: { id, data: { name } },
        },
      },
    );
    expect(created.ok(), await created.text()).toBe(true);
    await options.reconnect();
    await open();
    await expect
      .poll(
        async () =>
          (await options.storage(page, scope)).journal.find(
            (entry) => entry.id === parent,
          )?.state,
      )
      .toBe("rejected");
    await page
      .getByLabel("Prerequisite identity", { exact: true })
      .fill(parent);
    await page.getByLabel("Accepted record identity", { exact: true }).fill(id);
    await page
      .getByRole("button", { name: "Load accepted record", exact: true })
      .click();
    await expect(
      page.getByText(`Loaded server version 1: ${name}`, { exact: true }),
    ).toBeVisible();
    await options.offline(true);
    await page
      .getByLabel("Note name", { exact: true })
      .fill(index ? "Unselected foreign command" : "Selected foreign command");
    await page
      .getByRole("button", { name: `Save pending ${action}`, exact: true })
      .click();
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
    const stored = await options.storage(page, scope);
    const entry = stored.journal[index + 1];
    expect(entry).toMatchObject({
      state: "pending",
      attempts: 0,
      delivery: "unsubmitted",
      dependencies: [parent],
      call: { action, moduleId, input: { id, baseVersion: 1 } },
    });
    if (action === "update")
      expect(entry.call.input).toMatchObject({
        baseData: { name },
        data: {
          name: index
            ? "Unselected foreign command"
            : "Selected foreign command",
        },
      });
    expect(
      (
        await options.pool.query(
          "select version, archived, data from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3",
          [scope.workspaceId, moduleId, id],
        )
      ).rows[0],
    ).toMatchObject({ version: 1, archived: false, data: { name } });
  }
  return targets;
}

/** Repeated SDK/HTTP receipt lookups must not repeat either a selected effect or its audit. */
export async function verifyResourceDependents({
  options,
  scope,
  parentModuleId,
  moduleId,
  action,
  targets,
}: {
  options: CommandCorrectionOptions;
  scope: Scope;
  parentModuleId: string;
  moduleId: string;
  action: "update" | "archive";
  targets: [string, string];
}) {
  const records = (
    await options.pool.query(
      "select id, version, archived, data from suite.module_records where workspace_id=$1 and module_id=$2",
      [scope.workspaceId, moduleId],
    )
  ).rows;
  expect(records).toHaveLength(2);
  expect(records.find((row) => row.id === targets[0])).toMatchObject({
    version: 2,
    archived: action === "archive",
    data: {
      name:
        action === "update"
          ? "Selected foreign command"
          : "Selected existing record",
    },
  });
  expect(records.find((row) => row.id === targets[1])).toMatchObject({
    version: 1,
    archived: false,
    data: { name: "Unselected existing record" },
  });
  expect(
    (
      await options.pool.query(
        "select data from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, parentModuleId],
      )
    ).rows,
  ).toEqual([{ data: { name: "Corrected parent" } }]);
  expect(
    (
      await options.pool.query(
        "select action, count(*)::int n from suite.audit where workspace_id=$1 and action=any($2::text[]) group by action order by action",
        [
          scope.workspaceId,
          [
            `${moduleId}.notes.create`,
            `${moduleId}.notes.${action}`,
            `${parentModuleId}.notes.create`,
          ],
        ],
      )
    ).rows,
  ).toEqual(
    [
      { action: `${moduleId}.notes.${action}`, n: 1 },
      { action: `${moduleId}.notes.create`, n: 2 },
      { action: `${parentModuleId}.notes.create`, n: 1 },
    ].sort((a, b) => a.action.localeCompare(b.action)),
  );
}
