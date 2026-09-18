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
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { publishExecutableFixture } from "../support/executable-fixture";
import { assignHostFixture } from "../support/host-capability-journey";
import { lanFixture } from "../support/lan-fixture";
import {
  LanTransport,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
const require = createRequire(resolve("apps/desktop/package.json"));
async function hidden(app: ElectronApplication) {
  expect(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (window) =>
          !window.isFocused() && (!window.isVisible() || window.isMinimized()),
      ),
    ),
  ).toBe(true);
}
test("hidden desktop SDK relays only scoped drafts to managed TLS peers and revokes the listener", async () => {
  test.setTimeout(150000);
  const workspaceId = randomUUID(),
    foreignWorkspace = randomUUID(),
    id = `native-lan-${randomUUID().slice(0, 8)}`;
  const fixture = await lanFixture(workspaceId, [49180, 49181, 49182]);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-native-lan-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const received: RelayEnvelope[] = [];
  const peer = new LanTransport(fixture.config("b"), async (envelope) => {
    received.push(envelope);
  });
  const foreign = new LanTransport(
    fixture.config("c", foreignWorkspace),
    async () => {
      throw Error("Foreign workspace must never receive content");
    },
  );
  let app: ElectronApplication | undefined;
  let joined: LanTransport | undefined;
  try {
    await publishExecutableFixture({
      id,
      name: "Network notes",
      sourceDirectory: "tests/fixtures/lan-capabilities",
    });
    await peer.start();
    await foreign.start();
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
        SUITE_DESKTOP_TEST_MINIMIZED: "1",
        SUITE_LAN_WORKSPACE: workspaceId,
        SUITE_LAN_CERT: resolve(fixture.directory, "a.crt"),
        SUITE_LAN_KEY: resolve(fixture.directory, "a.key"),
        SUITE_LAN_CA: resolve(fixture.directory, "ca.crt"),
        SUITE_LAN_PEERS: [
          fixture.identities.b.fingerprint,
          fixture.identities.c.fingerprint,
        ].join(","),
        SUITE_LAN_ADDRESSES: "127.0.0.1",
      },
    });
    await hidden(app);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    const page = await app.firstWindow();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page
      .getByRole("button", { name: "Open local workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await page.evaluate(
      async () =>
        (await window.suiteDesktop!.execute({ operation: "me" })).body as {
          user: { id: string };
          workspaces: { id: string; kind: string }[];
        },
    );
    const scope = { userId: me.user.id, workspaceId };
    const personalScope = {
      userId: me.user.id,
      workspaceId: me.workspaces.find((w) => w.kind === "personal")!.id,
    };
    expect(
      (
        await page.evaluate(
          (workspaceId) =>
            window.suiteDesktop!.execute({
              operation: "workspaceCreate",
              body: {
                id: workspaceId,
                name: "Managed local network",
                currency: "EUR",
              },
              idempotencyKey: crypto.randomUUID(),
            }),
          workspaceId,
        )
      ).status,
    ).toBe(200);
    await assignHostFixture(pool, workspaceId, id);
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [workspaceId, [`${id}.notes.read`, `${id}.notes.write`]],
    );
    await page.reload();
    await page
      .getByRole("button", { name: "Switch workspace", exact: true })
      .click();
    await page
      .getByRole("menuitemradio")
      .and(page.locator(`[data-value="${workspaceId}"]`))
      .click();
    await page
      .getByRole("link", { name: "Network notes", exact: true })
      .click();
    const area = page.getByRole("region", {
      name: "Module local network",
      exact: true,
    });
    await area
      .getByRole("button", { name: "Inspect local network", exact: true })
      .click();
    await expect(area.getByRole("status")).toHaveText("Local network disabled");
    const networkStatus = page.getByRole("contentinfo", {
      name: "Workspace status",
    });
    await expect(networkStatus).toHaveCount(0);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Enable local network", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disable local network", exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/native-lan", { recursive: true });
    await page
      .getByRole("heading", { name: "Local network", exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: "docs/verification/native-lan/settings.png",
    });
    const enabled = await page.evaluate(
      (scope) => window.suiteDesktop!.lanStatus(scope),
      scope,
    );
    expect(enabled.enabled).toBe(true);
    expect(enabled.port).toBe(49182);
    expect(enabled.peers.map((p) => p.id)).toEqual([
      fixture.identities.b.fingerprint,
    ]);
    await expect(networkStatus).toHaveText("Local network: 1 peer connected");
    await expect(
      page.getByText("1 peer connected", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Network notes", exact: true })
      .click();
    const statusLink = networkStatus.getByRole("link");
    await statusLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#local-network")).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Disable local network", exact: true }),
    ).toBeInViewport();
    await mkdir("docs/verification/lan-status", { recursive: true });
    await page.screenshot({ path: "docs/verification/lan-status/wide.png" });
    const switchWorkspace = async (value: string) => {
      await page
        .getByRole("button", { name: "Switch workspace", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .and(page.locator(`[data-value="${value}"]`))
        .click();
    };
    await switchWorkspace(personalScope.workspaceId);
    await expect(networkStatus).toHaveCount(0);
    await switchWorkspace(workspaceId);
    await expect(networkStatus).toHaveText("Local network: 1 peer connected");
    // A newly authenticated peer updates the indicator without the polling fallback.
    await statusLink.focus();
    await foreign.stop();
    joined = new LanTransport(fixture.config("c"), async () => {});
    await joined.start();
    await expect(networkStatus).toHaveText("Local network: 2 peers connected", {
      timeout: 3000,
    });
    await expect(statusLink).toBeFocused();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(390, 844),
    );
    await expect(statusLink).toBeInViewport();
    await statusLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#local-network")).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: "docs/verification/lan-status/narrow.png" });
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page
      .getByRole("option", { name: "High contrast", exact: true })
      .click();
    await expect(statusLink).toBeInViewport();
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include(".workspace-status")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await page.screenshot({
      path: "docs/verification/lan-status/contrast.png",
    });
    await page.getByRole("combobox", { name: "Theme", exact: true }).click();
    await page.getByRole("option", { name: "Dark", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    await statusLink.focus();
    await joined.stop();
    // Exercise the real one-minute heartbeat and its native change event.
    await expect(networkStatus).toHaveText("Local network: 1 peer connected", {
      timeout: 70000,
    });
    await expect(statusLink).toBeFocused();
    await hidden(app);

    expect(
      await page.evaluate(
        (scope) => window.suiteDesktop!.lanStatus(scope),
        personalScope,
      ),
    ).toMatchObject({ enabled: false, configured: false, peers: [] });
    await expect(
      page.evaluate(
        (scope) => window.suiteDesktop!.setLan(scope, true),
        personalScope,
      ),
    ).rejects.toThrow("peer policy must be configured");
    expect(
      await page.evaluate(async (scope) => {
        let changes = 0;
        const unsubscribe = window.suiteDesktop!.onLanChanged(() => {
          changes++;
        });
        unsubscribe();
        unsubscribe();
        await window.suiteDesktop!.setLan(scope, true);
        return changes;
      }, scope),
    ).toBe(0);
    await page
      .getByRole("link", { name: "Network notes", exact: true })
      .click();
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
      ...scope,
      state: "pending",
      call: { moduleId: id },
    });
    expect(received[0].workspaceId).toBe(workspaceId);
    // Remote receipt cannot finalize corporate state.
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, id],
        )
      ).rows[0].count,
    ).toBe("0");
    await area
      .getByRole("button", { name: "Try foreign module", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText(
      "must belong to this module and workspace",
    );
    expect(received).toHaveLength(1);
    expect(await page.evaluate(() => "relay" in window.suiteDesktop!)).toBe(
      false,
    );
    await expect(
      page.evaluate(
        (scope) =>
          window.suiteDesktop!.cacheRead(scope, "relay-inbox" as never),
        scope,
      ),
    ).rejects.toThrow();
    // Incoming envelopes are accepted only into main-owned encrypted quarantine.
    await peer.discover();
    const nativePeer = peer
      .status()
      .peers.find((p) => p.id === fixture.identities.a.fingerprint)!;
    expect(nativePeer).toBeDefined();
    expect(peer.status().discovery.coordinatedPeers).toBe(1);
    expect(peer.status().discovery.coordinator).toBe(
      [
        fixture.identities.a.fingerprint,
        fixture.identities.b.fingerprint,
      ].sort()[0],
    );
    const scanAttempts = peer.status().discovery.attempts;
    await peer.discover();
    expect(peer.status().discovery.attempts).toBe(scanAttempts);
    const incoming = Array.from({ length: 6 }, (_, index): RelayEnvelope => {
      const payload = JSON.stringify({
        ...scope,
        state: "pending",
        call: { moduleId: id },
        text: `Inbound ${index}`,
      });
      return {
        id: `inbound-${index}`,
        kind: "pending",
        workspaceId,
        payload,
        digest: createHash("sha256").update(payload).digest("hex"),
      };
    });
    await Promise.all(
      incoming.map((envelope) => peer.relay(nativePeer.id, envelope)),
    );
    await peer.relay(nativePeer.id, incoming[0]);
    const changed = { ...incoming[0], payload: "changed" };
    changed.digest = createHash("sha256").update(changed.payload).digest("hex");
    await expect(peer.relay(nativePeer.id, changed)).rejects.toThrow("refused");
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_records where workspace_id=$1 and module_id=$2",
          [workspaceId, id],
        )
      ).rows[0].count,
    ).toBe("0");
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspaceId, `${id}.network`],
    );
    await area
      .getByRole("button", { name: "Transfer draft", exact: true })
      .click();
    await expect(area.getByRole("alert")).toContainText("current permissions");
    expect(received).toHaveLength(1);
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode()
          .include("#main-content")
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await mkdir("docs/verification/native-lan", { recursive: true });
    await page.screenshot({ path: "docs/verification/native-lan/revoked.png" });
    // The denied module call may already suspend the transport. Start a fresh
    // administrator-authorized session before proving lease revocation itself.
    await page.evaluate(
      (scope) => window.suiteDesktop!.setLan(scope, true),
      scope,
    );
    await pool.query(
      "update suite.workspaces set offline_hours=0 where id=$1",
      [workspaceId],
    );
    expect(
      (
        await page.evaluate(
          (workspaceId) =>
            window.suiteDesktop!.execute({
              operation: "bootstrap",
              params: { workspaceId },
            }),
          workspaceId,
        )
      ).status,
    ).toBe(200);
    await expect
      .poll(() =>
        page.evaluate((scope) => window.suiteDesktop!.lanStatus(scope), scope),
      )
      .toMatchObject({ enabled: false, peers: [] });
    await expect(networkStatus).toHaveCount(0, { timeout: 3000 });
    await peer.heartbeat();
    expect(peer.status().peers).toEqual([]);
    await expect(
      page.evaluate((scope) => window.suiteDesktop!.setLan(scope, true), scope),
    ).rejects.toThrow(/offline lease|authorization changed/);
    await pool.query(
      "update suite.workspaces set offline_hours=24 where id=$1",
      [workspaceId],
    );
    await page.evaluate(
      (scope) => window.suiteDesktop!.setLan(scope, true),
      scope,
    );
    await peer.discover();
    expect(peer.status().peers.map((p) => p.id)).toEqual([
      fixture.identities.a.fingerprint,
    ]);
    await expect(networkStatus).toHaveText("Local network: 1 peer connected");
    await page.evaluate(() => window.suiteDesktop!.logout());
    await expect(networkStatus).toHaveCount(0, { timeout: 3000 });
    await peer.heartbeat();
    expect(peer.status().peers).toEqual([]);
    await hidden(app);
    expect(pageErrors).toEqual([]);
  } finally {
    await app?.close();
    await Promise.all([peer.stop(), foreign.stop(), joined?.stop()]);
    await pool.end();
    await rm(profile, { recursive: true, force: true });
    await fixture.close();
  }
});
