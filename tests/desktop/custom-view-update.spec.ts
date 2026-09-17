import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { publishEditableFixture } from "../support/editable-fixture";

const require = createRequire(resolve("apps/desktop/package.json"));
test("native custom-view updates preserve typed input and recover from invalid conversion", async () => {
  test.setTimeout(120000);
  const id = `native-editable-${randomUUID().slice(0, 8)}`,
    name = `Editable native ${id.slice(-8)}`;
  const profile = await mkdtemp(resolve(tmpdir(), "suite-editable-view-"));
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let app: ElectronApplication | undefined;
  try {
    const first = await publishEditableFixture(id, name);
    const invalid = await publishEditableFixture(id, name, 2, true);
    const second = await publishEditableFixture(id, name, 2);
    app = await electron.launch({
      executablePath: require("electron"),
      args: [
        resolve("apps/desktop/dist/main.cjs"),
        `--user-data-dir=${profile}`,
      ],
      env: {
        ...process.env,
        NODE_ENV: "development",
        SUITE_DESKTOP_DEV_AUTH: "1",
      },
    });
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install();
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const workspaceId = randomUUID();
    const created = await page.evaluate(
      async (workspaceId) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id: workspaceId,
            name: "Native view update",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspaceId,
    );
    expect(created.status).toBe(200);
    // Isolated authorization setup is a fixture, not administration evidence.
    await admin.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspaceId, id],
    );
    await admin.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [workspaceId, id],
    );
    await admin.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
      [workspaceId, id],
    );
    await admin.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and name='Owner'",
      [workspaceId, [`${id}.notes.read`, `${id}.notes.write`, `${id}.capture`]],
    );
    let revision = 0;
    const policy = async (version: string) => {
      const response = await page.evaluate(
        async ({ workspaceId, id, version, revision }) =>
          window.suiteDesktop!.execute({
            operation: "platformCommand",
            params: { workspaceId },
            idempotencyKey: crypto.randomUUID(),
            body: {
              action: "rollout",
              version: revision,
              value: {
                moduleId: id,
                version,
                mandatory: true,
                acceptedVersions: [],
              },
            },
          }),
        { workspaceId, id, version, revision },
      );
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      revision++;
    };
    await policy(first.version);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page.getByRole("link", { name, exact: true }).click();
    await page
      .getByLabel("Note name", { exact: true })
      .fill("Native input preserved");
    await policy(invalid.version);
    await page.clock.fastForward(31000);
    await expect(
      page.getByText(
        `Version ${invalid.version} is ready. Your current view remains open.`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Review module update" }).click();
    await page.getByRole("button", { name: "Update and keep input" }).click();
    await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
      "Native input preserved",
    );
    await page.getByRole("button", { name: "Keep current view" }).click();
    await policy(second.version);
    await page.clock.fastForward(31000);
    await expect(
      page.getByText(
        `Version ${second.version} is ready. Your current view remains open.`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Review module update" }).click();
    await page.getByRole("button", { name: "Update and keep input" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue(
      "Native input preserved",
    );
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue(
      "Restored input",
    );
    await mkdir("docs/verification/custom-view-state", { recursive: true });
    await page.screenshot({
      path: "docs/verification/custom-view-state/electron-restored.png",
    });
    await page.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      page.getByText("Native input preserved", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
    const effects = await admin.query(
      "select (select count(*) from suite.module_records where workspace_id=$1 and module_id=$2)::int as records, (select count(*) from suite.idempotency where workspace_id=$1 and operation=$3)::int as receipts",
      [workspaceId, id, `${id}.capture`],
    );
    expect(effects.rows[0]).toEqual({ records: 1, receipts: 1 });
  } finally {
    await app?.close();
    await admin.end();
    await rm(profile, { recursive: true, force: true });
  }
});
