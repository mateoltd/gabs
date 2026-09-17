import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { selectValue } from "./controls.helpers";
import type { StoredModuleState } from "../../packages/client/src/modules/artifacts";
async function setup(page: Page, offline = true) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/");
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const result = await page.request.post("/api/v1/workspaces", {
    headers: {
      origin: new URL(page.url()).origin,
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: { id: workspaceId, name: "Response recovery", currency: "EUR" },
  });
  expect(result.ok(), await result.text()).toBe(true);
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  if (offline) {
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
  }
  await page.getByRole("link", { name: "Contacts", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New contacts", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  return { workspaceId, userId: me.user.id as string };
}
async function stored(
  page: Page,
  scope: { userId: string; workspaceId: string },
  corruptCache = false,
) {
  return page.evaluate(
    async ({ scope, corruptCache }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open("suite-offline-v1");
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      try {
        return await new Promise<StoredModuleState>((resolve, reject) => {
          const tx = db.transaction(
              "records",
              corruptCache ? "readwrite" : "readonly",
            ),
            store = tx.objectStore("records"),
            key = `${scope.userId}/${scope.workspaceId}/module-state`;
          const get = store.get(key);
          let state: StoredModuleState;
          get.onsuccess = () => {
            state = get.result;
            if (corruptCache) {
              for (const k of Object.keys(state.pages))
                if (k.includes("contacts")) state.pages[k] = null as never;
              store.put(state, key);
            }
          };
          tx.oncomplete = () => resolve(state);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
    { scope, corruptCache },
  );
}
async function fill(page: Page, name: string) {
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(name);
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "other");
}
const routeFor = (workspaceId: string) =>
  `**/api/v1/module/contacts/workspaces/${workspaceId}/records`;
test("generated screens reject malformed reads and mutation receipts, preserve retry identity, and validate offline pages", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const scope = await setup(page, false),
    pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  let corruptCreate = true,
    corruptArchive = true,
    corruptList = false;
  const keys = { create: [] as string[], archive: [] as string[] };
  const receipts: Record<string, { id: string }> = {};
  try {
    await page.route(routeFor(scope.workspaceId), async (route) => {
      const body = route.request().postDataJSON();
      const action = body.action as string;
      if (action === "create" || action === "archive")
        keys[action].push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const value = await response.json();
      if (action === "create" || action === "archive") receipts[action] = value;
      if (
        (action === "create" && corruptCreate) ||
        (action === "archive" && corruptArchive)
      )
        return route.fulfill({
          response,
          json: { ...value, data: { ...value.data, name: 123 } },
        });
      if (action === "list" && corruptList)
        return route.fulfill({
          response,
          json: {
            items: [{ id: "invalid", data: { name: 123 } }],
            nextCursor: null,
          },
        });
      return route.fulfill({ response });
    });
    await fill(page, "Exact receipt contact");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toContainText("server response is uncertain");
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
      "Exact receipt contact",
    );
    await expect(page.getByLabel("Name", { exact: true })).toBeDisabled();
    await expect(dialog).toContainText("data that could not be verified");
    corruptCreate = false;
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "Exact receipt contact", exact: true }),
    ).toBeVisible();
    expect(keys.create.length).toBe(2);
    expect(new Set(keys.create).size).toBe(1);
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
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(
      page.getByRole("cell", { name: "Exact receipt contact", exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect
      .poll(async () =>
        Object.values((await stored(page, scope)).pages).some((p) =>
          p.items.some((r) => r.data.name === "Exact receipt contact"),
        ),
      )
      .toBe(true);
    const cacheBefore = (await stored(page, scope)).pages;
    corruptList = true;
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "New projects", exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Contacts", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Records unavailable", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "No records", exact: true }),
    ).toHaveCount(0);
    expect((await stored(page, scope)).pages).toMatchObject(cacheBefore);
    await expect(
      page.getByText("Record count unavailable.", { exact: true }),
    ).toBeVisible();
    await mkdir("docs/verification/generated-response", { recursive: true });
    await page.screenshot({
      path: "docs/verification/generated-response/invalid-read.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "docs/verification/generated-response/invalid-read-narrow.png",
    });
    await context.setOffline(true);
    await expect(
      page.getByRole("cell", { name: "Exact receipt contact", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Records unavailable", exact: true }),
    ).toHaveCount(0);
    await stored(page, scope, true);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Records unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "This offline copy could not be verified. Reconnect to refresh it.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByRole("table")).toHaveCount(0);
    corruptList = false;
    await context.setOffline(false);
    await expect(
      page.getByRole("cell", { name: "Exact receipt contact", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("row")
      .filter({ hasText: "Exact receipt contact" })
      .getByRole("button", { name: "Archive", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry archive", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(
      "data that could not be verified",
    );
    await expect(
      page.getByRole("button", { name: "Retry archive", exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: "docs/verification/generated-response/uncertain-archive-narrow.png",
    });
    corruptArchive = false;
    await page
      .getByRole("button", { name: "Retry archive", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Retry archive", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("cell", { name: "Exact receipt contact", exact: true }),
    ).toHaveCount(0);
    expect(keys.archive.length).toBe(2);
    expect(new Set(keys.archive).size).toBe(1);
    const count = await pool.query(
      "select count(*) from suite.module_records where workspace_id=$1 and module_id='contacts' and data->>'name'=$2",
      [scope.workspaceId, "Exact receipt contact"],
    );
    expect(Number(count.rows[0].count)).toBe(1);
    for (const action of ["create", "archive"]) {
      const audit = await pool.query(
        "select count(*) from suite.audit where workspace_id=$1 and action=$2 and target_id=$3",
        [scope.workspaceId, `contacts.contacts.${action}`, receipts[action].id],
      );
      expect(Number(audit.rows[0].count)).toBe(1);
    }
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});
test("queued malformed receipts remain pending across reload and recover with the original signed contract and request key", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  const scope = await setup(page),
    pool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const sent: { key: string; version: string }[] = [];
  let corrupt = true;
  try {
    await page.reload();
    await expect(
      page.getByRole("button", { name: "New contacts", exact: true }),
    ).toBeVisible();
    await context.setOffline(true);
    await fill(page, "Queued receipt contact");
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Pending changes", exact: true }),
    ).toBeVisible();
    const initial = await stored(page, scope),
      entry = initial.journal[0];
    expect(
      initial.responseContractRefs?.[`contacts@${entry.call.moduleVersion}`],
    ).toBeTruthy();
    await page.route(routeFor(scope.workspaceId), async (route) => {
      if (route.request().postDataJSON().action !== "create")
        return route.continue();
      sent.push({
        key: route.request().headers()["idempotency-key"],
        version: route.request().headers()["x-module-version"],
      });
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      if (!corrupt) return route.fulfill({ response });
      return route.fulfill({
        response,
        json: { ...(await response.json()), version: 0 },
      });
    });
    await context.setOffline(false);
    await expect(page.locator(".module-pending")).toContainText(
      "data that could not be verified",
    );
    let pending = (await stored(page, scope)).journal[0];
    expect(pending.state).toBe("pending");
    expect(pending.result).toBeUndefined();
    expect(pending.id).toBe(entry.id);
    await page.reload();
    await expect(page.locator(".module-pending")).toContainText(
      "data that could not be verified",
    );
    pending = (await stored(page, scope)).journal[0];
    expect(pending.state).toBe("pending");
    expect(pending.call).toEqual(entry.call);
    await mkdir("docs/verification/generated-response", { recursive: true });
    await page.screenshot({
      path: "docs/verification/generated-response/pending-receipt.png",
    });
    corrupt = false;
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Pending changes", exact: true }),
    ).toHaveCount(0);
    await expect
      .poll(async () => (await stored(page, scope)).journal[0].state)
      .toBe("accepted");
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(
      sent.every(
        (s) => s.key === entry.id && s.version === entry.call.moduleVersion,
      ),
    ).toBe(true);
    const accepted = (await stored(page, scope)).journal[0];
    expect((await stored(page, scope)).responseContractRefs).toEqual({});
    const result = await pool.query(
      "select count(*) from suite.audit where workspace_id=$1 and action='contacts.contacts.create' and target_id=$2",
      [scope.workspaceId, (accepted.result as { id: string }).id],
    );
    expect(Number(result.rows[0].count)).toBe(1);
  } finally {
    await context.setOffline(false);
    await pool.end();
  }
});
