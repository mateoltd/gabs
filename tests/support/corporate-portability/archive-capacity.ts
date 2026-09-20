import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { publishExecutableFixture } from "../executable-fixture";
import module from "../../fixtures/queued-resources/module";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";
import { captureArchive } from "./archives";
import {
  openSavedWorkArchive,
  savedWorkFingerprint,
} from "../../../packages/client/src/recovery/archive";

/** Actual UI captures exceed both admission limits; each batch preserves earlier work. */
export async function archiveCapacity(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  directory: string;
  surface: string;
  offline(value: boolean): Promise<void>;
  exportFile(button: Locator, path: string): Promise<void>;
  replaceDevice(): Promise<Page>;
}) {
  let page = options.page;
  const moduleId = `archive-capacity-${randomUUID().slice(0, 8)}`;
  const name = "Archive capacity notes";
  await publishExecutableFixture({
    id: moduleId,
    name,
    sourceDirectory: "tests/fixtures/queued-resources",
    transform: (filename, source) => {
      if (filename !== "module.ts") return source;
      // This independently signed module explicitly supports large note text.
      // Keep the SDK default and all archive/admission limits unchanged.
      const field = "field.text({ minLength: 1 })";
      if (!source.includes(field)) throw Error("Note field fixture changed");
      return source.replace(
        field,
        "field.text({ minLength: 1, maxLength: 250000 })",
      );
    },
  });
  const me = await (await options.api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const created = await options.api.post("/api/v1/workspaces", {
    headers: {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: {
      id: scope.workspaceId,
      name: "Archive capacity acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await options.pool.query(
    "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
    [scope.workspaceId, moduleId],
  );
  await options.pool.query(
    "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
    [scope.workspaceId, moduleId],
  );
  await options.pool.query(
    "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
    [scope.workspaceId, moduleId],
  );
  await options.pool.query(
    "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      scope.workspaceId,
      module.permissions.map((permission) =>
        permission.replaceAll(module.id, moduleId),
      ),
    ],
  );
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const enable = async () => {
    await page.reload();
    await selectValue(page, "Workspace", scope.workspaceId);
    await settings();
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
  const close = async () => {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await enable();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByLabel("Note name", { exact: true })).toBeVisible();
  await options.offline(true);
  const names = [
    ...Array.from(
      { length: 33 },
      (_, index) => `Small saved note ${index + 1}`,
    ),
    ...Array.from(
      { length: 5 },
      (_, index) => `Large note ${index + 1} ` + String(index).repeat(220000),
    ),
  ];
  for (const text of names) {
    await page.getByLabel("Note name", { exact: true }).fill(text);
    await page
      .getByRole("button", { name: "Save pending note", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await page.getByLabel("Note name", { exact: true }).inputValue())
            .length,
      )
      .toBe(0);
  }
  const source = await portabilityStorage(page, scope);
  expect(source.journal).toHaveLength(names.length);
  for (const [index, text] of names.entries())
    expect(source.journal[index].call).toMatchObject({
      action: "create",
      input: { data: { name: text } },
    });
  await settings();
  await page
    .getByRole("button", { name: "Saved-work archives", exact: true })
    .click();
  const archive = () =>
    page.getByRole("dialog", { name: "Saved-work archives", exact: true });
  await archive()
    .getByRole("button", { name: "Load saved work", exact: true })
    .click();
  await expect(archive().getByRole("checkbox")).toHaveCount(names.length);
  for (const checkbox of await archive().getByRole("checkbox").all())
    await checkbox.check();
  const passphrase = "archive capacity acceptance passphrase";
  await archive()
    .getByLabel("Archive passphrase", { exact: true })
    .fill(passphrase);
  await archive()
    .getByLabel("Confirm archive passphrase", { exact: true })
    .fill(passphrase);
  const path = resolve(options.directory, "capacity-archive.json");
  await options.exportFile(
    archive().getByRole("button", {
      name: "Save encrypted archive",
      exact: true,
    }),
    path,
  );
  const bytes = await readFile(path);
  const decoded = await openSavedWorkArchive(
    bytes.toString(),
    passphrase,
    scope,
    () => {},
  );
  expect(decoded.copies).toHaveLength(names.length);
  for (const [index, copy] of decoded.copies.entries()) {
    expect(copy.selection).toBe("request");
    if (copy.selection !== "request")
      throw Error("Expected a request snapshot");
    expect(copy.entry).toEqual(source.journal[index]);
  }
  const digests = await Promise.all(decoded.copies.map(savedWorkFingerprint));
  page = await options.replaceDevice();
  await enable();
  const read = () => portabilityStorage(page, scope);
  const empty = await read();
  expect(empty?.recoveryImports ?? {}).toEqual({});
  const open = async () => {
    await page
      .getByRole("button", { name: "Saved-work archives", exact: true })
      .click();
    await archive()
      .getByRole("button", { name: "Open archive", exact: true })
      .click();
    await archive()
      .getByLabel("Encrypted saved-work archive", { exact: true })
      .setInputFiles(path);
    await archive()
      .getByLabel("Archive passphrase", { exact: true })
      .fill(passphrase);
    await archive()
      .getByRole("button", { name: "Unlock archive", exact: true })
      .click();
    await expect(archive().getByRole("checkbox")).toHaveCount(names.length);
  };
  const choose = async (indices: number[]) => {
    const checkboxes = archive().getByRole("checkbox");
    for (let i = 0; i < names.length; i++)
      await checkboxes.nth(i).setChecked(indices.includes(i));
  };
  const admit = () =>
    archive().getByRole("button", {
      name: "Import selected copies",
      exact: true,
    });
  const expectCount = async (count: number) => {
    expect(Object.keys((await read())?.recoveryImports ?? {})).toHaveLength(
      count,
    );
    expect(await readFile(path)).toEqual(bytes);
  };
  await open();
  await choose(Array.from({ length: 33 }, (_, i) => i));
  await expect(admit()).toBeDisabled();
  await admit().scrollIntoViewIfNeeded();
  await captureArchive(page, `${options.surface}-capacity-count`, false);
  await expectCount(0);
  await choose([33, 34, 35, 36, 37]);
  expect(
    Buffer.byteLength(JSON.stringify(decoded.copies.slice(33))),
  ).toBeGreaterThan(1024 * 1024);
  await expect(admit()).toBeEnabled();
  await admit().click();
  await expect(archive().getByRole("alert")).toContainText(
    "Selected recovery copies exceed the 1 MiB admission limit",
  );
  await expectCount(0);
  await choose(Array.from({ length: 32 }, (_, i) => i));
  await admit().click();
  await expect(archive().getByRole("status")).toContainText(
    "32 copies imported",
  );
  await expectCount(32);
  const firstBatch = (await read()).recoveryImports;
  await choose([32]);
  await admit().click();
  await expect(archive().getByRole("alert")).toContainText(
    "Saved-work import storage is full",
  );
  expect((await read()).recoveryImports).toEqual(firstBatch);
  await archive().getByRole("alert").scrollIntoViewIfNeeded();
  await captureArchive(page, `${options.surface}-capacity-full`, false);
  await close();
  await page.reload();
  expect((await read()).recoveryImports).toEqual(firstBatch);

  const restoreAndRemove = async (index: number) => {
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    const imported = page.getByRole("dialog", {
      name: "Imported saved work",
      exact: true,
    });
    const copy = imported.locator(`[data-recovery-copy="${digests[index]}"]`);
    await copy
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await imported
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(copy).toContainText(
      "Restored. The imported copy is retained separately.",
    );
    await expect(
      imported.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
    const restored = (await read()).journal.find(
      (entry) => entry.id === source.journal[index].id,
    )!;
    expect(restored.call).toEqual(source.journal[index].call);
    expect(restored.settlement).toBe("cancelled");
    await copy
      .getByRole("button", { name: "Remove imported copy", exact: true })
      .click();
    await expect(imported).toContainText(
      "Restored requests, drafts and the original file stay in place",
    );
    await imported
      .getByRole("button", { name: "Confirm removal", exact: true })
      .click();
    await expect(
      imported.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(imported.getByRole("status")).toContainText(
      "Imported copy removed. Other saved work was preserved.",
    );
    await expect(copy).toHaveCount(0);
    expect(
      (await read()).journal.find((entry) => entry.id === restored.id),
    ).toEqual(restored);
    await close();
  };
  const add = async (indices: number[]) => {
    await open();
    await choose(indices);
    await admit().click();
    await expect(archive().getByRole("status")).toContainText(
      `${indices.length} ${indices.length === 1 ? "copy" : "copies"} imported`,
    );
    await close();
  };
  await restoreAndRemove(0);
  await add([32]);
  await expectCount(32);
  for (const index of [1, 2, 3, 4]) await restoreAndRemove(index);
  await add([33, 34, 35, 36]);
  await expectCount(32);
  await restoreAndRemove(5);
  const beforeBytes = (await read()).recoveryImports!;
  expect(Object.keys(beforeBytes)).toHaveLength(31);
  expect(Buffer.byteLength(JSON.stringify(beforeBytes))).toBeLessThan(
    1024 * 1024,
  );
  await open();
  await choose([37]);
  await admit().click();
  await expect(archive().getByRole("alert")).toContainText(
    "Saved-work import storage is full",
  );
  expect((await read()).recoveryImports).toEqual(beforeBytes);
  await close();
  await restoreAndRemove(33);
  await add([37]);
  await expectCount(31);
  await page.reload();
  const final = await read();
  for (const [index, copy] of decoded.copies.entries()) {
    const retained = final.recoveryImports?.[digests[index]];
    if (retained) expect(retained.input).toEqual(copy);
    else
      expect(
        final.journal.find((entry) => entry.id === source.journal[index].id)
          ?.call,
      ).toEqual(source.journal[index].call);
  }
  expect(
    (
      await options.pool.query(
        "select count(*)::int n from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, moduleId],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(await readFile(path)).toEqual(bytes);
}
