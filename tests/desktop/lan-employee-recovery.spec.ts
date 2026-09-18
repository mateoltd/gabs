import "dotenv/config";
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";
import {
  mkdtemp,
  rm,
  mkdir,
  writeFile,
  readFile,
  stat,
} from "node:fs/promises";
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
test("employees recover only authorized receipts offline and retry uncertain submissions after restart", async () => {
  test.setTimeout(150000);
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
      transform: (filename, source) =>
        filename === "module.ts"
          ? source
              .replace(
                "resources: {",
                'resources: { secrets: resource({ text: field.text() }, { title: "Private notes" }),',
              )
              .replace(
                "permissions: [",
                `permissions: ["${id}.secrets.read", "${id}.secrets.write",`,
              )
          : source,
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
    const scope = { userId, workspaceId };
    const envelope = (
      text: string,
      resource = "notes",
      actor = userId,
    ): RelayEnvelope => {
      const key = randomUUID();
      const payload = JSON.stringify({
        ...scope,
        userId: actor,
        id: key,
        state: "pending",
        createdAt: Date.now(),
        attempts: 0,
        dependencies: [],
        call: {
          moduleId: id,
          moduleVersion: published.version,
          action: "create",
          resource,
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
    const first = envelope("Employee draft"),
      second = envelope("Another employee draft");
    const secret = envelope("Hidden resource contents", "secrets"),
      foreign = envelope("Other account contents", "notes", randomUUID());
    await peer.discover();
    for (const packet of [first, second, secret, foreign])
      await peer.relay(fixture.identities.a.fingerprint, packet);
    const receipts = () =>
      page.evaluate((scope) => window.suiteDesktop!.lanReceipts(scope), scope);
    expect((await receipts()).map((r) => r.id)).toEqual([first.id, second.id]);
    expect(
      (
        await page.evaluate(
          (scope) => window.suiteDesktop!.lanArchive(scope),
          scope,
        )
      ).inboxCount,
    ).toBe(2);
    await expect(
      page.evaluate(
        ({ scope, packet }) =>
          window.suiteDesktop!.exportLanReceipt(scope, {
            id: packet.id,
            digest: packet.digest,
            location: "inbox",
          }),
        { scope, packet: secret },
      ),
    ).rejects.toThrow(/permissions/);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    const open = async () =>
      page.getByRole("button", { name: /^Received drafts/ }).click();
    await open();
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
          name: `Review Staff network notes: Notes: ${text}`,
          exact: true,
        })
        .click();
      return dialog.getByRole("region", {
        name: "Received draft review",
        exact: true,
      });
    };
    await expect(dialog).not.toContainText("Hidden resource contents");
    await expect(dialog).not.toContainText("Other account contents");
    let selected = await review("Employee draft");
    await app.evaluate(() => {
      const original = globalThis.fetch;
      (globalThis as unknown as { originalFetch: typeof fetch }).originalFetch =
        original;
      let lose = true;
      globalThis.fetch = async (...args) => {
        const reply = await original(...args);
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
        return reply;
      };
    });
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    const count = async (table: "module_records" | "audit") =>
      (
        await pool.query(
          table === "module_records"
            ? "select count(*)::int as n from suite.module_records where workspace_id=$1 and module_id=$2"
            : "select count(*)::int as n from suite.audit where workspace_id=$1 and action=$2",
          [workspaceId, table === "module_records" ? id : `${id}.notes.create`],
        )
      ).rows[0].n;
    expect(await count("module_records")).toBe(1);
    await app.close();
    app = undefined;
    const entry = resolve(profile, "offline-recovery.cjs");
    await writeFile(
      entry,
      `globalThis.originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }; require(${JSON.stringify(resolve("apps/desktop/dist/main.cjs"))});`,
    );
    app = await launch(entry);
    page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await open();
    dialog = page.getByRole("dialog", { name: "Received drafts", exact: true });
    selected = await review("Employee draft");
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    await expect(
      selected.getByRole("button", { name: "Retry submission", exact: true }),
    ).toBeDisabled();
    await expect(
      page.evaluate(
        ({ scope, first }) =>
          window.suiteDesktop!.submitLanReceipt(scope, first.id, first.digest),
        { scope, first },
      ),
    ).rejects.toThrow(/Connect/);
    await selected
      .getByRole("button", { name: "Archive draft", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "Draft archived. Its original contents and retry identity are retained.",
        { exact: true },
      ),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /^Archived drafts/ }).click();
    selected = await review("Employee draft");
    await selected
      .getByRole("button", { name: "Restore to inbox", exact: true })
      .click();
    await expect(
      dialog
        .getByRole("status")
        .filter({ hasText: "Draft restored to the inbox" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /^Inbox / }).click();
    selected = await review("Employee draft");
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    await selected
      .getByRole("button", { name: "Archive draft", exact: true })
      .click();
    await expect(
      dialog.getByRole("status").filter({ hasText: "Draft archived" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: /^Archived drafts/ }).click();
    selected = await review("Employee draft");
    const saved = resolve(profile, "employee-recovery.json");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, saved);
    await selected
      .getByRole("button", { name: "Export recovery file", exact: true })
      .click();
    await expect(
      dialog.getByRole("status").filter({ hasText: "Recovery file saved" }),
    ).toBeVisible();
    const file = JSON.parse(await readFile(saved, "utf8"));
    expect(file.envelope).toEqual(first);
    expect(file).not.toHaveProperty("outcome");
    expect((await stat(saved)).mode & 0o077).toBe(0);
    await selected
      .getByRole("button", { name: "Delete archived copy…", exact: true })
      .click();
    await selected
      .getByRole("button", { name: "Delete archived copy", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "No archived drafts are available with your current access.",
        { exact: true },
      ),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "Import recovery file", exact: true })
      .click();
    await expect(
      dialog
        .getByRole("status")
        .filter({ hasText: "Draft restored to the inbox" }),
    ).toBeVisible();
    selected = await review("Employee draft");
    await expect(selected.getByRole("status")).toContainText(
      "Awaiting server confirmation",
    );
    expect(await count("module_records")).toBe(1);
    await mkdir("docs/verification/lan-employee-recovery", { recursive: true });
    await page.screenshot({
      path: "docs/verification/lan-employee-recovery/offline.png",
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
      path: "docs/verification/lan-employee-recovery/narrow.png",
    });
    // Advance only the main-process clock. Expired local authority must not read or export.
    await app.evaluate(() => {
      const original = Date.now;
      (globalThis as unknown as { originalNow: typeof Date.now }).originalNow =
        original;
      Date.now = () => original() + 25 * 3600000;
    });
    await expect(receipts()).rejects.toThrow(/expired|Reconnect|authority/);
    await expect(
      page.evaluate(
        ({ scope, first }) =>
          window.suiteDesktop!.exportLanReceipt(scope, {
            id: first.id,
            digest: first.digest,
            location: "inbox",
          }),
        { scope, first },
      ),
    ).rejects.toThrow(/expired|Reconnect|authority/);
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setSize(1440, 1000);
      Date.now = (
        globalThis as unknown as { originalNow: typeof Date.now }
      ).originalNow;
      globalThis.fetch = (
        globalThis as unknown as { originalFetch: typeof fetch }
      ).originalFetch;
    });
    await page.evaluate(() => window.suiteDesktop!.login());
    await page.reload();
    await open();
    dialog = page.getByRole("dialog", { name: "Received drafts", exact: true });
    selected = await review("Employee draft");
    await selected
      .getByRole("button", { name: "Retry submission", exact: true })
      .click();
    await expect(selected.getByRole("status")).toHaveText(
      "Accepted by the authoritative server.",
    );
    expect(await count("module_records")).toBe(1);
    expect(await count("audit")).toBe(1);
    await page.evaluate(
      ({ scope, first }) =>
        window.suiteDesktop!.submitLanReceipt(scope, first.id, first.digest),
      { scope, first },
    );
    expect(await count("audit")).toBe(1);
    // Fresh server write permission remains mandatory even when read/relay grants still permit review.
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where id=$1",
      [staffRole, `${id}.notes.write`],
    );
    selected = await review("Another employee draft");
    await selected
      .getByRole("button", { name: "Submit to server", exact: true })
      .click();
    await expect
      .poll(
        async () => (await receipts()).find((r) => r.id === second.id)?.state,
      )
      .toBe("rejected");
    expect(await count("module_records")).toBe(1);
    // A permission change while the native save dialog is pending cancels the effect.
    const forbiddenPath = resolve(profile, "revoked-export.json");
    await app.evaluate(({ dialog }) => {
      dialog.showSaveDialog = () =>
        new Promise((resolve) => {
          (globalThis as unknown as { heldSave: typeof resolve }).heldSave =
            resolve;
        });
    });
    await selected
      .getByRole("button", { name: "Export recovery file", exact: true })
      .click();
    await expect
      .poll(() =>
        app!.evaluate(
          () =>
            typeof (globalThis as unknown as { heldSave?: unknown }).heldSave,
        ),
      )
      .toBe("function");
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where id=$1",
      [staffRole, `${id}.notes.read`],
    );
    await app.evaluate((_electron, path) => {
      (
        globalThis as unknown as {
          heldSave: (result: { canceled: boolean; filePath: string }) => void;
        }
      ).heldSave({ canceled: false, filePath: path });
    }, forbiddenPath);
    await expect(dialog.getByRole("alert")).toContainText(
      /permissions|authority/,
    );
    await expect(
      dialog.getByRole("region", { name: "Received draft review" }),
    ).toHaveCount(0);
    await expect(dialog).not.toContainText("Another employee draft");
    await expect(stat(forbiddenPath)).rejects.toThrow();
    expect(await receipts()).toEqual([]);
    await page.screenshot({
      path: "docs/verification/lan-employee-recovery/revoked.png",
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
        "/tmp/gabs-employee-recovery-page.txt",
        await page.locator("body").innerText(),
      );
      await page.screenshot({ path: "/tmp/gabs-employee-recovery-page.png" });
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
