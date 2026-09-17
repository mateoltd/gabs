import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { publishEditorFixture } from "../support/editor-fixture";

const require = createRequire(resolve("apps/desktop/package.json"));

for (const uncertainReply of [false, true])
  test(
    uncertainReply
      ? "native generated editors recover an uncertain receipt after a mandatory schema update"
      : "native generated editors preserve and export unsaved input through failed downloads and removed resources",
    async () => {
      test.setTimeout(120000);
      const profile = await mkdtemp(resolve(tmpdir(), "suite-native-editor-"));
      const id = `native-editor-${randomUUID().slice(0, 8)}`;
      const name = `Native editor ${id.slice(-8)}`;
      const workspaceId = randomUUID();
      const recordId = randomUUID();
      const exportPath = resolve(profile, "recovered-input.json");
      const admin = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      });
      const registry = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
        options: "-c role=suite_registry",
      });
      let app: ElectronApplication | undefined;
      try {
        await publishEditorFixture(registry, id, name);
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
        const created = await page.evaluate(
          async (workspaceId) =>
            window.suiteDesktop!.execute({
              operation: "workspaceCreate",
              body: {
                id: workspaceId,
                name: "Native editor recovery",
                currency: "EUR",
              },
              idempotencyKey: crypto.randomUUID(),
            }),
          workspaceId,
        );
        expect(created.status).toBe(200);
        // Authorization setup is an isolated fixture, not an administrator journey.
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
          [
            workspaceId,
            [
              `${id}.notes.read`,
              `${id}.notes.write`,
              `${id}.other.read`,
              `${id}.other.write`,
            ],
          ],
        );
        let revision = 0;
        const policy = async (version: string) => {
          const result = await page.evaluate(
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
          expect(result.status, JSON.stringify(result.body)).toBe(200);
          revision++;
        };
        await policy("1.0.0");
        const initial = await page.evaluate(
          async ({ workspaceId, id, recordId }) =>
            window.suiteDesktop!.execute({
              operation: "moduleRequest",
              params: { workspaceId, moduleId: id },
              moduleVersion: "1.0.0",
              idempotencyKey: crypto.randomUUID(),
              body: {
                action: "create",
                resource: "notes",
                input: {
                  id: recordId,
                  data: { name: "Initial native name", legacy: "Before" },
                },
              },
            }),
          { workspaceId, id, recordId },
        );
        expect(initial.status).toBe(200);
        await page.reload();
        await page
          .getByRole("button", { name: "Switch workspace", exact: true })
          .click();
        await page
          .getByRole("menuitemradio")
          .and(page.locator(`[data-value="${workspaceId}"]`))
          .click();
        await page.getByRole("link", { name, exact: true }).click();
        await page.getByRole("tab", { name: "Notes", exact: true }).click();
        await page.getByRole("button", { name: "Edit", exact: true }).click();
        await page
          .getByLabel("Name", { exact: true })
          .fill("Native input carried forward");
        await page
          .getByLabel("Legacy", { exact: true })
          .fill("Native removed field retained");

        await app.evaluate(
          ({ dialog }, { id, workspaceId, uncertainReply, exportPath }) => {
            // Fault injection is confined to native HTTP transport and the OS file
            // chooser. The view, preload, export validation and server stay real.
            dialog.showSaveDialog = async () => ({
              canceled: false,
              filePath: exportPath,
            });
            const state = {
              blockArtifact: true,
              loseReply: uncertainReply,
              keys: [] as string[],
            };
            (
              globalThis as unknown as { editorFault: typeof state }
            ).editorFault = state;
            const original = globalThis.fetch;
            globalThis.fetch = async (input, init) => {
              const url = String(input);
              if (
                state.blockArtifact &&
                url.includes(`/module/${id}/workspaces/${workspaceId}/artifact`)
              )
                return new Response(
                  JSON.stringify({
                    code: "RELEASE_UNAVAILABLE",
                    message: "Update download unavailable",
                  }),
                  {
                    status: 409,
                    headers: { "content-type": "application/json" },
                  },
                );
              if (
                url.includes(
                  `/module/${id}/workspaces/${workspaceId}/records`,
                ) &&
                typeof init?.body === "string" &&
                JSON.parse(init.body).action === "update"
              ) {
                state.keys.push(
                  new Headers(init.headers).get("idempotency-key")!,
                );
                if (state.loseReply) {
                  const accepted = await original(input, init);
                  if (!accepted.ok) return accepted;
                  await accepted.arrayBuffer();
                  state.loseReply = false;
                  throw Error("Simulated lost native acceptance reply");
                }
              }
              return original(input, init);
            };
          },
          { id, workspaceId, uncertainReply, exportPath },
        );
        if (uncertainReply) {
          await page.getByRole("button", { name: "Save", exact: true }).click();
          await expect(
            page.getByText(
              "The server response is uncertain. Retry this same change before editing or closing it.",
            ),
          ).toBeVisible();
        }
        await policy("1.1.0");
        await page.clock.fastForward(31000);
        await expect(
          page.getByRole("button", {
            name: "Retry installation",
            includeHidden: true,
          }),
        ).toHaveCount(1);
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Native input carried forward",
        );
        await expect(page.getByLabel("Legacy", { exact: true })).toHaveValue(
          "Native removed field retained",
        );
        await app.evaluate(() => {
          (
            globalThis as unknown as { editorFault: { blockArtifact: boolean } }
          ).editorFault.blockArtifact = false;
        });
        await page.clock.fastForward(31000);
        await expect(
          page.getByLabel("Category", { exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
          "Native input carried forward",
        );
        await expect(page.getByLabel("Fields removed by update")).toContainText(
          "Native removed field retained",
        );
        await page
          .getByRole("button", { name: "Export input before update" })
          .click();
        await expect
          .poll(async () => {
            try {
              return JSON.parse(await readFile(exportPath, "utf8"));
            } catch {
              return null;
            }
          })
          .toMatchObject({
            kind: "module-input-recovery",
            workspaceId,
            moduleId: id,
            moduleVersion: "1.0.0",
            resource: "notes",
            status: uncertainReply ? "unconfirmed" : "unsaved",
            input: {
              id: recordId,
              baseVersion: 1,
              data: {
                name: "Native input carried forward",
                legacy: "Native removed field retained",
              },
            },
          });
        const document = JSON.parse(await readFile(exportPath, "utf8"));
        if (uncertainReply) {
          expect(document.pendingRequest).toMatchObject({
            moduleId: id,
            moduleVersion: "1.0.0",
            action: "update",
            resource: "notes",
            input: document.input,
          });
          await expect(
            page.getByLabel("Category", { exact: true }),
          ).toBeDisabled();
        } else {
          expect(document).not.toHaveProperty("pendingRequest");
          await page
            .getByRole("button", { name: "Remove Legacy from this edit" })
            .click();
          await page
            .getByLabel("Category", { exact: true })
            .fill("Native office");
        }
        await mkdir("docs/verification/native-editor-updates", {
          recursive: true,
        });
        await page.screenshot({
          path: `docs/verification/native-editor-updates/${uncertainReply ? "uncertain" : "preserved"}.png`,
        });
        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const records = await admin.query(
          "select id, version, data from suite.module_records where workspace_id=$1 and module_id=$2 and resource='notes'",
          [workspaceId, id],
        );
        expect(records.rows).toEqual([
          {
            id: recordId,
            version: 2,
            data: uncertainReply
              ? {
                  name: "Native input carried forward",
                  legacy: "Native removed field retained",
                }
              : {
                  name: "Native input carried forward",
                  category: "Native office",
                },
          },
        ]);
        const effects = await admin.query(
          "select (select count(*) from suite.audit where workspace_id=$1 and action=$2)::int as audits, (select count(*) from suite.idempotency where workspace_id=$1 and operation=$2)::int as receipts",
          [workspaceId, `${id}.notes.update`],
        );
        expect(effects.rows[0]).toEqual({ audits: 1, receipts: 1 });
        const keys = await app.evaluate(
          () =>
            (globalThis as unknown as { editorFault: { keys: string[] } })
              .editorFault.keys,
        );
        expect(keys).toHaveLength(uncertainReply ? 2 : 1);
        if (uncertainReply) {
          expect(keys).toEqual([
            document.pendingRequest.key,
            document.pendingRequest.key,
          ]);
        } else {
          await page.getByRole("button", { name: "Edit", exact: true }).click();
          await page
            .getByLabel("Name", { exact: true })
            .fill("Native removed resource input");
          await policy("1.2.0");
          await page.clock.fastForward(31000);
          await expect(
            page
              .getByRole("alert")
              .filter({ hasText: "This release removed notes" }),
          ).toBeVisible();
          await expect(
            page.getByRole("button", { name: "Save", exact: true }),
          ).toBeDisabled();
          await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
            "Native removed resource input",
          );
          await page
            .getByRole("button", { name: "Export input before update" })
            .click();
          await expect
            .poll(async () => JSON.parse(await readFile(exportPath, "utf8")))
            .toMatchObject({
              moduleVersion: "1.1.0",
              resource: "notes",
              status: "unsaved",
              input: {
                id: recordId,
                baseVersion: 2,
                data: { name: "Native removed resource input" },
              },
            });
          await page.screenshot({
            path: "docs/verification/native-editor-updates/removed-resource.png",
          });
          await page.keyboard.press("Escape");
          await expect(
            page.getByRole("button", { name: "New other", exact: true }),
          ).toBeEnabled();
        }
        await page.getByRole("link", { name: "Modules", exact: true }).click();
        const moduleCard = page
          .locator(".module-install-card")
          .filter({ has: page.getByRole("heading", { name, exact: true }) });
        await moduleCard
          .getByRole("button", { name: "View devices", exact: true })
          .click();
        const devices = page.getByRole("dialog", {
          name: `Devices using ${name}`,
          exact: true,
        });
        await expect(
          devices.getByText(
            "1 of 1 known devices have a server-accepted release. 0 reported a failed module change.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          devices.getByText("Ready reported", { exact: true }),
        ).toBeVisible();
        if (!uncertainReply) {
          await mkdir("docs/verification/module-fleet", { recursive: true });
          await page.screenshot({
            path: "docs/verification/module-fleet/electron.png",
          });
        }
      } finally {
        await app?.close();
        await registry.end();
        await admin.end();
        await rm(profile, { recursive: true, force: true });
      }
    },
  );
