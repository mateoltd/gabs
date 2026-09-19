import "dotenv/config";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { selectValue } from "./controls.helpers";
import type { Snapshot } from "../../packages/client/src";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

async function setup(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  const me = await (await page.request.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken as string,
  };
  const created = await page.request.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Offline policy acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const records = `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`;
  const artifact = await (
    await page.request.get(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
    )
  ).json();
  const record = await page.request.post(records, {
    headers: {
      ...headers,
      "idempotency-key": randomUUID(),
      "x-module-version": artifact.version,
    },
    data: {
      resource: "contacts",
      action: "create",
      input: {
        data: {
          name: "Policy contact",
          kind: "person",
          relationship: "customer",
          phone: "111",
        },
      },
    },
  });
  expect(record.ok(), await record.text()).toBe(true);
  const stored = () =>
    page.evaluate(async ({ userId, workspaceId }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("suite-offline-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const read = <T>(key: string) =>
          new Promise<T>((resolve, reject) => {
            const request = db
              .transaction("records")
              .objectStore("records")
              .get(`${userId}/${workspaceId}/${key}`);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        return {
          snapshot: await read<Snapshot>("snapshot"),
          state: await read<ModuleStorage>("module-state"),
        };
      } finally {
        db.close();
      }
    }, scope);
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const contacts = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect
    .poll(async () => (await stored()).snapshot?.bootstrap.offlineHours)
    .toBe(24);
  await contacts();
  await expect(
    page
      .getByRole("table")
      .getByRole("row")
      .filter({ hasText: "Policy contact" }),
  ).toBeVisible();
  await expect
    .poll(async () => Object.keys((await stored()).state?.pages ?? {}).length)
    .toBeGreaterThan(0);
  await page.evaluate(() =>
    navigator.serviceWorker.ready.then(() => undefined),
  );
  const capture = async () => {
    await contacts();
    await page
      .getByRole("row")
      .filter({ hasText: "Policy contact" })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.getByLabel("Phone", { exact: true }).fill("Saved offline");
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    return (await stored()).state.journal[0]!;
  };
  return { scope, headers, records, stored, settings, contacts, capture };
}

test("disabling offline policy locks cached access and preserves online recovery of conflicting work", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setup(page);
  await context.setOffline(true);
  const original = await f.capture();
  const competing = await page.request.post(f.records, {
    headers: {
      ...f.headers,
      "idempotency-key": randomUUID(),
      "x-module-version": original.call.moduleVersion!,
    },
    data: {
      resource: "contacts",
      action: "update",
      input: {
        ...(original.call.input as object),
        data: {
          ...(original.call.input as { data: Record<string, unknown> }).data,
          phone: "Server edit",
        },
      },
    },
  });
  expect(competing.ok(), await competing.text()).toBe(true);
  const policy = await page.request.patch(
    `/api/v1/workspaces/${f.scope.workspaceId}`,
    {
      headers: { ...f.headers, "idempotency-key": randomUUID() },
      data: {
        name: "Offline policy acceptance",
        offlineHours: "0",
        accent: "forest",
        logoDataUrl: "",
      },
    },
  );
  expect(policy.ok(), await policy.text()).toBe(true);
  await f.settings();
  await context.setOffline(false);
  await expect(
    page.getByText(
      "The workspace administrator has disabled offline storage.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeEnabled();
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 30000,
    })
    .toBe("conflict");
  const recovered = (await f.stored()).state.journal[0]!;
  expect({
    id: recovered.id,
    call: recovered.call,
    dependencies: recovered.dependencies,
  }).toEqual({
    id: original.id,
    call: original.call,
    dependencies: original.dependencies,
  });
  await page.getByRole("button", { name: /^Saved records and drafts/ }).click();
  const dialog = page.getByRole("dialog", {
    name: "Records and drafts",
    exact: true,
  });
  await expect(dialog.getByText("Conflict", { exact: true })).toBeVisible();
  await dialog.getByText("View saved change", { exact: true }).click();
  await expect(
    dialog.getByText("Saved offline", { exact: true }),
  ).toBeVisible();
  await mkdir("docs/verification/offline-policy", { recursive: true });
  expect(
    (
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: "docs/verification/offline-policy/recovery-wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/verification/offline-policy/recovery-narrow.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Disable offline storage", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Resolve pending changes and saved drafts before disabling offline storage.",
  );
  expect((await f.stored()).state.journal).toEqual([recovered]);
  await expect
    .poll(async () => (await f.stored()).snapshot.bootstrap.offlineHours)
    .toBe(0);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByText(
      "Connect to revalidate this workspace. Unsent drafts remain stored.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([recovered]);
  await context.setOffline(false);
  await page.reload();
  await f.settings();
  await expect(
    page.getByRole("button", { name: /^Saved records and drafts/ }),
  ).toBeVisible();
});

test("an administrator can shorten the offline window without losing pending work at expiry", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setup(page);
  await f.settings();
  await selectValue(page, "Company offline access", "1");
  await page
    .getByRole("button", { name: "Save workspace policy", exact: true })
    .click();
  await expect
    .poll(async () => (await f.stored()).snapshot.bootstrap.offlineHours)
    .toBe(1);
  await mkdir("docs/verification/offline-policy", { recursive: true });
  await page
    .getByRole("combobox", { name: "Company offline access", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: "docs/verification/offline-policy/settings-wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("combobox", { name: "Company offline access", exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/verification/offline-policy/settings-narrow.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const snapshot = (await f.stored()).snapshot;
  expect(snapshot.expiresAt).toBe(
    Date.parse(snapshot.bootstrap.authorizedAt) + 3600000,
  );
  await context.setOffline(true);
  const original = await f.capture();
  await page.clock.install();
  await page.clock.setSystemTime(snapshot.expiresAt + 1000);
  await expect(
    page.getByText(
      "Connect to revalidate this workspace. Unsent drafts remain stored.",
      { exact: true },
    ),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([original]);
  await page.clock.setSystemTime(Date.now());
  await context.setOffline(false);
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 30000,
    })
    .toBe("accepted");
});

test("received membership revocation reaches a disconnected tab and preserves work through restart and regrant", async ({
  page,
  context,
  playwright,
}) => {
  test.setTimeout(120000);
  const f = await setup(page);
  const roles = await (
    await page.request.get(`/api/v1/workspaces/${f.scope.workspaceId}/roles`)
  ).json();
  const root = roles.find((role: { name: string }) => role.name === "Owner");
  const invited = await page.request.post(
    `/api/v1/workspaces/${f.scope.workspaceId}/invitations`,
    {
      headers: { ...f.headers, "idempotency-key": randomUUID() },
      data: { email: "sales@demo.local", roleId: root.id },
    },
  );
  expect(invited.ok(), await invited.text()).toBe(true);
  const invitation = await invited.json();
  const admin = await playwright.request.newContext({
    baseURL: "http://localhost:4300",
  });
  const second = await context.newPage();
  try {
    const login = await admin.post("/auth/development", {
      data: { email: "sales@demo.local" },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const me = await (await admin.get("/api/v1/me")).json();
    const headers = {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken as string,
    };
    const accepted = await admin.post(
      `/api/v1/invitations/${invitation.id}/accept`,
      { headers, data: {} },
    );
    expect(accepted.ok(), await accepted.text()).toBe(true);
    const members = await (
      await admin.get(`/api/v1/workspaces/${f.scope.workspaceId}/members`)
    ).json();
    const owner = members.find(
      (member: { userId: string }) => member.userId === f.scope.userId,
    );
    const changeMembership = async (active: boolean) => {
      const response = await admin.patch(
        `/api/v1/workspaces/${f.scope.workspaceId}/members/${owner.id}`,
        {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: {
            active,
            roleIds: owner.roles.map((role: { id: string }) => role.id),
            modules: owner.modules,
          },
        },
      );
      expect(response.ok(), await response.text()).toBe(true);
    };
    await second.goto(page.url());
    await expect(
      second.getByRole("row").filter({ hasText: "Policy contact" }),
    ).toBeVisible();
    // The second tab cannot learn about denial through HTTP; it must receive the scoped broadcast.
    await second.route("**/api/v1/**", (route) => route.abort());
    await context.setOffline(true);
    const original = await f.capture();
    await changeMembership(false);
    await context.setOffline(false);
    await expect
      .poll(async () => (await f.stored()).snapshot?.expiresAt, {
        timeout: 30000,
      })
      .toBe(0);
    await expect(
      second.getByRole("row").filter({ hasText: "Policy contact" }),
    ).toHaveCount(0);
    expect((await f.stored()).state.journal).toEqual([original]);
    await expect(
      second.getByRole("heading", {
        name: "Workspace access is locked",
        exact: true,
      }),
    ).toBeVisible();
    await mkdir("docs/verification/policy-revocation", { recursive: true });
    await second.screenshot({
      path: "docs/verification/policy-revocation/locked-wide.png",
    });
    await second.setViewportSize({ width: 390, height: 844 });
    expect(
      await second.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await second.screenshot({
      path: "docs/verification/policy-revocation/locked-narrow.png",
    });
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByText(
        "Connect to revalidate this workspace. Unsent drafts remain stored.",
        { exact: true },
      ),
    ).toBeVisible();
    expect((await f.stored()).state.journal).toEqual([original]);
    await changeMembership(true);
    await context.setOffline(false);
    await page.reload();
    await selectValue(page, "Workspace", f.scope.workspaceId);
    await f.settings();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => (await f.stored()).state.journal[0]?.state, {
        timeout: 30000,
      })
      .toBe("accepted");
    const recovered = (await f.stored()).state.journal[0]!;
    expect({
      id: recovered.id,
      call: recovered.call,
      dependencies: recovered.dependencies,
    }).toEqual({
      id: original.id,
      call: original.call,
      dependencies: original.dependencies,
    });
    await expect
      .poll(async () => (await f.stored()).snapshot?.expiresAt)
      .toBeGreaterThan(Date.now());
  } finally {
    await second.close();
    await admin.dispose();
  }
});
