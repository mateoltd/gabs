import "dotenv/config";
import {
  test,
  request as apiRequest,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
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
test("received drafts reconcile remote prerequisites and original releases without duplicate effects", async () => {
  test.setTimeout(150000);
  const workspaceId = randomUUID(),
    moduleId = `recovery-${randomUUID().slice(0, 8)}`;
  const fixture = await lanFixture(workspaceId, [49180, 49181, 49182]);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-relay-recovery-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const peer = new LanTransport(fixture.config("b"), async () => {});
  const remote = await apiRequest.newContext({
    baseURL: "http://localhost:4310",
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
    expect(
      (
        await remote.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "owner@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    const remoteIdentity = await (await remote.get("/api/v1/me")).json();
    expect(remoteIdentity.user.id).toBe(userId);
    const parent = `remote:notes/${randomUUID()}.v1+draft=1`;
    const committed = await remote.post(
      `/api/v1/module/${moduleId}/workspaces/${workspaceId}/records`,
      {
        headers: {
          origin: "http://localhost:4300",
          "x-csrf-token": remoteIdentity.csrfToken,
          "idempotency-key": parent,
          "x-module-version": published.version,
        },
        data: {
          resource: "notes",
          action: "create",
          input: { data: { text: "Accepted on another device" } },
        },
      },
    );
    expect(committed.status()).toBe(200);
    // Retry the remote request through renderer IPC with the exact opaque key.
    const replayed = await page.evaluate(
      ({ workspaceId, moduleId, key, version }) =>
        window.suiteDesktop!.execute({
          operation: "moduleRequest",
          params: { workspaceId, moduleId },
          idempotencyKey: key,
          moduleVersion: version,
          body: {
            resource: "notes",
            action: "create",
            input: { data: { text: "Accepted on another device" } },
          },
        }),
      { workspaceId, moduleId, key: parent, version: published.version },
    );
    expect(replayed.status, JSON.stringify(replayed.body)).toBe(200);
    expect(replayed.body).toEqual(await committed.json());
    const packet = (
      text: string,
      version = published.version,
      dependencies: string[] = [],
    ): RelayEnvelope => {
      const key = `office:notes/${randomUUID()}@capture`;
      const payload = JSON.stringify({
        ...scope,
        id: key,
        state: "pending",
        createdAt: Date.now(),
        attempts: 0,
        dependencies,
        call: {
          moduleId,
          moduleVersion: version,
          action: "create",
          resource: "notes",
          input: { data: { text } },
        },
      });
      return {
        id: key,
        workspaceId,
        kind: "pending",
        payload,
        digest: createHash("sha256").update(payload).digest("hex"),
      };
    };
    const dependent = packet("Remote prerequisite", published.version, [
      parent,
    ]);
    const missing = packet("Unresolved prerequisite", published.version, [
      `absent:notes/${randomUUID()}`,
    ]);
    const retained = packet("Original release draft"),
      blocked = packet("Unconfirmed old release");
    await peer.discover();
    for (const entry of [dependent, missing, retained, blocked])
      await peer.relay(fixture.identities.a.fingerprint, entry);
    await page.getByRole("button", { name: /^Received drafts/ }).click();
    let dialog = page.getByRole("dialog", {
      name: "Received drafts",
      exact: true,
    });
    const review = async (text: string) => {
      await expect(dialog.locator("[aria-busy]").first()).toHaveAttribute(
        "aria-busy",
        "false",
      );
      const back = dialog.getByRole("button", {
        name: "Back to received drafts",
        exact: true,
      });
      if (await back.isVisible()) await back.click();
      await dialog
        .getByRole("button", {
          name: `Review Network notes: Notes: ${text}`,
          exact: true,
        })
        .click();
      return dialog.getByRole("region", {
        name: "Received draft review",
        exact: true,
      });
    };
    let selected = await review("Unresolved prerequisite");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText("dependencies");
    selected = await review("Remote prerequisite");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    const latest = await publishExecutableFixture({
      id: moduleId,
      name: "Network notes",
      sourceDirectory: "tests/fixtures/lan-capabilities",
    });
    expect(latest.version).not.toBe(published.version);
    let policyVersion = 0;
    const rollout = async (mandatory: boolean) => {
      const result = await page.evaluate(
        ({
          workspaceId,
          moduleId,
          version,
          original,
          mandatory,
          policyVersion,
        }) =>
          window.suiteDesktop!.execute({
            operation: "platformCommand",
            params: { workspaceId },
            idempotencyKey: crypto.randomUUID(),
            body: {
              action: "rollout",
              version: policyVersion,
              value: {
                moduleId,
                version,
                mandatory,
                acceptedVersions: mandatory ? [] : [original],
              },
            },
          }),
        {
          workspaceId,
          moduleId,
          version: latest.version,
          original: published.version,
          mandatory,
          policyVersion,
        },
      );
      expect(result.status, JSON.stringify(result.body)).toBe(200);
      policyVersion++;
    };
    selected = await review("Original release draft");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toContainText(
      "administrator must permit",
    );
    await expect(selected).toContainText(
      `Original module release: ${published.version}`,
    );
    await rollout(false);
    // Lose the successful old-release reply, then disallow new old-release execution.
    await app.evaluate(() => {
      const original = globalThis.fetch;
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
      .getByRole("button", { name: "Retry submission", exact: true })
      .click();
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    await rollout(true);
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
    ).toBeVisible();
    await selectCompany();
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: /^Received drafts/ }).click();
    dialog = page.getByRole("dialog", { name: "Received drafts", exact: true });
    selected = await review("Original release draft");
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    await selected
      .getByRole("button", { name: "Retry submission", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    selected = await review("Unconfirmed old release");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toContainText(
      "administrator must permit",
    );
    await page.evaluate(
      (scope) => window.suiteDesktop!.setLan(scope, true),
      scope,
    );
    await peer.discover();
    const current = packet("Current independent work", latest.version);
    await peer.relay(fixture.identities.a.fingerprint, current);
    selected = await review("Current independent work");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    const records = await pool.query(
      "select count(*)::int as n from suite.module_records where workspace_id=$1 and module_id=$2",
      [workspaceId, moduleId],
    );
    expect(records.rows[0].n).toBe(4);
    const audits = await pool.query(
      "select count(*)::int as n from suite.audit where workspace_id=$1 and action=$2",
      [workspaceId, `${moduleId}.notes.create`],
    );
    expect(audits.rows[0].n).toBe(4);
    const retry = await pool.query(
      "select count(*)::int as n from suite.idempotency where workspace_id=$1 and actor_id=$2 and key=$3",
      [workspaceId, userId, retained.id],
    );
    expect(retry.rows[0].n).toBe(1);
    selected = await review("Unconfirmed old release");
    await mkdir("docs/verification/lan-reconciliation", { recursive: true });
    await page.screenshot({
      path: "docs/verification/lan-reconciliation/release.png",
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(390, 844),
    );
    expect(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth + 1),
    ).toBe(true);
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
      path: "docs/verification/lan-reconciliation/narrow.png",
    });
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().every(
          (w) => !w.isFocused() && (!w.isVisible() || w.isMinimized()),
        ),
      ),
    ).toBe(true);
  } catch (error) {
    if (app) {
      const page = await app.firstWindow();
      await writeFile(
        "/tmp/gabs-reconciliation-page.txt",
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: "/tmp/gabs-reconciliation-page.png" });
    }
    throw error;
  } finally {
    await app?.close();
    await remote.dispose();
    await peer.stop();
    await pool.end();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
