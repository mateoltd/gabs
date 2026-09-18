import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { artifactRelays } from "@suite/module-sdk/relay";
import { publishExecutableFixture } from "../support/executable-fixture";
import { assignHostFixture } from "../support/host-capability-journey";
import { lanFixture } from "../support/lan-fixture";
import {
  LanTransport,
  type RelayEnvelope,
} from "../../apps/desktop/src/main/lan/transport";
const require = createRequire(resolve("apps/desktop/package.json"));
test("resumes received executable chunks across restart and installs with no registry package download", async () => {
  test.setTimeout(150000);
  const workspaceId = randomUUID(),
    moduleId = `package-${randomUUID().slice(0, 8)}`;
  const fixture = await lanFixture(workspaceId, [49180, 49181, 49182]);
  const profile = await mkdtemp(resolve(tmpdir(), "suite-lan-packages-"));
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
    const pkg = await publishExecutableFixture({
      id: moduleId,
      name: "Received package notes",
      sourceDirectory: "tests/fixtures/lan-capabilities",
    });
    const frames: RelayEnvelope[] = [];
    for await (const frame of artifactRelays(pkg))
      frames.push({
        ...frame,
        workspaceId,
        digest: createHash("sha256").update(frame.payload).digest("hex"),
      });
    expect(frames.length).toBeGreaterThan(3);
    await peer.start();
    app = await launch();
    let page = await app.firstWindow();
    const signIn = async () => {
      await page
        .getByRole("button", { name: "Open local workspace", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch workspace", exact: true }),
      ).toBeVisible({ timeout: 20000 });
    };
    const selectCompany = async () => {
      await page
        .getByRole("button", { name: "Switch workspace", exact: true })
        .click();
      await page
        .getByRole("menuitemradio")
        .and(page.locator(`[data-value="${workspaceId}"]`))
        .click();
    };
    const enableLan = async () => {
      await page.getByRole("link", { name: "Settings", exact: true }).click();
      await page
        .getByRole("button", { name: "Enable local network", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Disable local network",
          exact: true,
        }),
      ).toBeVisible();
      await peer.discover();
      expect(
        peer
          .status()
          .peers.some((p) => p.id === fixture.identities.a.fingerprint),
      ).toBe(true);
    };
    await signIn();
    const userId = await page.evaluate(
      async () =>
        (
          (await window.suiteDesktop!.execute({ operation: "me" })).body as {
            user: { id: string };
          }
        ).user.id,
    );
    const scope = { userId, workspaceId },
      selection = { moduleId, version: pkg.version, digest: pkg.digest };
    expect(
      (
        await page.evaluate(
          (id) =>
            window.suiteDesktop!.execute({
              operation: "workspaceCreate",
              body: { id, name: "Package transfer", currency: "EUR" },
              idempotencyKey: crypto.randomUUID(),
            }),
          workspaceId,
        )
      ).status,
    ).toBe(200);
    await page.reload();
    await selectCompany();
    await enableLan();
    for (const frame of frames.slice(0, -1).reverse())
      await peer.relay(fixture.identities.a.fingerprint, frame);
    expect(
      await page.evaluate(
        ({ scope, selection }) =>
          window.suiteDesktop!.receivedPackage(scope, selection),
        { scope, selection },
      ),
    ).toBeUndefined();
    // Partial encrypted receipt state outlives both utility and main processes.
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await signIn();
    await selectCompany();
    await enableLan();
    await peer.relay(fixture.identities.a.fingerprint, frames[0]);
    await peer.relay(fixture.identities.a.fingerprint, frames.at(-1)!);
    await expect(
      page.evaluate(
        ({ scope, selection }) =>
          window.suiteDesktop!.receivedPackage(scope, selection),
        { scope, selection },
      ),
    ).rejects.toThrow("access");
    await assignHostFixture(pool, workspaceId, moduleId);
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [workspaceId, [`${moduleId}.notes.read`, `${moduleId}.notes.write`]],
    );
    expect(
      await page.evaluate(
        async ({ scope, selection }) =>
          (await window.suiteDesktop!.receivedPackage(scope, selection))?.pkg
            .digest,
        { scope, selection },
      ),
    ).toBe(pkg.digest);
    await pool.query(
      "update suite.entitlements set active=false where workspace_id=$1 and module_id=$2",
      [workspaceId, moduleId],
    );
    await expect(
      page.evaluate(
        ({ scope, selection }) =>
          window.suiteDesktop!.receivedPackage(scope, selection),
        { scope, selection },
      ),
    ).rejects.toThrow("access");
    await pool.query(
      "update suite.entitlements set active=true where workspace_id=$1 and module_id=$2",
      [workspaceId, moduleId],
    );
    await app.evaluate((_electron, id) => {
      const original = globalThis.fetch;
      const probe = { full: 0, metadata: 0 };
      (globalThis as unknown as { packageProbe: typeof probe }).packageProbe =
        probe;
      globalThis.fetch = async (...args) => {
        const url = new URL(String(args[0]));
        if (url.pathname.includes(`/module/${id}/`)) {
          if (url.pathname.endsWith("/artifact")) {
            probe.full++;
            throw Error("Full registry download deliberately blocked");
          }
          if (url.pathname.endsWith("/artifact/metadata")) probe.metadata++;
        }
        return original(...args);
      };
    }, moduleId);
    await page.reload();
    await page
      .getByRole("link", { name: "Received package notes", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Module local network", exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect
      .poll(
        async () =>
          (
            await pool.query(
              "select count(*) from suite.module_installations where workspace_id=$1 and module_id=$2 and version=$3 and state='installed'",
              [workspaceId, moduleId, pkg.version],
            )
          ).rows[0].count,
      )
      .toBe("1");
    const probe = await app.evaluate(
      () =>
        (
          globalThis as unknown as {
            packageProbe: { full: number; metadata: number };
          }
        ).packageProbe,
    );
    expect(probe.full).toBe(0);
    expect(probe.metadata).toBeGreaterThanOrEqual(2);
    expect(
      (
        await pool.query(
          "select count(*) from suite.audit where workspace_id=$1 and action='modules.downloaded' and target_id=$2",
          [workspaceId, moduleId],
        )
      ).rows[0].count,
    ).toBe("0");
    expect(
      await page.evaluate(
        ({ scope, selection }) =>
          window.suiteDesktop!.receivedPackage(scope, selection),
        { scope, selection },
      ),
    ).toBeUndefined();
    expect(
      await page.evaluate(
        (scope) => window.suiteDesktop!.lanReceipts(scope),
        scope,
      ),
    ).toEqual([]);
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
