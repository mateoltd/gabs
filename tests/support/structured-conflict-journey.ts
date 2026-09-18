import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ResourceRecord } from "@suite/module-sdk";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { resourceDraftKey } from "../../packages/client/src/modules/drafts";
import { selectValue } from "../e2e/controls.helpers";
import { publishExecutableFixture } from "./executable-fixture";

export async function structuredConflictJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restart(): Promise<Page>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const id = "structured-review";
  const artifact = await publishExecutableFixture({
    id,
    sourceDirectory: "tests/fixtures/conflict-review",
  });
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
    "x-module-version": String(artifact.artifact.version),
  };
  const created = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Structured conflict acceptance",
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
    "insert into suite.module_assignments(workspace_id,membership_id,module_id) select workspace_id,id,$2 from suite.memberships where workspace_id=$1",
    [scope.workspaceId, id],
  );
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [
      scope.workspaceId,
      ["records", "targets"].flatMap((r) =>
        ["read", "write"].map((a) => `${id}.${r}.${a}`),
      ),
    ],
  );
  const command = async (
    resource: string,
    action: string,
    input: Record<string, unknown>,
  ) => {
    const response = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
      {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: { resource, action, input },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as ResourceRecord;
  };
  const [a, b, c] = await Promise.all(
    ["Original contact", "Local contact", "Server contact"].map((name) =>
      command("targets", "create", { data: { name } }),
    ),
  );
  const original = await command("records", "create", {
    data: {
      name: "Original record",
      details: { note: "Original details", contact: a.id },
      links: [{ contact: a.id, note: "Original link" }],
      routes: { "a/b~c": [a.id, 0] },
      delivery: { kind: "linked", contact: a.id, note: "Original delivery" },
      optional: { note: "Original optional" },
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
  const navigate = async () => {
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Structured review", exact: true })
      .click();
  };
  await navigate();
  const row = page.getByRole("row").filter({
    has: page.getByRole("cell", { name: "Original record", exact: true }),
  });
  await row.getByRole("button", { name: "Edit", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Linked contact", exact: true }),
  ).toContainText("Original contact");
  // Wait for the authorized target page to be persisted before going offline.
  await expect
    .poll(async () =>
      JSON.stringify((await options.storage(page, scope)).referenceOptions),
    )
    .toContain("Local contact");
  await options.offline(true);
  await dialog
    .getByLabel("Details note", { exact: true })
    .fill("Local details");
  await selectValue(page, "Linked contact", b.id);
  await dialog.getByLabel("Link note", { exact: true }).fill("Local link");
  await dialog.getByLabel("Priority", { exact: true }).fill("7");
  await dialog
    .getByLabel("Delivery note", { exact: true })
    .fill("Local delivery");
  await dialog
    .getByRole("button", { name: "Remove optional", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  const local = (await options.storage(page, scope)).journal[0].call.input as {
    data: Record<string, unknown>;
  };
  expect(local.data).toMatchObject({
    links: [{ contact: b.id, note: "Local link" }],
    routes: { "a/b~c": [a.id, 7] },
  });
  expect(Object.hasOwn(local.data, "optional")).toBe(false);
  const remote = await command("records", "update", {
    id: original.id,
    baseVersion: original.version,
    data: {
      name: "Server renamed record",
      details: { note: "Server details", contact: c.id },
      links: [
        { contact: c.id, note: "Server link" },
        { contact: a.id, note: "Server added link" },
      ],
      routes: { "a/b~c": [c.id, 9], extra: [c.id, 1] },
      delivery: { kind: "text", note: "Server plain delivery" },
      optional: { note: "Server optional" },
    },
  });
  await options.offline(false);
  await expect
    .poll(async () => (await options.storage(page, scope)).journal[0]?.state)
    .toBe("conflict");
  await page.getByRole("button", { name: "Review", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  const comparison = () =>
    dialog.getByRole("region", { name: "Conflict comparison", exact: true });
  const expand = async () => {
    await expect(comparison()).toBeVisible();
    for (let i = 0; i < 80; i++) {
      const closed = comparison().locator(
        "details:not([open]) > summary:visible",
      );
      if (!(await closed.count())) return;
      await closed.first().click();
    }
    throw Error("Structured comparison did not fully expand.");
  };
  await expand();
  await expect(comparison()).toContainText("whole field");
  await expect(
    comparison().getByRole("group", { name: "Links", exact: true }),
  ).toContainText("Local contact");
  await expect(
    comparison().getByRole("group", { name: "Details", exact: true }),
  ).toContainText("Server contact");
  await expect(
    comparison().getByText("Local contact", { exact: true }).first(),
  ).toBeVisible();
  await expect(comparison()).not.toContainText(a.id);
  await expect(comparison()).not.toContainText(b.id);
  await expect(comparison()).not.toContainText(c.id);
  await expect(
    dialog.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await mkdir("docs/verification/structured-conflicts", { recursive: true });
  await comparison()
    .getByRole("group", { name: "Links", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/structured-conflicts/${options.kind}-comparison.png`,
  });
  // Retain partially made choices across restart, not only the completed review.
  await selectValue(page, "Use value for details", "remote");
  await selectValue(page, "Use value for links", "local");
  const entryId = (await options.storage(page, scope)).journal[0].id;
  const draftKey = resourceDraftKey(id, "records", { entryId });
  await expect
    .poll(
      async () =>
        (await options.storage(page, scope)).draftReviews?.[draftKey]
          ?.comparison?.choices,
    )
    .toEqual({ details: "remote", links: "local" });
  page = await options.restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  if (
    !(await page
      .getByRole("button", { name: "Resume review", exact: true })
      .isVisible())
  )
    await navigate();
  await options.offline(true);
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Edit record", exact: true });
  await expand();
  await expect(
    comparison().getByRole("group", { name: "Links", exact: true }),
  ).toContainText("Local contact");
  await expect(
    dialog.getByRole("combobox", {
      name: "Use value for details",
      exact: true,
    }),
  ).toContainText("Server value");
  await expect(
    dialog.getByRole("button", { name: "Save pending change", exact: true }),
  ).toBeDisabled();
  for (const field of ["routes", "delivery", "optional"])
    await selectValue(page, `Use value for ${field}`, "local");
  await expect(dialog.getByLabel("Details note", { exact: true })).toHaveValue(
    "Server details",
  );
  await expect(dialog.getByLabel("Priority", { exact: true })).toHaveValue("7");
  await expect(dialog.getByLabel("Delivery note", { exact: true })).toHaveValue(
    "Local delivery",
  );
  await expect(dialog.getByLabel("Optional note", { exact: true })).toHaveCount(
    0,
  );
  await options.narrow();
  const routes = comparison().getByRole("group", {
    name: "Routes",
    exact: true,
  });
  await expand();
  await routes.scrollIntoViewIfNeeded();
  await expect
    .poll(() => dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1))
    .toBe(true);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode()
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/structured-conflicts/${options.kind}-narrow.png`,
  });
  await options.wide();
  // A real target-read revocation must invalidate downloaded labels without losing choices.
  await pool.query(
    "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1 and protected",
    [scope.workspaceId, `${id}.targets.read`],
  );
  await options.offline(false);
  await expect(
    comparison().getByText("Reference unavailable", { exact: true }).first(),
  ).toBeVisible();
  await expect(comparison()).not.toContainText("Original contact");
  await expect(comparison()).not.toContainText("Local contact");
  await expect(comparison()).not.toContainText("Server contact");
  await expect
    .poll(async () =>
      JSON.stringify((await options.storage(page, scope)).referenceOptions),
    )
    .not.toContain("Local contact");
  await options.offline(true);
  await expect(
    comparison().getByText("Reference unavailable", { exact: true }).first(),
  ).toBeVisible();
  await pool.query(
    "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
    [scope.workspaceId, [`${id}.targets.read`]],
  );
  await options.offline(false);
  await expect(
    comparison().getByText("Local contact", { exact: true }).first(),
  ).toBeVisible();
  await options.offline(true);
  // Server changes a disjoint field after the comparison snapshot was saved.
  const newer = await command("records", "update", {
    id: original.id,
    baseVersion: remote.version,
    data: { ...remote.data, name: "Newest server name" },
  });
  await dialog
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await options.offline(false);
  await expect
    .poll(async () =>
      (await options.storage(page, scope)).journal.map((e) => e.state),
    )
    .toEqual(["conflict", "accepted"]);
  const data = {
    name: "Newest server name",
    details: remote.data.details,
    links: local.data.links,
    routes: local.data.routes,
    delivery: local.data.delivery,
  };
  const stored = await pool.query(
    "select data,version from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3",
    [scope.workspaceId, id, original.id],
  );
  expect(stored.rows).toEqual([{ data, version: newer.version + 1 }]);
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.records.update`],
      )
    ).rows[0].n,
  ).toBe(3);
  const state = await options.storage(page, scope);
  expect(state.journal[0].supersededBy).toBe(state.journal[1].id);
  expect(state.draftReviews?.[draftKey]).toBeUndefined();
  await expect(
    page.getByRole("cell", { name: "Newest server name", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/verification/structured-conflicts/${options.kind}-recovered.png`,
  });
}
