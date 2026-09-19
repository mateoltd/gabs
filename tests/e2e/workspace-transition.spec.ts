import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { setupOfflinePolicy } from "../support/offline-policy-fixture";
import { selectValue } from "./controls.helpers";

test.use({ actionTimeout: 10000 });

test("late remembered-workspace writes cannot replace the selected offline workspace or move its pending work", async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const first = await setupOfflinePolicy(page);
  const second = randomUUID();
  const created = await page.request.post("/api/v1/workspaces", {
    headers: { ...first.headers, "idempotency-key": randomUUID() },
    data: {
      id: second,
      name: "Workspace transition destination",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toContainText("Offline policy acceptance");
  await context.setOffline(true);
  const original = await first.capture();
  // Keep A's request unresolved while B opens. Real transport failure must not
  // move its original envelope into another workspace or grant it success.
  await page.route(
    `**/module/contacts/workspaces/${first.scope.workspaceId}/records`,
    async (route) => {
      if (route.request().postDataJSON()?.action === "update")
        await route.abort();
      else await route.continue();
    },
  );
  await page.evaluate((workspaceId) => {
    const state = { entered: false, finished: false, release: () => {} };
    const held = new Promise<void>((resolve) => {
      state.release = resolve;
    });
    const request = navigator.locks.request.bind(navigator.locks);
    navigator.locks.request = ((name: string, ...args: unknown[]) => {
      const invoke = () =>
        Reflect.apply(request, navigator.locks, [name, ...args]);
      if (
        name === "suite-remembered-identity" &&
        !state.entered &&
        localStorage.getItem("suite-workspace") === workspaceId
      ) {
        state.entered = true;
        return held.then(invoke).finally(() => {
          state.finished = true;
        });
      }
      return invoke();
    }) as typeof navigator.locks.request;
    (window as unknown as { workspaceWrite: typeof state }).workspaceWrite =
      state;
  }, first.scope.workspaceId);
  await context.setOffline(false);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { workspaceWrite: { entered: boolean } })
            .workspaceWrite.entered,
      ),
    )
    .toBe(true);
  await selectValue(page, "Workspace", second);
  await first.settings();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  const identity = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open("suite-offline-v1");
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      try {
        return await new Promise<{ userId: string; workspaceId: string }>(
          (resolve, reject) => {
            const read = db
              .transaction("records")
              .objectStore("records")
              .get("identity");
            read.onsuccess = () => resolve(read.result);
            read.onerror = () => reject(read.error);
          },
        );
      } finally {
        db.close();
      }
    });
  await expect.poll(async () => (await identity())?.workspaceId).toBe(second);
  await page.evaluate(() =>
    (
      window as unknown as { workspaceWrite: { release(): void } }
    ).workspaceWrite.release(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { workspaceWrite: { finished: boolean } })
            .workspaceWrite.finished,
      ),
    )
    .toBe(true);
  expect((await identity()).workspaceId).toBe(second);
  const retained = (await first.stored()).state.journal.find(
    (entry) => entry.id === original.id,
  )!;
  expect(retained.call).toEqual(original.call);
  expect(retained.state).not.toBe("accepted");
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Switch workspace", exact: true }),
  ).toContainText("Workspace transition destination");
  await expect(page.getByText("Policy contact", { exact: true })).toHaveCount(
    0,
  );
  await mkdir("docs/verification/workspace-transition", { recursive: true });
  await page.screenshot({
    path: "docs/verification/workspace-transition/offline-workspace.png",
    animations: "disabled",
  });
  expect(
    (await first.stored()).state.journal.find(
      (entry) => entry.id === original.id,
    )?.call,
  ).toEqual(original.call);
  await page.unroute(
    `**/module/contacts/workspaces/${first.scope.workspaceId}/records`,
  );
  await context.setOffline(false);
  await selectValue(page, "Workspace", first.scope.workspaceId);
  await expect
    .poll(
      async () =>
        (await first.stored()).state.journal.find(
          (entry) => entry.id === original.id,
        )?.state,
      { timeout: 30000 },
    )
    .toBe("accepted");
  await first.contacts();
  await page
    .getByRole("row")
    .filter({ hasText: "Policy contact" })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await expect(page.getByLabel("Phone", { exact: true })).toHaveValue(
    "Saved offline",
  );
  await page.keyboard.press("Escape");
  for (const workspaceId of [first.scope.workspaceId, second]) {
    const response = await page.request.post(
      `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
      {
        headers: {
          ...first.headers,
          "x-module-version": original.call.moduleVersion!,
        },
        data: { resource: "contacts", action: "list", input: {} },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    const records = await response.json();
    expect(records.items).toHaveLength(workspaceId === second ? 0 : 1);
    if (workspaceId !== second) {
      expect(records.items[0].version).toBe(2);
      expect(records.items[0].data.phone).toBe("Saved offline");
    }
  }
});
