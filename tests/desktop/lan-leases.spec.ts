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
test("leased LAN effects use real TLS while server transport is unavailable and reject revoked offline replay", async () => {
  test.setTimeout(90000);
  const workspaceId = randomUUID(),
    id = `lan-lease-${randomUUID().slice(0, 8)}`;
  const fixture = await lanFixture(workspaceId, [49180, 49181, 49182]);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-lan-lease-"));
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const received: RelayEnvelope[] = [];
  const peer = new LanTransport(fixture.config("b"), async (packet) => {
    received.push(packet);
  });
  let app: ElectronApplication | undefined;
  try {
    await publishExecutableFixture({
      id,
      name: "Leased network notes",
      sourceDirectory: "tests/fixtures/lan-capabilities",
    });
    await peer.start();
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
        SUITE_LAN_PEERS: fixture.identities.b.fingerprint,
        SUITE_LAN_ADDRESSES: "127.0.0.1",
      },
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000),
    );
    const page = await app.firstWindow();
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
    await page
      .getByRole("button", { name: "Enable local network", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disable local network", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Leased network notes", exact: true })
      .click();
    await expect(
      page.getByText(
        /^Offline access for local peer status and local network transfers until/,
      ),
    ).toBeVisible({ timeout: 20000 });
    const area = page.getByRole("region", {
      name: "Module local network",
      exact: true,
    });
    // Main-owned authorization must fall back to a verified lease, regardless of renderer connectivity flags.
    await app.evaluate(() => {
      const state = globalThis as unknown as {
        lanOriginalFetch: typeof fetch;
        blockedLanRequests: number;
      };
      state.lanOriginalFetch = globalThis.fetch;
      state.blockedLanRequests = 0;
      globalThis.fetch = async () => {
        state.blockedLanRequests++;
        throw new TypeError("fetch failed", {
          cause: { code: "ECONNREFUSED" },
        });
      };
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
    await mkdir("docs/verification/lan-leases", { recursive: true });
    await page.screenshot({ path: "docs/verification/lan-leases/offline.png" });
    await app.evaluate(() => {
      globalThis.fetch = (
        globalThis as unknown as { lanOriginalFetch: typeof fetch }
      ).lanOriginalFetch;
    });
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [workspaceId, `${id}.network`],
    );
    await area
      .getByRole("button", { name: "Transfer draft", exact: true })
      .click();
    await expect(area.getByRole("alert")).toBeVisible();
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
  } finally {
    await app?.close();
    await peer.stop();
    await pool.end();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
