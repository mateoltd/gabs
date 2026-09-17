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
import { defineModule, resource, field, Type } from "@suite/module-sdk";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { signPackage } from "../../packages/sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  publishRelease,
} from "../../tooling/modules/registry-review";

const require = createRequire(resolve("apps/desktop/package.json"));

async function assertHidden(app: ElectronApplication) {
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (window) =>
          !window.isFocused() && (!window.isVisible() || window.isMinimized()),
      ),
    ),
  ).toBe(true);
}
for (const { lostReply, malformedReply } of [
  { lostReply: false, malformedReply: false },
  { lostReply: true, malformedReply: false },
  { lostReply: true, malformedReply: true },
])
  test(
    malformedReply
      ? "hidden native queued work retains a malformed acceptance across restart and a mandatory update"
      : lostReply
        ? "native queued work recovers a lost acceptance after process restart and a mandatory update"
        : "native queued work survives process restart and requires review after a mandatory update",
    async () => {
      test.setTimeout(120000);
      const profile = await mkdtemp(
        resolve(tmpdir(), "suite-rollout-restart-"),
      );
      const admin = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
      });
      const registry = new Pool({
        connectionString: process.env.MIGRATION_DATABASE_URL,
        options: "-c role=suite_registry",
      });
      const id = `native-rollout-${randomUUID().slice(0, 8)}`;
      const name = `Native notes ${id.slice(-8)}`;
      const workspaceId = randomUUID();
      let app: ElectronApplication | undefined;
      const launch = async () => {
        const application = await electron.launch({
          executablePath: require("electron"),
          args: [
            resolve("apps/desktop/dist/main.cjs"),
            `--user-data-dir=${profile}`,
          ],
          env: {
            ...process.env,
            NODE_ENV: "development",
            SUITE_DESKTOP_DEV_AUTH: "1",
            SUITE_DESKTOP_TEST_MINIMIZED: "1",
          },
        });
        await application.firstWindow();
        await assertHidden(application);
        return application;
      };
      const fault = async (
        application: ElectronApplication,
        commitFirst: boolean,
      ) =>
        application.evaluate(
          (_, { id, workspaceId, commitFirst, malformedReply }) => {
            // Interrupt only transport in the main process. The renderer, preload,
            // durable journal, installer and authoritative API remain real.
            const state = {
              enabled: true,
              commitFirst,
              keys: [] as string[],
              accepted: false,
            };
            (
              globalThis as unknown as { rolloutFault: typeof state }
            ).rolloutFault = state;
            const original = globalThis.fetch;
            globalThis.fetch = async (input, init) => {
              if (
                String(input).includes(
                  `/module/${id}/workspaces/${workspaceId}/records`,
                ) &&
                typeof init?.body === "string" &&
                JSON.parse(init.body).action === "create"
              ) {
                state.keys.push(
                  new Headers(init.headers).get("idempotency-key")!,
                );
                if (state.enabled) {
                  if (malformedReply) {
                    const response = await original(input, init);
                    if (!response.ok) return response;
                    state.accepted = true;
                    return new Response(
                      JSON.stringify({
                        ...(await response.json()),
                        version: 0,
                      }),
                      {
                        status: 200,
                        headers: { "content-type": "application/json" },
                      },
                    );
                  }

                  if (state.commitFirst) {
                    state.commitFirst = false;
                    const response = await original(input, init);
                    if (!response.ok) return response;
                    await response.arrayBuffer();
                    state.accepted = true;
                  }
                  throw Error("Simulated native transport interruption");
                }
              }
              return original(input, init);
            };
          },
          { id, workspaceId, commitFirst, malformedReply },
        );
      try {
        const keyDir =
          process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
        const privateKey = await readFile(`${keyDir}/private.pem`, "utf8");
        const publicKey = await readFile(`${keyDir}/public.pem`, "utf8");
        for (const version of ["1.0.0", "1.1.0"]) {
          const module = defineModule({
            id,
            name,
            version,
            description: "Native release recovery acceptance",
            host: "^1.0.0",
            backend: "^1.0.0",
            publisher: "suite",
            dependencies: {},
            configuration: Type.Object({}),
            operations: {},
            permissions: [`${id}.notes.read`, `${id}.notes.write`],
            navigation: { path: `/${id}`, permission: `${id}.notes.read` },
            resources: {
              notes: resource(
                {
                  name: field.text(),
                  ...(version === "1.1.0"
                    ? { category: Type.Optional(field.text()) }
                    : {}),
                },
                { title: "Notes" },
              ),
            },
          });
          const submission = await submitRelease(
            registry,
            signPackage(module, privateKey),
            null,
            publicKey,
          );
          await reviewRelease(
            registry,
            submission,
            "approved",
            "Reviewed native rollout fixture",
            publicKey,
          );
          await publishRelease(registry, submission, publicKey);
        }
        app = await launch();
        let page = await app.firstWindow();
        const signIn = async () => {
          await page.emulateMedia({ reducedMotion: "reduce" });
          await page
            .getByRole("button", { name: "Open local workspace", exact: true })
            .click();
          await expect(
            page.getByRole("button", { name: "Switch workspace", exact: true }),
          ).toBeVisible();
        };
        const switchCompany = async () => {
          await page
            .getByRole("button", { name: "Switch workspace", exact: true })
            .click();
          await page
            .getByRole("menuitemradio")
            .and(page.locator(`[data-value="${workspaceId}"]`))
            .click();
        };
        await signIn();
        expect(
          await page.evaluate(
            async () =>
              (await window.suiteDesktop!.securityStatus()).persistentStorage,
          ),
        ).toBe(true);
        const scope = await page.evaluate(async (workspaceId) => {
          const created = await window.suiteDesktop!.execute({
            operation: "workspaceCreate",
            body: {
              id: workspaceId,
              name: "Native rollout acceptance",
              currency: "EUR",
            },
            idempotencyKey: crypto.randomUUID(),
          });
          if (created.status !== 200) throw Error("Workspace creation failed");
          const me = await window.suiteDesktop!.execute({ operation: "me" });
          return {
            userId: (me.body as { user: { id: string } }).user.id,
            workspaceId,
          };
        }, workspaceId);
        // Fixture provisioning does not stand in for an administration acceptance test.
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
          [workspaceId, [`${id}.notes.read`, `${id}.notes.write`]],
        );
        const policy = async (version: string, revision: number) => {
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
        };
        await policy("1.0.0", 0);
        await page.reload();
        await switchCompany();
        await page.getByRole("link", { name: "Settings", exact: true }).click();
        await page
          .getByRole("button", { name: "Enable on this device", exact: true })
          .click();
        await expect(
          page.getByRole("button", {
            name: "Disable offline storage",
            exact: true,
          }),
        ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              async (scope) =>
                !!(await window.suiteDesktop!.cacheRead(scope, "snapshot")),
              scope,
            ),
          )
          .toBe(true);
        await page.getByRole("link", { name, exact: true }).click();
        await expect(
          page.getByRole("button", { name: "New notes", exact: true }),
        ).toBeVisible();
        const journal = () =>
          page.evaluate(
            async ({ scope, id }) => {
              const storage = (await window.suiteDesktop!.cacheRead(
                scope,
                "module-state",
              )) as ModuleStorage;
              return storage.journal.filter(
                (entry) => entry.call.moduleId === id,
              );
            },
            { scope, id },
          );
        await fault(app, lostReply);
        await page.context().setOffline(true);
        await page
          .getByRole("button", { name: "New notes", exact: true })
          .click();
        await expect(page.getByLabel("Category", { exact: true })).toHaveCount(
          0,
        );
        await page
          .getByLabel("Name", { exact: true })
          .fill("Queued on the old native release");
        await page
          .getByRole("button", { name: "Save pending change", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Pending changes" }),
        ).toBeVisible();
        const pending = (await journal())[0];
        expect(pending).toMatchObject({
          state: "pending",
          call: {
            moduleVersion: "1.0.0",
            input: { data: { name: "Queued on the old native release" } },
          },
        });
        await page.context().setOffline(false);
        await expect
          .poll(() =>
            app!.evaluate(
              () =>
                (globalThis as unknown as { rolloutFault: { keys: string[] } })
                  .rolloutFault.keys.length,
            ),
          )
          .toBeGreaterThan(0);
        await expect
          .poll(() =>
            app!.evaluate(
              () =>
                (
                  globalThis as unknown as {
                    rolloutFault: { accepted: boolean };
                  }
                ).rolloutFault.accepted,
            ),
          )
          .toBe(lostReply);
        expect((await journal())[0].state).toBe("pending");
        if (malformedReply) {
          await expect(page.locator(".module-pending")).toContainText(
            "data that could not be verified",
          );
          expect((await journal())[0].result).toBeUndefined();
        }

        await policy("1.1.0", 1);
        await assertHidden(app);
        await app.close();
        app = undefined;
        app = await launch();
        await fault(app, false);
        page = await app.firstWindow();
        await signIn();
        await switchCompany();
        await page.getByRole("link", { name, exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Pending changes" }),
        ).toBeVisible();
        expect((await journal())[0]).toMatchObject({
          id: pending.id,
          state: "pending",
          call: pending.call,
        });
        await page
          .getByRole("button", { name: "New notes", exact: true })
          .click();
        await expect(
          page.getByLabel("Category", { exact: true }),
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await app.evaluate(() => {
          (
            globalThis as unknown as { rolloutFault: { enabled: boolean } }
          ).rolloutFault.enabled = false;
        });
        await page.context().setOffline(true);
        await expect(
          page.getByText(
            "Offline copy. Changes remain pending until the server accepts them.",
          ),
        ).toBeVisible();
        await page.context().setOffline(false);
        if (lostReply) {
          await expect
            .poll(async () => (await journal())[0]?.state)
            .toBe("accepted");
          expect((await journal())[0]).toMatchObject({
            id: pending.id,
            call: pending.call,
          });
          expect((await journal())[0].supersededBy).toBeUndefined();
        } else {
          await expect(
            page.locator(".module-pending").getByText(/no longer accepted/),
          ).toBeVisible();
          expect((await journal())[0]).toMatchObject({
            id: pending.id,
            call: pending.call,
            state: "conflict",
          });
          expect(
            (
              await admin.query(
                "select id from suite.module_records where workspace_id=$1 and module_id=$2",
                [workspaceId, id],
              )
            ).rows,
          ).toEqual([]);
          await mkdir("docs/verification/native-rollout", { recursive: true });
          await page.screenshot({
            path: "docs/verification/native-rollout/preserved-conflict.png",
          });
          await page
            .getByRole("button", { name: "Review", exact: true })
            .click();
          await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
            "Queued on the old native release",
          );
          await page
            .getByLabel("Category", { exact: true })
            .fill("Reviewed after restart");
          await page.getByRole("button", { name: "Save", exact: true }).click();
          await expect
            .poll(async () =>
              (await journal()).some((entry) => entry.state === "accepted"),
            )
            .toBe(true);
          const entries = await journal();
          expect(entries[0].call).toEqual(pending.call);
          expect(entries[0].supersededBy).toBe(entries[1].id);
          expect(entries[1].call.moduleVersion).toBe("1.1.0");
          expect(entries[1].call.input).toMatchObject({
            id: (pending.call.input as { id: string }).id,
          });
        }
        await expect(
          page.getByRole("cell", {
            name: "Queued on the old native release",
            exact: true,
          }),
        ).toBeVisible();
        const effects = await admin.query(
          "select (select count(*) from suite.module_records where workspace_id=$1 and module_id=$2)::int as records, (select count(*) from suite.audit where workspace_id=$1 and action=$3)::int as audits, (select count(*) from suite.idempotency where workspace_id=$1 and operation=$3)::int as receipts",
          [workspaceId, id, `${id}.notes.create`],
        );
        expect(effects.rows[0]).toEqual({ records: 1, audits: 1, receipts: 1 });
        const keys = await app.evaluate(
          () =>
            (globalThis as unknown as { rolloutFault: { keys: string[] } })
              .rolloutFault.keys,
        );
        expect(keys).toContain(pending.id);
        if (lostReply) expect([...new Set(keys)]).toEqual([pending.id]);
        await assertHidden(app);
        const evidence = malformedReply
          ? "docs/verification/generated-response"
          : "docs/verification/native-rollout";
        await mkdir(evidence, { recursive: true });
        await page.screenshot({
          path: `${evidence}/${malformedReply ? "native-recovered-receipt" : lostReply ? "recovered-receipt" : "reviewed-request"}.png`,
        });
      } finally {
        await app?.close();
        await admin.end();
        await registry.end();
        await rm(profile, { recursive: true, force: true });
      }
    },
  );
