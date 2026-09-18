import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { publishExecutableFixture } from "../support/executable-fixture";
import { assignHostFixture } from "../support/host-capability-journey";
import { lanFixture } from "../support/lan-fixture";
import {
  LanTransport,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
const require = createRequire(resolve("apps/desktop/package.json"));
test("employee module grants enable LAN after offline process restart and reject revoked replay", async () => {
  test.setTimeout(90000);
  const workspaceId = randomUUID(),
    id = `lan-staff-${randomUUID().slice(0, 8)}`;
  const fixture = await lanFixture(workspaceId, [49180, 49181, 49182]);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-lan-staff-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const received: RelayEnvelope[] = [];
  const peer = new LanTransport(fixture.config("b"), async (packet) => {
    received.push(packet);
  });
  let app: ElectronApplication | undefined;
  const launch = async (entry = resolve("apps/desktop/dist/main.cjs")) => {
    const launched = await electron.launch({
      executablePath: require("electron"),
      args: [entry, `--user-data-dir=${profile}`],
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
    await launched.firstWindow();
    await launched.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    return launched;
  };
  try {
    const published = await publishExecutableFixture({
      id,
      name: "Staff network notes",
      sourceDirectory: "tests/fixtures/lan-capabilities",
    });
    await peer.start();
    app = await launch();
    let page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const created = await page.evaluate(
      (workspaceId) =>
        window.suiteDesktop!.execute({
          operation: "workspaceCreate",
          body: {
            id: workspaceId,
            name: "Leased local network",
            currency: "EUR",
          },
          idempotencyKey: crypto.randomUUID(),
        }),
      workspaceId,
    );
    expect(created.status).toBe(200);
    await assignHostFixture(pool, workspaceId, id);
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [workspaceId, [`${id}.notes.read`, `${id}.notes.write`]],
    );
    const me = await page.evaluate(() =>
      window.suiteDesktop!.execute({ operation: "me" }),
    );
    const userId = (me.body as { user: { id: string } }).user.id;
    const staffRole = randomUUID();
    const root = (
      await pool.query(
        "select id from suite.roles where workspace_id=$1 and protected",
        [workspaceId],
      )
    ).rows[0].id;
    await pool.query(
      "insert into suite.roles(id,workspace_id,name,permissions,protected) values($1,$2,'Network staff',$3,false)",
      [
        staffRole,
        workspaceId,
        [
          `${id}.open`,
          `${id}.network`,
          `${id}.notes.read`,
          `${id}.notes.write`,
        ],
      ],
    );
    await pool.query(
      "update suite.platform_settings set value=jsonb_set(value,'{ranks}',(value->'ranks') || $2::jsonb) where workspace_id=$1 and key='organization'",
      [
        workspaceId,
        JSON.stringify([
          {
            id: staffRole,
            name: "Network staff",
            parents: [root],
            inherit: false,
            denies: [],
            x: 0,
            y: 100,
          },
        ]),
      ],
    );
    // Keep a separate administrator while this account becomes an ordinary company member.
    const administrator = randomUUID();
    await pool.query(
      "insert into suite.memberships(id,workspace_id,user_id) select $1,$2,id from suite.users where email='viewer@demo.local'",
      [administrator, workspaceId],
    );
    await pool.query(
      "insert into suite.role_assignments(workspace_id,membership_id,role_id) values($1,$2,$3)",
      [workspaceId, administrator, root],
    );
    await pool.query(
      "update suite.role_assignments set role_id=$3 where workspace_id=$1 and membership_id in (select id from suite.memberships where workspace_id=$1 and user_id=$2)",
      [workspaceId, userId, staffRole],
    );
    const policy = await page.evaluate(
      (workspaceId) =>
        window.suiteDesktop!.execute({
          operation: "bootstrap",
          params: { workspaceId },
        }),
      workspaceId,
    );
    expect(
      (policy.body as { permissions: string[] }).permissions,
    ).not.toContain("modules.manage");
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
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
    await expect(
      page.getByRole("combobox", { name: "Network access" }),
    ).toContainText("Staff network notes");
    const access = page.getByRole("combobox", { name: "Network access" });
    await access.focus();
    await access.press("ArrowDown");
    await access.press("Enter");

    await expect(
      page.getByRole("button", { name: /Received drafts/ }),
    ).toHaveCount(0);
    await expect(
      page.evaluate(
        ({ userId, workspaceId }) =>
          window.suiteDesktop!.setLan({ userId, workspaceId }, true),
        { userId, workspaceId },
      ),
    ).rejects.toThrow(/administrator|authorization changed/);
    await page
      .getByRole("button", { name: "Enable local network", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disable local network", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Staff network notes", exact: true })
      .click();
    await expect(
      page.getByText(
        /^Offline access for local peer status and local network transfers until/,
      ),
    ).toBeVisible({ timeout: 20000 });
    await app.close();
    app = undefined;
    const entry = resolve(profile, "offline-entry.cjs");
    await writeFile(
      entry,
      `globalThis.nativeOriginalFetch = globalThis.fetch; globalThis.blockedLanRequests = 0; globalThis.fetch = async () => { globalThis.blockedLanRequests++; throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }; require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
    );
    app = await launch(entry);
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Enable local network", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      page.evaluate(
        ({ userId, workspaceId, id, version }) =>
          window.suiteDesktop!.setLan({ userId, workspaceId }, true, {
            moduleId: id,
            moduleVersion: version,
            capability: "peers",
          }),
        { userId, workspaceId, id, version: published.version },
      ),
    ).rejects.toThrow(/relay grant/);
    await page
      .getByRole("button", { name: "Enable local network", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disable local network", exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/lan-authority", { recursive: true });
    await page.screenshot({
      path: "docs/verification/lan-authority/offline-settings.png",
    });
    await expect(
      page.getByRole("heading", { name: "Workspace policy", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page
      .getByRole("option", { name: "High contrast", exact: true })
      .click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(390, 844),
    );
    await page.locator("#local-network").scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include("#main-content")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: "docs/verification/lan-authority/offline-narrow.png",
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();

    await page
      .getByRole("link", { name: "Staff network notes", exact: true })
      .click();
    const area = page.getByRole("region", {
      name: "Module local network",
      exact: true,
    });
    await area
      .getByRole("button", { name: "Inspect local network", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("1 authorized peers");
    await area
      .getByRole("button", { name: "Transfer draft", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText(
      "Draft transferred; server acceptance required",
    );
    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0].payload)).toMatchObject({
      workspaceId,
      state: "pending",
      call: { moduleId: id },
    });
    expect(
      await app.evaluate(
        () =>
          (globalThis as unknown as { blockedLanRequests: number })
            .blockedLanRequests,
      ),
    ).toBeGreaterThan(0);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, id],
        )
      ).rows[0].n,
    ).toBe(0);
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include("#main-content")
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/lan-authority", { recursive: true });
    await page.screenshot({
      path: "docs/verification/lan-authority/offline.png",
    });
    // Only the application's wall clock changes; the user's OS clock and network remain untouched.
    for (const delta of [25 * 3600000, -300000]) {
      await app.evaluate((_electron, delta) => {
        const state = globalThis as unknown as { lanRealNow: typeof Date.now };
        state.lanRealNow = Date.now;
        Date.now = () => state.lanRealNow() + delta;
      }, delta);
      await expect(
        page.evaluate(
          ({ userId, workspaceId, id, version }) =>
            window.suiteDesktop!.setLan({ userId, workspaceId }, true, {
              moduleId: id,
              moduleVersion: version,
              capability: "relay",
            }),
          { userId, workspaceId, id, version: published.version },
        ),
      ).rejects.toThrow();
      expect(
        await page.evaluate((scope) => window.suiteDesktop!.lanStatus(scope), {
          userId,
          workspaceId,
        }),
      ).toMatchObject({ enabled: false, peers: [] });
      await app.evaluate(() => {
        Date.now = (
          globalThis as unknown as { lanRealNow: typeof Date.now }
        ).lanRealNow;
        globalThis.fetch = (
          globalThis as unknown as { nativeOriginalFetch: typeof fetch }
        ).nativeOriginalFetch;
      });
      // The development session cookie is intentionally not retained across process restart.
      // Reauthenticate before acquiring fresh authority after an invalid clock/lease.
      await page.evaluate(() => window.suiteDesktop!.login());
      await page.reload();
      await expect(area).toBeVisible();
      await expect(
        page.getByText(
          /^Offline access for local peer status and local network transfers until/,
        ),
      ).toBeVisible({ timeout: 20000 });
      await app.evaluate(() => {
        globalThis.fetch = async () => {
          throw new TypeError("fetch failed", {
            cause: { code: "ECONNREFUSED" },
          });
        };
      });
      expect(
        await page.evaluate(
          ({ userId, workspaceId, id, version }) =>
            window.suiteDesktop!.setLan({ userId, workspaceId }, true, {
              moduleId: id,
              moduleVersion: version,
              capability: "relay",
            }),
          { userId, workspaceId, id, version: published.version },
        ),
      ).toMatchObject({ enabled: true });
    }
    await app.evaluate(() => {
      globalThis.fetch = (
        globalThis as unknown as { nativeOriginalFetch: typeof fetch }
      ).nativeOriginalFetch;
    });
    await area
      .getByRole("button", { name: "Inspect local network", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("1 authorized peers");
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspaceId, `${id}.network`],
    );
    await area
      .getByRole("button", { name: "Transfer draft", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      /permissions|not allow/,
    );
    await app.evaluate(() => {
      globalThis.fetch = async () => {
        throw new TypeError("fetch failed", {
          cause: { code: "ECONNREFUSED" },
        });
      };
    });
    await area
      .getByRole("button", { name: "Transfer draft", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Action needs attention");
    expect(received).toHaveLength(1);
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
        "/tmp/gabs-lan-auth-page.txt",
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: "/tmp/gabs-lan-auth-page.png" });
    }
    throw error;
  } finally {
    await app?.close();
    await peer.stop();
    await pool.end();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
