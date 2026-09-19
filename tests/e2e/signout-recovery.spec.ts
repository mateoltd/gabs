import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";
import { Pool } from "pg";
import { mkdir } from "node:fs/promises";
import { selectValue } from "./controls.helpers";
async function signOut(page: Page, reload = false) {
  const navigation = reload ? page.waitForEvent("domcontentloaded") : undefined;
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await navigation;
}
async function signIn(page: Page, workspaceId: string) {
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", workspaceId);
}
for (const restartBeforeSignOut of [false, true])
  test(`offline sign-out preserves pending work and terminates the old session on reconnect, cold start ${restartBeforeSignOut}`, async ({
    page,
    context,
  }) => {
    const f = await setupOfflinePolicy(page);
    await context.setOffline(true);
    const original = await f.capture();
    if (restartBeforeSignOut) await page.reload();
    await signOut(page, true);
    await expect(
      page.getByRole("heading", {
        name: "Connect to open your workspace",
        exact: true,
      }),
    ).toBeVisible();
    expect((await f.stored()).state.journal).toEqual([original]);
    await context.setOffline(false);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Open workspace", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await page.request.get("/api/v1/me")).status())
      .toBe(401);
    expect((await f.stored()).state.journal).toEqual([original]);
    await signIn(page, f.scope.workspaceId);
    await expect
      .poll(async () => (await f.stored()).state.journal[0]?.state)
      .toBe("accepted");
    expect((await f.stored()).state.journal[0]?.id).toBe(original.id);
  });

test("online sign-out locks a disconnected tab and retains an uncertain accepted request for exact recovery", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("row").filter({ hasText: "Policy contact" }),
  ).toBeVisible();
  await second.route("**/api/v1/**", (route) => route.abort());
  await context.setOffline(true);
  const original = await f.capture();
  let accepted!: () => void;
  const committed = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  await page.route(`**${f.records}`, async (route) => {
    if (
      route.request().method() !== "POST" ||
      route.request().postDataJSON()?.action !== "update"
    )
      return route.continue();
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    accepted();
    await route.abort();
  });
  await page.route("**/module-receipts", (route) => route.abort());
  await context.setOffline(false);
  await committed;
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.delivery)
    .toBe("uncertain");
  await signOut(page);
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toBeVisible();
  await expect(
    second.getByRole("row").filter({ hasText: "Policy contact" }),
  ).toHaveCount(0);
  await expect(
    second.getByRole("heading", {
      name: "Profile access is locked",
      exact: true,
    }),
  ).toBeVisible();
  await mkdir("docs/verification/signout-recovery", { recursive: true });
  await second.screenshot({
    path: "docs/verification/signout-recovery/locked-wide.png",
  });
  await second.setViewportSize({ width: 390, height: 844 });
  expect(
    await second.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await second.screenshot({
    path: "docs/verification/signout-recovery/locked-narrow.png",
  });
  const saved = (await f.stored()).state.journal[0]!;
  expect(saved.delivery).toBe("uncertain");
  expect({
    id: saved.id,
    call: saved.call,
    dependencies: saved.dependencies,
  }).toEqual({
    id: original.id,
    call: original.call,
    dependencies: original.dependencies,
  });
  await page.unroute(`**${f.records}`);
  await page.unroute("**/module-receipts");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Connect to open your workspace",
      exact: true,
    }),
  ).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await signIn(page, f.scope.workspaceId);
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 30000,
    })
    .toBe("accepted");
  expect((await f.stored()).state.journal[0]?.id).toBe(original.id);
  const fresh = await (await page.request.get("/api/v1/me")).json();
  const result = await page.request.post(f.records, {
    headers: {
      origin: "http://localhost:4300",
      "x-csrf-token": fresh.csrfToken,
      "x-module-version": original.call.moduleVersion!,
    },
    data: { resource: "contacts", action: "list", input: {} },
  });
  expect(result.ok(), await result.text()).toBe(true);
  const records = await result.json();
  // The accepted request's receipt is recovered; no second update/version is created.
  expect(records.items[0].version).toBe(2);
  await second.close();
});

test("reauthentication cannot submit preserved work after its write permission was revoked", async ({
  page,
  context,
}) => {
  const f = await setupOfflinePolicy(page);
  await context.setOffline(true);
  const original = await f.capture();
  await signOut(page, true);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.write') where workspace_id=$1",
      [f.scope.workspaceId],
    );
    await context.setOffline(false);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Open workspace", exact: true }),
    ).toBeVisible();
    await signIn(page, f.scope.workspaceId);
    await expect
      .poll(async () => (await f.stored()).snapshot.bootstrap.permissions)
      .not.toContain("contacts.contacts.write");
    const fresh = await (await page.request.get("/api/v1/me")).json();
    const denied = await page.request.post(f.records, {
      headers: {
        origin: "http://localhost:4300",
        "x-csrf-token": fresh.csrfToken,
        "x-module-version": original.call.moduleVersion!,
        "idempotency-key": original.id,
      },
      data: {
        resource: original.call.resource,
        action: original.call.action,
        input: original.call.input,
      },
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe("FORBIDDEN");
    const saved = (await f.stored()).state.journal[0]!;
    expect(saved.state).toBe("pending");
    expect({ id: saved.id, call: saved.call }).toEqual({
      id: original.id,
      call: original.call,
    });
    const records = await pool.query(
      "select version,data from suite.module_records where workspace_id=$1 and module_id='contacts'",
      [f.scope.workspaceId],
    );
    expect(records.rows).toEqual([
      expect.objectContaining({
        version: 1,
        data: expect.objectContaining({ phone: "111" }),
      }),
    ]);
  } finally {
    await pool.end();
  }
});

test("a delayed logout acknowledgement cannot clear a newer sign-in from another tab", async ({
  page,
  context,
}) => {
  const f = await setupOfflinePolicy(page);
  const second = await context.newPage();
  await second.goto(page.url());
  await expect(
    second.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  let observed!: () => void, release!: () => void;
  const received = new Promise<void>((resolve) => {
    observed = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/auth/logout", async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    observed();
    await held;
    await route.fulfill({ response });
  });
  await signOut(page);
  await received;
  await expect(
    page.getByText("Signing out. Your saved work stays on this device.", {
      exact: true,
    }),
  ).toBeVisible();
  await selectValue(second, "Local demonstration account", "sales@demo.local");
  await second
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    second.getByRole("button", { name: "Signing in…", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      second.evaluate(async () =>
        (await navigator.locks.query()).pending?.some(
          (lock) => lock.name === "suite-auth-session",
        ),
      ),
    )
    .toBe(true);
  release();
  await expect(
    second.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await second.request.get("/api/v1/me")).json();
  expect(me.user.email).toBe("sales@demo.local");
  expect((await f.stored()).snapshot.bootstrap.workspace.id).toBe(
    f.scope.workspaceId,
  );
  await second.close();
});
