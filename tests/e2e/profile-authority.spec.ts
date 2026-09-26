import "dotenv/config";
import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";
import { selectValue } from "./controls.helpers";

test("a cookie change cannot apply another profile's authority or pending work", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  const roles = await (
    await page.request.get(`/api/v1/workspaces/${f.scope.workspaceId}/roles`)
  ).json();
  const ownerRole = roles.find(
    (role: { name: string }) => role.name === "Owner",
  );
  const invited = await page.request.post(
    `/api/v1/workspaces/${f.scope.workspaceId}/invitations`,
    {
      headers: { ...f.headers, "idempotency-key": randomUUID() },
      data: { email: "sales@demo.local", roleId: ownerRole.id },
    },
  );
  expect(invited.ok(), await invited.text()).toBe(true);
  const invitation = await invited.json();
  // Hold a real response authorized as A in another tab, then prevent that tab
  // from observing the new identity over HTTP. Only account invalidation can lock it.
  const second = await context.newPage();
  let release!: () => void, observed!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetched = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await second.route(
    `**/workspaces/${f.scope.workspaceId}/bootstrap`,
    async (route) => {
      const response = await route.fetch();
      expect(response.headers()["x-suite-actor"]).toBe(f.scope.userId);
      observed();
      await held;
      await route.fulfill({ response });
    },
    { times: 1 },
  );
  await second.goto(page.url());
  await fetched;
  await second.route("**/api/v1/**", (route) => route.abort());
  await context.setOffline(true);
  const original = await f.capture();
  const login = await page.request.post("/auth/development", {
    data: { email: "sales@demo.local" },
  });
  expect(login.ok()).toBe(true);
  const next = await (await page.request.get("/api/v1/me")).json();
  expect(next.user.id).not.toBe(f.scope.userId);
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": next.csrfToken as string,
  };
  const accepted = await page.request.post(
    `/api/v1/invitations/${invitation.id}/accept`,
    { headers, data: {} },
  );
  expect(accepted.ok(), await accepted.text()).toBe(true);
  const members = await (
    await page.request.get(`/api/v1/workspaces/${f.scope.workspaceId}/members`)
  ).json();
  const member = members.items.find(
    (member: { userId: string }) => member.userId === next.user.id,
  );
  const assigned = await page.request.patch(
    `/api/v1/workspaces/${f.scope.workspaceId}/members/${member.id}`,
    {
      headers: { ...headers, "idempotency-key": crypto.randomUUID() },
      data: {
        revision: member.revision,
        active: true,
        roleIds: [ownerRole.id],
        modules: ["contacts", "projects", "orders", "inventory"],
      },
    },
  );
  expect(assigned.ok(), await assigned.text()).toBe(true);
  // Reconnect may observe /me before attempting the old workspace request.
  // Assert server enforcement directly; both observation orders must stay safe.
  const denied = await page.request.get(
    `/api/v1/workspaces/${f.scope.workspaceId}/bootstrap`,
    {
      headers: { "x-suite-actor": f.scope.userId },
    },
  );
  expect(denied.status()).toBe(401);
  expect((await denied.json()).code).toBe("PROFILE_CHANGED");
  const rebound = page.waitForResponse(
    (response) =>
      response.ok() &&
      ["bootstrap", "policy"].some((endpoint) =>
        response
          .url()
          .includes(`/workspaces/${f.scope.workspaceId}/${endpoint}`),
      ) &&
      response.request().headers()["x-suite-actor"] === next.user.id,
  );
  await context.setOffline(false);
  expect((await rebound).headers()["x-suite-actor"]).toBe(next.user.id);
  release();
  await expect(
    second.getByRole("heading", {
      name: "Profile access is locked",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    second.getByRole("row").filter({ hasText: "Policy contact" }),
  ).toHaveCount(0);
  await second.close();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toBeVisible();
  // Wait for the new profile's actual bootstrap, then verify that its view has no old provisional edit.
  await expect
    .poll(async () =>
      page.evaluate(async ({ userId }) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const r = indexedDB.open("suite-offline-v1");
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => reject(r.error);
        });
        try {
          return await new Promise<unknown>((resolve) => {
            const r = db
              .transaction("records")
              .objectStore("records")
              .get(`${userId}/account-revision`);
            r.onsuccess = () => resolve(r.result);
          });
        } finally {
          db.close();
        }
      }, f.scope),
    )
    .toBeTruthy();
  await f.contacts();
  await page
    .getByRole("row")
    .filter({ hasText: "Policy contact" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue("111");
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  expect((await f.stored()).state.journal).toEqual([original]);
  // Reauthentication as the original account must recover the same saved request.
  const again = await page.request.post("/auth/development", {
    data: { email: "owner@demo.local" },
  });
  expect(again.ok()).toBe(true);
  await page.reload();
  await selectValue(page, "Workspace", f.scope.workspaceId);
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 30000,
    })
    .toBe("accepted");
  expect((await f.stored()).state.journal[0]?.id).toBe(original.id);
});

test("expired credentials lock offline entry without deleting the original pending request", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const f = await setupOfflinePolicy(page);
  await context.setOffline(true);
  const original = await f.capture();
  const expired = await page.request.post("/auth/logout", {
    headers: f.headers,
  });
  expect(expired.ok(), await expired.text()).toBe(true);
  await context.setOffline(false);
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([original]);
  await context.setOffline(true);
  await expect(
    page.getByRole("heading", {
      name: "Profile access is locked",
      exact: true,
    }),
  ).toBeVisible();
  await mkdir("docs/verification/profile-authority", { recursive: true });
  await page.screenshot({
    path: "docs/verification/profile-authority/locked-wide.png",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/verification/profile-authority/locked-narrow.png",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Connect to open your workspace",
      exact: true,
    }),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([original]);
  await context.setOffline(false);
  await page.reload();
  await selectValue(page, "Local demonstration account", "owner@demo.local");
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
  await selectValue(page, "Workspace", f.scope.workspaceId);
  await expect
    .poll(async () => (await f.stored()).state.journal[0]?.state, {
      timeout: 30000,
    })
    .toBe("accepted");
  expect((await f.stored()).state.journal[0]?.id).toBe(original.id);
});

test("a first authentication denial after restart expires remembered offline access", async ({
  page,
  context,
}) => {
  const f = await setupOfflinePolicy(page);
  await context.setOffline(true);
  const original = await f.capture();
  const expired = await page.request.post("/auth/logout", {
    headers: f.headers,
  });
  expect(expired.ok()).toBe(true);
  // Close the renderer before reconnect so the client has no current actor.
  await page.goto("about:blank");
  await context.setOffline(false);
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open workspace", exact: true }),
  ).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Connect to open your workspace",
      exact: true,
    }),
  ).toBeVisible();
  expect((await f.stored()).state.journal).toEqual([original]);
});
