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
const require = createRequire(resolve("apps/desktop/package.json"));

test("native installation recovery survives a complete process restart with one server receipt", async () => {
  test.setTimeout(120000);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-install-recovery-"));
  const admin = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  let app: ElectronApplication | undefined;
  const launch = () =>
    electron.launch({
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
  try {
    app = await launch();
    let page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const workspaceId = randomUUID();
    const scope = await page.evaluate(async (workspaceId) => {
      const response = await window.suiteDesktop!.execute({
        operation: "workspaceCreate",
        body: { id: workspaceId, name: "Native recovery", currency: "EUR" },
        idempotencyKey: crypto.randomUUID(),
      });
      if (response.status !== 200) throw Error("Workspace creation failed");
      const me = await window.suiteDesktop!.execute({ operation: "me" });
      return {
        userId: (me.body as { user: { id: string } }).user.id,
        workspaceId,
      };
    }, workspaceId);
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page.getByRole("link", { name: "Modules", exact: true }).click();
    const card = () =>
      page.locator(".module-install-card").filter({
        has: page.getByRole("heading", { name: "Contacts", exact: true }),
      });
    const pending = () =>
      page.evaluate(
        async (scope) =>
          (await window.suiteDesktop!.cacheRead(scope, "module-state")) as {
            lifecycle?: Record<string, { requestId: string }>;
          },
        scope,
      );
    await expect(
      card().getByRole("button", { name: "Verify and repair", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await pending()).lifecycle ?? {})
      .toEqual({});
    const auditCount = async () =>
      Number(
        (
          await admin.query(
            "select count(*) from suite.audit where workspace_id=$1 and action='modules.install' and target_id='contacts'",
            [workspaceId],
          )
        ).rows[0].count,
      );
    const before = await auditCount();
    const interrupt = async (
      application: ElectronApplication,
      commitFirst: boolean,
    ) =>
      application.evaluate(
        (_, { commitFirst, workspaceId }) => {
          // Test-only fault injection in the main process. The renderer keeps its real bounded IPC.
          const control = { enabled: true, commitFirst, keys: [] as string[] };
          (
            globalThis as unknown as { installationFault: typeof control }
          ).installationFault = control;
          const original = globalThis.fetch;
          globalThis.fetch = async (input, init) => {
            const body =
              typeof init?.body === "string"
                ? JSON.parse(init.body)
                : undefined;
            if (
              body?.action === "install" &&
              body.value.moduleId === "contacts" &&
              String(input).includes(`/workspaces/${workspaceId}/platform`)
            ) {
              control.keys.push(
                new Headers(init?.headers).get("idempotency-key")!,
              );
              if (control.enabled) {
                if (control.commitFirst) {
                  control.commitFirst = false;
                  const response = await original(input, init);
                  if (!response.ok) return response;
                  await response.arrayBuffer();
                }
                throw Error(
                  "Simulated connection loss after server acceptance",
                );
              }
            }
            return original(input, init);
          };
        },
        { commitFirst, workspaceId },
      );
    await interrupt(app, true);
    await card()
      .getByRole("button", { name: "Verify and repair", exact: true })
      .click();
    await expect(
      card().getByRole("button", { name: "Resume installation", exact: true }),
    ).toBeVisible();
    const key = (await pending()).lifecycle!.contacts.requestId;
    await app.close();
    app = undefined;
    app = await launch();
    await interrupt(app, false);
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page.getByRole("link", { name: "Modules", exact: true }).click();
    await expect(
      card().getByRole("button", { name: "Resume installation", exact: true }),
    ).toBeVisible();
    expect((await pending()).lifecycle!.contacts.requestId).toBe(key);
    await app.evaluate(() => {
      (
        globalThis as unknown as { installationFault: { enabled: boolean } }
      ).installationFault.enabled = false;
    });
    await card()
      .getByRole("button", { name: "Resume installation", exact: true })
      .click();
    await expect(
      card().getByRole("button", { name: "Verify and repair", exact: true }),
    ).toBeVisible();
    expect(await auditCount()).toBe(before + 1);
    const keys = await app.evaluate(
      () =>
        (globalThis as unknown as { installationFault: { keys: string[] } })
          .installationFault.keys,
    );
    expect(keys.length).toBeGreaterThan(0);
    expect([...new Set(keys)]).toEqual([key]);
    await mkdir("docs/verification/module-recovery", { recursive: true });
    await card().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/module-recovery/electron-recovered.png",
    });
  } finally {
    await app?.close();
    await admin.end();
    await rm(profile, { recursive: true, force: true });
  }
});
