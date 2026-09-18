import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { Pool } from "pg";
import { publishEditorFixture } from "../support/editor-fixture";
import { publishExecutableFixture } from "../support/executable-fixture";
import { publishEditableFixture } from "../support/editable-fixture";
import { selectValue } from "./controls.helpers";

async function openWorkspace(page: Page, moduleId: string, version: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const workspace = randomUUID();
  const headers = {
    origin: new URL(page.url()).origin,
    "x-csrf-token": me.csrfToken,
  };
  const created = await page.request.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { id: workspace, name: "Editor update acceptance", currency: "EUR" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const fixture = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    const permissions = (
      await fixture.query(
        "select artifact from suite.module_releases where module_id=$1 and version=$2",
        [moduleId, version],
      )
    ).rows[0].artifact.permissions;
    await fixture.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true) on conflict(workspace_id,module_id) do update set active=true",
      [workspace, moduleId],
    );
    await fixture.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}') on conflict(workspace_id,module_id) do update set state='enabled'",
      [workspace, moduleId],
    );
    await fixture.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1 on conflict do nothing",
      [workspace, moduleId],
    );
    await fixture.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and name='Owner'",
      [workspace, permissions],
    );
  } finally {
    await fixture.end();
  }
  let revision = 0;
  const policy = async (version: string) => {
    const changed = await page.request.post(
      `/api/v1/workspaces/${workspace}/platform`,
      {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: {
          action: "rollout",
          version: revision,
          value: { moduleId, version, mandatory: true, acceptedVersions: [] },
        },
      },
    );
    expect(changed.ok(), await changed.text()).toBe(true);
    revision++;
  };
  await policy(version);
  await page.reload();
  await selectValue(page, "Workspace", workspace);
  // Complete initial provisioning before manipulating the clock or changing policy.
  // Otherwise unrelated first installs can cancel or queue the update under test.
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const state = await (
    await page.request.get(`/api/v1/workspaces/${workspace}/platform`)
  ).json();
  for (const id of ["contacts", "inventory", "orders", "projects", moduleId]) {
    const name = state.modules.find((m: { id: string }) => m.id === id).name;
    const card = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", { name, exact: true }),
    });
    await expect(card.getByText(/^Installed /)).toBeVisible({ timeout: 30000 });
  }
  // Real signed-release selection, verification and receipt publication can span
  // several requests. Update assertions allow 15 seconds, independently of load budgets.
  await page.clock.install();
  return { workspace, headers, policy };
}

for (const uncertainReply of [false, true])
  test(
    uncertainReply
      ? "an uncertain generated save recovers its original receipt after a schema change"
      : "an open generated editor preserves identity and removed input across background updates without offline storage",
    async ({ page }) => {
      test.setTimeout(120000);
      const id = `editor-${randomUUID().slice(0, 8)}`,
        name = `Editor notes ${id.slice(-8)}`;
      const registry = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
        options: "-c role=suite_registry",
      });
      const admin = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      });
      try {
        await publishEditorFixture(registry, id, name);
        const { workspace, headers, policy } = await openWorkspace(
          page,
          id,
          "1.0.0",
        );
        await page.getByRole("link", { name: "Settings", exact: true }).click();
        await expect(
          page.getByRole("button", {
            name: "Enable on this device",
            exact: true,
          }),
        ).toBeVisible();
        const recordId = randomUUID();
        const created = await page.request.post(
          `/api/v1/module/${id}/workspaces/${workspace}/records`,
          {
            headers: {
              ...headers,
              "x-module-version": "1.0.0",
              "idempotency-key": randomUUID(),
            },
            data: {
              action: "create",
              resource: "notes",
              input: {
                id: recordId,
                data: { name: "Initial name", legacy: "Before" },
              },
            },
          },
        );
        expect(created.ok(), await created.text()).toBe(true);
        await page.getByRole("link", { name, exact: true }).click();
        await page.getByRole("tab", { name: "Notes", exact: true }).click();
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page
          .getByLabel("Name", { exact: true })
          .fill("Unsaved carried input");
        await page
          .getByLabel("Legacy", { exact: true })
          .fill("Keep this removed field");
        if (uncertainReply) {
          let first = true;
          await page.route(
            `**/module/${id}/workspaces/${workspace}/records`,
            async (route) => {
              if (!first || route.request().postDataJSON()?.action !== "update")
                return route.continue();
              first = false;
              const accepted = await route.fetch();
              expect(accepted.ok(), await accepted.text()).toBe(true);
              await route.abort("failed");
            },
          );
          await page.getByRole("button", { name: "Save", exact: true }).click();
          await expect(
            page.getByText(
              "The server response is uncertain. Retry this same change or resolve its outcome before editing or closing it.",
            ),
          ).toBeVisible();
        }
        const artifactRoute = `**/module/${id}/workspaces/${workspace}/artifact`;
        await page.route(artifactRoute, (route) =>
          route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              code: "RELEASE_UNAVAILABLE",
              message: "Update download unavailable",
            }),
          }),
        );
        await policy("1.1.0");
        await page.clock.fastForward(31000);
        await expect(
          page.getByRole("button", {
            name: "Retry installation",
            includeHidden: true,
          }),
        ).toHaveCount(1);
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Unsaved carried input",
        );
        await expect(page.getByLabel("Legacy", { exact: true })).toHaveValue(
          "Keep this removed field",
        );
        await page.unroute(artifactRoute);
        await page.clock.fastForward(31000);
        await expect(page.getByLabel("Category", { exact: true })).toBeVisible({
          timeout: 15000,
        });
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Unsaved carried input",
        );
        await expect(page.getByLabel("Fields removed by update")).toContainText(
          "Keep this removed field",
        );
        const download = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Export input before update" })
          .click();
        const file = await download;
        const exported = JSON.parse(
          await readFile((await file.path())!, "utf8"),
        );
        expect(exported).toMatchObject({
          kind: "module-input-recovery",
          workspaceId: workspace,
          moduleId: id,
          moduleVersion: "1.0.0",
          resource: "notes",
          status: uncertainReply ? "unconfirmed" : "unsaved",
          input: {
            id: recordId,
            baseVersion: 1,
            data: {
              name: "Unsaved carried input",
              legacy: "Keep this removed field",
            },
          },
        });
        expect(file.suggestedFilename()).toMatch(
          /^module-input-[0-9a-f-]+\.json$/,
        );
        if (uncertainReply) {
          expect(exported.pendingRequest).toMatchObject({
            moduleId: id,
            moduleVersion: "1.0.0",
            resource: "notes",
            action: "update",
            input: exported.input,
          });
          expect(exported.pendingRequest.key).toEqual(expect.any(String));
        } else expect(exported).not.toHaveProperty("pendingRequest");
        await mkdir("docs/verification/editor-updates", { recursive: true });
        expect(
          (
            await new AxeBuilder({ page })
              .include('[role="dialog"]')
              .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
              .analyze()
          ).violations,
        ).toEqual([]);
        if (!uncertainReply)
          await page.screenshot({
            path: "docs/verification/editor-updates/preserved.png",
          });
        await page.setViewportSize({ width: 390, height: 844 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        if (!uncertainReply)
          await page.screenshot({
            path: "docs/verification/editor-updates/narrow.png",
          });
        if (uncertainReply) {
          await expect(
            page.getByLabel("Category", { exact: true }),
          ).toBeDisabled();
          await page.getByRole("button", { name: "Save", exact: true }).click();
          await expect(page.getByRole("dialog")).toHaveCount(0);
          const records = await admin.query(
            "select id, version, data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='notes'",
            [workspace, id],
          );
          expect(records.rows).toEqual([
            {
              id: recordId,
              version: 2,
              data: {
                name: "Unsaved carried input",
                legacy: "Keep this removed field",
              },
            },
          ]);
          const audit = await admin.query(
            "select count(*)::int as count from suite.audit where workspace_id=$1 and action=$2",
            [workspace, `${id}.notes.update`],
          );
          expect(audit.rows[0].count).toBe(1);
          await page.setViewportSize({ width: 1280, height: 720 });
          await page.screenshot({
            path: "docs/verification/editor-updates/uncertain-recovered.png",
          });
          return;
        }
        await page
          .getByRole("button", { name: "Remove Legacy from this edit" })
          .click();
        await page.getByLabel("Category", { exact: true }).fill("Office");
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const records = await admin.query(
          "select id, version, data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='notes'",
          [workspace, id],
        );
        expect(records.rows).toEqual([
          {
            id: recordId,
            version: 2,
            data: { name: "Unsaved carried input", category: "Office" },
          },
        ]);
        await page.setViewportSize({ width: 1280, height: 720 });
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page
          .getByLabel("Name", { exact: true })
          .fill("Removed resource input");
        await policy("1.2.0");
        await page.clock.fastForward(31000);
        await expect(
          page
            .getByRole("alert")
            .filter({ hasText: "This release removed notes" }),
        ).toBeVisible({ timeout: 15000 });
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Removed resource input",
        );
        await expect(
          page.getByRole("button", { name: "Save", exact: true }),
        ).toBeDisabled();
        const removedDownload = page.waitForEvent("download");
        await page
          .getByRole("button", { name: "Export input before update" })
          .click();
        const removedFile = await removedDownload;
        expect(
          JSON.parse(await readFile((await removedFile.path())!, "utf8")),
        ).toMatchObject({
          moduleVersion: "1.1.0",
          resource: "notes",
          input: {
            id: recordId,
            baseVersion: 2,
            data: { name: "Removed resource input" },
          },
        });
        await page.screenshot({
          path: "docs/verification/editor-updates/removed-resource.png",
        });
        await page.keyboard.press("Escape");
        await expect(
          page.getByRole("button", { name: "New other", exact: true }),
        ).toBeEnabled();
      } finally {
        await registry.end();
        await admin.end();
      }
    },
  );

test("a custom module keeps its running editor until an explicit discard and update", async ({
  page,
}) => {
  test.setTimeout(120000);
  const id = `custom-editor-${randomUUID().slice(0, 8)}`,
    name = `Custom editor ${id.slice(-8)}`;
  const first = await publishExecutableFixture({ id, name });
  const second = await publishExecutableFixture({ id, name });
  const { policy } = await openWorkspace(page, id, first.version);
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Custom input to preserve");
  await policy(second.version);
  await page.clock.fastForward(31000);
  await expect(
    page.getByRole("button", { name: "Review module update" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Custom input to preserve",
  );
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "no longer accepted" }),
  ).toBeVisible();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Custom input to preserve",
  );
  await page.getByRole("button", { name: "Review module update" }).click();
  await page.getByRole("button", { name: "Keep current view" }).click();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Custom input to preserve",
  );
  await mkdir("docs/verification/editor-updates", { recursive: true });
  await page.screenshot({
    path: "docs/verification/editor-updates/custom-staged.png",
  });
  await page.getByRole("button", { name: "Review module update" }).click();
  await page
    .getByRole("button", { name: "Discard unsaved input and update" })
    .click();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Saved after explicit update");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByText("Saved after explicit update", { exact: true }),
  ).toBeVisible();
});

test("typed custom-view state survives compatible updates and validates publisher conversion before replacement", async ({
  page,
}) => {
  test.setTimeout(120000);
  const id = `editable-${randomUUID().slice(0, 8)}`,
    name = `Editable notes ${id.slice(-8)}`;
  const first = await publishEditableFixture(id, name);
  const compatible = await publishEditableFixture(id, name);
  const invalid = await publishEditableFixture(id, name, 2, true);
  const brokenView = await publishEditableFixture(id, name, 2, false, true);
  const converted = await publishEditableFixture(id, name, 2);
  const { policy, workspace } = await openWorkspace(page, id, first.version);
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Accepted before updating");
  let releaseReply!: () => void;
  const reply = new Promise<void>((resolve) => {
    releaseReply = resolve;
  });
  let accepted!: () => void;
  const committed = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  const operationRoute = `**/module/${id}/workspaces/${workspace}/operations/capture`;
  await page.route(operationRoute, async (route) => {
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBe(true);
    accepted();
    await reply;
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await committed;
  await policy(compatible.version);
  // Focus triggers the real installation refresh without expiring the held
  // HTTP request's 20-second timeout through artificial clock advancement.
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(
    page.getByText(
      `Version ${compatible.version} is ready. Your current view remains open.`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Review module update" }).click();
  await expect(
    page.getByRole("button", { name: "Update and keep input" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Discard unsaved input and update" }),
  ).toBeDisabled();
  releaseReply();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  await page.unroute(operationRoute);
  await page.getByRole("button", { name: "Keep current view" }).click();
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Input carried through custom releases");
  await page.getByRole("button", { name: "Review module update" }).click();
  await page.getByRole("button", { name: "Update and keep input" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Input carried through custom releases",
  );
  await expect(
    page.getByRole("button", { name: "Review module update" }),
  ).toHaveCount(0);
  await policy(invalid.version);
  await page.clock.fastForward(31000);
  await expect(
    page.getByText(
      `Version ${invalid.version} is ready. Your current view remains open.`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Review module update" }).click();
  await page.getByRole("button", { name: "Update and keep input" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Input carried through custom releases",
  );
  await expect(page.getByLabel("Category", { exact: true })).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await mkdir("docs/verification/custom-view-state", { recursive: true });
  await page.screenshot({
    path: "docs/verification/custom-view-state/failed-conversion.png",
  });
  await page.getByRole("button", { name: "Keep current view" }).click();
  await policy(brokenView.version);
  await page.clock.fastForward(31000);
  await expect(
    page.getByText(
      `Version ${brokenView.version} is ready. Your current view remains open.`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Review module update" }).click();
  await page.getByRole("button", { name: "Update and keep input" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "The updated view could not render",
  );
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Input carried through custom releases",
  );
  await expect(page.getByLabel("Category", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "docs/verification/custom-view-state/failed-render.png",
  });
  await page.getByRole("button", { name: "Keep current view" }).click();
  await policy(converted.version);
  await page.clock.fastForward(31000);
  await expect(
    page.getByText(
      `Version ${converted.version} is ready. Your current view remains open.`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Review module update" }).click();
  await page.getByRole("button", { name: "Update and keep input" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
    "Input carried through custom releases",
  );
  await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
    "Restored input",
  );
  await page.screenshot({
    path: "docs/verification/custom-view-state/restored.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/verification/custom-view-state/narrow.png",
  });
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await expect(
    page.getByText("Input carried through custom releases", { exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    const effects = await admin.query(
      "select (select count(*) from suite.module_records where workspace_id=$1 and module_id=$2)::int as records, (select count(*) from suite.idempotency where workspace_id=$1 and operation=$3)::int as receipts",
      [workspace, id, `${id}.capture`],
    );
    expect(effects.rows[0]).toEqual({ records: 2, receipts: 2 });
  } finally {
    await admin.end();
  }
});
