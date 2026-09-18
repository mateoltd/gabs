import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { publishExecutableFixture } from "../support/executable-fixture";
import { assignHostFixture } from "../support/host-capability-journey";
import { lanFixture } from "../support/lan-fixture";
import {
  LanTransport,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
const require = createRequire(resolve("apps/desktop/package.json"));
test("received drafts require review and server acceptance, survive restart, and retry without duplicate effects", async () => {
  test.setTimeout(150000);
  const workspaceId = randomUUID(),
    moduleId = `recovery-${randomUUID().slice(0, 8)}`;
  const fixture = await lanFixture(workspaceId, [49180, 49181, 49182]);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-relay-recovery-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const peer = new LanTransport(fixture.config("b"), async () => {});
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
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
        SUITE_LAN_WORKSPACE: workspaceId,
        SUITE_LAN_CERT: resolve(fixture.directory, "a.crt"),
        SUITE_LAN_KEY: resolve(fixture.directory, "a.key"),
        SUITE_LAN_CA: resolve(fixture.directory, "ca.crt"),
        SUITE_LAN_PEERS: fixture.identities.b.fingerprint,
        SUITE_LAN_ADDRESSES: "127.0.0.1",
      },
    });
  try {
    const published = await publishExecutableFixture({
      id: moduleId,
      name: "Network notes",
      sourceDirectory: "tests/fixtures/lan-capabilities",
    });
    await peer.start();
    app = await launch();
    let page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const userId = await page.evaluate(
      async () =>
        (
          (await window.suiteDesktop!.execute({ operation: "me" })).body as {
            user: { id: string };
          }
        ).user.id,
    );
    const scope = { userId, workspaceId };
    expect(
      (
        await page.evaluate(
          (id) =>
            window.suiteDesktop!.execute({
              operation: "workspaceCreate",
              body: { id, name: "Received work", currency: "EUR" },
              idempotencyKey: crypto.randomUUID(),
            }),
          workspaceId,
        )
      ).status,
    ).toBe(200);
    await assignHostFixture(pool, workspaceId, moduleId);
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [workspaceId, [`${moduleId}.notes.read`, `${moduleId}.notes.write`]],
    );
    await page.reload();
    const selectCompany = async () => {
      await page
        .getByRole("button", { name: "Switch workspace", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .and(page.locator(`[data-value="${workspaceId}"]`))
        .click();
    };
    await selectCompany();
    await page
      .getByRole("link", { name: "Network notes", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Module local network" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable local network", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disable local network", exact: true }),
    ).toBeVisible();
    await peer.discover();
    const target = peer
      .status()
      .peers.find((p) => p.id === fixture.identities.a.fingerprint)!;
    expect(target).toBeDefined();
    const ids = Array.from({ length: 5 }, () => randomUUID());
    const recordIds = Array.from({ length: 5 }, () => randomUUID());
    const envelopes = ids.map((id, index): RelayEnvelope => {
      const payload = JSON.stringify({
        ...scope,
        id,
        state: "pending",
        createdAt: Date.now() + index,
        attempts: 0,
        dependencies: index === 1 ? [ids[0]] : [],
        call: {
          moduleId,
          moduleVersion: published.version,
          action: index === 2 ? "update" : "create",
          resource: "notes",
          input:
            index === 2
              ? {
                  id: recordIds[0],
                  baseVersion: 99,
                  data: { text: "Conflicting change" },
                }
              : {
                  id: recordIds[index],
                  data: { text: `Received note ${index}` },
                },
        },
      });
      return {
        id,
        workspaceId,
        kind: "pending",
        payload,
        digest: createHash("sha256").update(payload).digest("hex"),
      };
    });
    // Real TLS receipts remain provisional and never auto-submit.
    for (const envelope of envelopes) await peer.relay(target.id, envelope);
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, moduleId],
        )
      ).rows[0].count,
    ).toBe("0");
    await page.getByRole("button", { name: /^Received drafts/ }).click();
    let dialog = page.getByRole("dialog", {
      name: "Received drafts",
      exact: true,
    });
    const review = async (index: number) => {
      const back = dialog.getByRole("button", {
        name: "Back to received drafts",
        exact: true,
      });
      if (await back.isVisible()) await back.click();
      await dialog
        .getByRole("button", { name: /^Review Network notes/ })
        .nth(index)
        .click();
      return dialog.getByRole("region", {
        name: "Received draft review",
        exact: true,
      });
    };
    let selected = await review(1);
    await expect(selected).toContainText("Received note 1");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("dependencies");
    selected = await review(0);
    await app.evaluate(() => {
      const original = globalThis.fetch;
      (globalThis as unknown as { recoveryFetch: typeof fetch }).recoveryFetch =
        original;
      let lose = true;
      globalThis.fetch = async (...args) => {
        const response = await original(...args);
        if (
          lose &&
          String(args[0]).includes("/records") &&
          args[1]?.method === "POST"
        ) {
          lose = false;
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNRESET" },
          });
        }
        return response;
      };
    });
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, moduleId],
        )
      ).rows[0].count,
    ).toBe("1");
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await selectCompany();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /^Received drafts/ }).click();
    dialog = page.getByRole("dialog", { name: "Received drafts", exact: true });
    selected = await review(0);
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    await selected
      .getByRole("button", { name: "Retry submission", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, moduleId],
        )
      ).rows[0].count,
    ).toBe("1");
    selected = await review(1);
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    selected = await review(2);
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toContainText("base version");
    selected = await review(3);
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspaceId, `${moduleId}.notes.write`],
    );
    selected = await review(4);
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).not.toHaveText(
      "Accepted by the authoritative server.",
    );
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (scope) => window.suiteDesktop!.lanReceipts(scope),
              scope,
            )
          ).find((r) => r.id === ids[4])?.state,
      )
      .toBe("rejected");
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, moduleId],
        )
      ).rows[0].count,
    ).toBe("3");
    const states = await page.evaluate(
      (scope) => window.suiteDesktop!.lanReceipts(scope),
      scope,
    );
    expect(
      (
        await pool.query(
          "select count(*) from suite.audit where workspace_id=$1 and action=$2",
          [workspaceId, `${moduleId}.notes.create`],
        )
      ).rows[0].count,
    ).toBe("3");
    expect(states.map((r) => r.state)).toEqual([
      "accepted",
      "accepted",
      "conflict",
      "accepted",
      "rejected",
    ]);
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/lan-recovery", { recursive: true });
    await page.screenshot({
      path: "docs/verification/lan-recovery/native.png",
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(800, 800),
    );
    await page.screenshot({
      path: "docs/verification/lan-recovery/narrow.png",
    });
    await dialog
      .getByRole("button", { name: "Back to received drafts", exact: true })
      .click();
    await page.screenshot({
      path: "docs/verification/lan-recovery/receipts.png",
    });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth + 1,
      ),
    ).toBe(true);

    selected = await review(0);
    await selected
      .getByRole("button", { name: "Dismiss accepted receipt", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (scope) => window.suiteDesktop!.lanReceipts(scope),
              scope,
            )
          ).length,
      )
      .toBe(4);
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await peer.stop();
    await pool.end();
    await rm(profile, { recursive: true, force: true });
    await fixture.close();
  }
});
