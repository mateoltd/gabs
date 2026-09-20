import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { assertSchema } from "@suite/module-sdk";
import {
  SavedWorkRecoverySchema,
  ModuleInputRecoverySchema,
} from "@suite/module-sdk/platform";
import { publishEditorFixture } from "../editor-fixture";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";

/** Recover an actual exported draft through retired and changed signed resource contracts. */
export async function corporateSchemaRecovery(options: {
  source: Page;
  api: APIRequestContext;
  directory: string;
  surface: "web" | "desktop";
  offline(value: boolean): Promise<void>;
  exportFile(button: Locator, path: string): Promise<void>;
  replaceDevice(): Promise<Page>;
}) {
  let page = options.source;
  const id = `recover-${randomUUID().slice(0, 8)}`;
  const name = `Recovery notes ${id.slice(-8)}`;
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  try {
    await publishEditorFixture(registry, id, name);
    const me = await (await options.api.get("/api/v1/me")).json();
    const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
    const headers = {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken as string,
    };
    const created = await options.api.post("/api/v1/workspaces", {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        id: scope.workspaceId,
        name: "Recovery across resource changes",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    // Provision fixture access only. Release selection and recovery use actual public operations.
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
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and name='Owner'",
      [
        scope.workspaceId,
        [
          `${id}.notes.read`,
          `${id}.notes.write`,
          `${id}.other.read`,
          `${id}.other.write`,
        ],
      ],
    );
    let revision = 0;
    const pin = async (version: string) => {
      const response = await options.api.post(
        `/api/v1/workspaces/${scope.workspaceId}/platform`,
        {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: {
            action: "rollout",
            version: revision,
            value: {
              moduleId: id,
              version,
              mandatory: true,
              acceptedVersions: [],
            },
          },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
      revision++;
    };
    const navigate = (label: string) =>
      page
        .getByRole("navigation", {
          name: label === "Settings" ? "Preferences" : "Main navigation",
          exact: true,
        })
        .getByRole("link", { name: label, exact: true })
        .click();
    const installed = async (version: string) => {
      await page.reload();
      await selectValue(page, "Workspace", scope.workspaceId);
      await navigate("Modules");
      const card = page
        .locator(".module-install-card")
        .filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(card).toContainText(`Installed ${version}`, {
        timeout: 30000,
      });
    };
    const enable = async () => {
      await navigate("Settings");
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
    const stored = () => portabilityStorage(page, scope);
    const noEffects = async () => {
      expect(
        (
          await pool.query(
            "select count(*)::int n from suite.module_records where workspace_id=$1 and module_id=$2",
            [scope.workspaceId, id],
          )
        ).rows[0].n,
      ).toBe(0);
      expect((await stored()).journal).toEqual([]);
    };
    const capture = async (label: string) => {
      const directory = "docs/verification/imported-schema";
      await mkdir(directory, { recursive: true });
      expect(
        (
          await new AxeBuilder({ page })
            .setLegacyMode(options.surface === "desktop")
            .include('[role="dialog"]')
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: `${directory}/${options.surface}-${label}.png`,
        animations: "disabled",
      });
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: `${directory}/${options.surface}-${label}-narrow.png`,
        animations: "disabled",
      });
      await page.setViewportSize(viewport);
    };
    await pin("1.0.0");
    await installed("1.0.0");
    await enable();
    await navigate(name);
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await options.offline(true);
    await page.getByRole("button", { name: "New notes", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Preserved original draft");
    await page
      .getByLabel("Legacy", { exact: true })
      .fill("Preserve until explicitly removed");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await navigate("Settings");
    await page
      .getByRole("button", { name: /^Saved records and drafts/ })
      .click();
    const path = resolve(options.directory, "old-schema.json");
    await options.exportFile(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Export saved draft", exact: true }),
      path,
    );
    const bytes = await readFile(path);
    const input: unknown = JSON.parse(bytes.toString());
    assertSchema(SavedWorkRecoverySchema, input);
    expect(input).toMatchObject({
      selection: "draft",
      moduleId: id,
      moduleVersion: "1.0.0",
      data: {
        name: "Preserved original draft",
        legacy: "Preserve until explicitly removed",
      },
    });
    await pin("1.2.0");
    page = await options.replaceDevice();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installed("1.2.0");
    await enable();
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    const imports = () =>
      page.getByRole("dialog", { name: "Imported saved work", exact: true });
    const fileInput = imports().getByLabel("Saved-work recovery file", {
      exact: true,
    });
    await expect(fileInput).toBeEnabled();
    await fileInput.setInputFiles(path);
    await expect(imports().getByRole("status")).toContainText("Copy imported");
    await imports()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await imports()
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(imports()).toContainText(
      "Restored. The imported copy is retained separately.",
    );
    const copy = Object.values((await stored()).recoveryImports!)[0];
    expect(copy.input).toEqual(input);
    const draftKey = copy.promotion!.draftKey!;
    expect((await stored()).drafts[draftKey]).toEqual(
      input.selection === "draft" ? input.data : undefined,
    );
    await noEffects();
    await capture("retired");
    await imports()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await navigate(name);
    await expect(
      page.getByRole("tab", { name: "Notes", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Resume review", exact: true }),
    ).toHaveCount(0);
    await pin("1.1.0");
    await installed("1.1.0");
    await navigate(name);
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume review", exact: true })
      .click();
    const editor = () =>
      page.getByRole("dialog", { name: "New record", exact: true });
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Preserved original draft",
    );
    await expect(page.getByLabel("Fields removed by update")).toContainText(
      "Preserve until explicitly removed",
    );
    await expect(page.getByLabel("Category", { exact: true })).toHaveValue("");
    await capture("changed");
    await page
      .getByRole("button", {
        name: "Remove Legacy from this edit",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Category", { exact: true })
      .fill("Reviewed current schema");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(editor()).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "Preserved original draft", exact: true }),
    ).toBeVisible();
    const records = await pool.query(
      "select data from suite.module_records where workspace_id=$1 and module_id=$2",
      [scope.workspaceId, id],
    );
    expect(records.rows).toEqual([
      {
        data: {
          name: "Preserved original draft",
          category: "Reviewed current schema",
        },
      },
    ]);
    expect((await stored()).recoveryImports).toEqual({
      [Object.keys((await stored()).recoveryImports!)[0]]: copy,
    });
    expect(await readFile(path)).toEqual(bytes);
    await page.reload();
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Preserved original draft", exact: true }),
    ).toBeVisible();
    // A current signed schema does not make an exported target snapshot authoritative.
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Preserve edit after archival");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await navigate("Settings");
    await page
      .getByRole("button", { name: /^Saved records and drafts/ })
      .click();
    const editPath = resolve(options.directory, "before-archive.json");
    await options.exportFile(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "Export saved draft", exact: true }),
      editPath,
    );
    const editBytes = await readFile(editPath);
    const edit: unknown = JSON.parse(editBytes.toString());
    assertSchema(SavedWorkRecoverySchema, edit);
    if (edit.selection !== "draft" || !edit.target)
      throw Error("Expected an exported record edit");
    expect(edit.moduleVersion).toBe("1.1.0");
    const archived = await options.api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": "1.1.0",
        },
        data: {
          action: "archive",
          resource: "notes",
          input: { id: edit.target.id, baseVersion: edit.target.version },
        },
      },
    );
    expect(archived.ok(), await archived.text()).toBe(true);
    const recordState = () =>
      pool.query(
        "select id,data,version,archived from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, id],
      );
    const audit = () =>
      pool.query(
        "select id,action from suite.audit where workspace_id=$1 and target_id=$2 order by id",
        [scope.workspaceId, edit.target!.id],
      );
    const beforeRecords = (await recordState()).rows;
    const beforeAudit = (await audit()).rows;
    expect(beforeRecords).toEqual([
      expect.objectContaining({
        id: edit.target.id,
        archived: true,
        version: edit.target.version + 1,
      }),
    ]);
    page = await options.replaceDevice();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installed("1.1.0");
    await enable();
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    const editInput = imports().getByLabel("Saved-work recovery file", {
      exact: true,
    });
    await expect(editInput).toBeEnabled();
    await editInput.setInputFiles(editPath);
    await expect(imports().getByRole("status")).toContainText("Copy imported");
    await imports()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await imports()
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(imports()).toContainText(
      "Restored. The imported copy is retained separately.",
    );
    const archivedCopy = Object.values((await stored()).recoveryImports!)[0];
    expect(archivedCopy.input).toEqual(edit);
    const archivedKey = archivedCopy.promotion!.draftKey!;
    expect((await stored()).drafts[archivedKey]).toEqual(edit.data);
    expect((await stored()).draftTargets?.[archivedKey]).toMatchObject({
      id: edit.target.id,
      archived: true,
      version: edit.target.version + 1,
    });
    await imports()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await navigate(name);
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume review", exact: true })
      .click();
    const recovery = page.getByRole("dialog", {
      name: "Recover input",
      exact: true,
    });
    await expect(recovery).toContainText("Preserve edit after archival");
    await expect(
      recovery.getByRole("button", { name: "Save", exact: true }),
    ).toHaveCount(0);
    await expect(
      recovery.getByRole("button", { name: "Export input", exact: true }),
    ).toBeEnabled();
    await capture("archived");
    const recoveredPath = resolve(
      options.directory,
      "archived-recovered-input.json",
    );
    await options.exportFile(
      recovery.getByRole("button", { name: "Export input", exact: true }),
      recoveredPath,
    );
    const recovered: unknown = JSON.parse(
      await readFile(recoveredPath, "utf8"),
    );
    assertSchema(ModuleInputRecoverySchema, recovered);
    expect(recovered).toMatchObject({
      ...scope,
      moduleId: id,
      moduleVersion: "1.1.0",
      resource: "notes",
      input: {
        id: edit.target.id,
        baseVersion: edit.target.version,
        data: edit.data,
      },
    });
    expect((await recordState()).rows).toEqual(beforeRecords);
    expect((await audit()).rows).toEqual(beforeAudit);
    expect((await stored()).journal).toEqual([]);
    expect(await readFile(editPath)).toEqual(editBytes);
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    await registry.end();
    await pool.end();
  }
}
