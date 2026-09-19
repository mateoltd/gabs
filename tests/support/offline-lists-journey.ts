import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { selectValue } from "../e2e/controls.helpers";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";

export async function offlineListsJourney(options: {
  page: Page;
  api: APIRequestContext;
  kind: "web" | "native";
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  resize(width: number, height: number): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const me = await (await options.api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await options.api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { id: workspaceId, name: "Offline list acceptance", currency: "EUR" },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const artifact = await (
    await options.api.get(
      `/api/v1/module/contacts/workspaces/${workspaceId}/artifact`,
    )
  ).json();
  const create = async (name: string) => {
    const response = await options.api.post(
      `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
      {
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
              name,
              kind: "person",
              relationship: "customer",
              phone: "111",
            },
          },
        },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
  };
  for (let i = 1; i <= 35; i++)
    await create(`Route ${String(i).padStart(2, "0")}`);
  const stored = () =>
    options.storage(page, { userId: me.user.id as string, workspaceId });
  const nav = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  const dialog = () =>
    page.getByRole("dialog", { name: "Offline lists", exact: true });
  const open = async () => {
    await page
      .getByRole("button", { name: "Offline lists", exact: true })
      .click();
    await expect(dialog()).toBeVisible();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await expect(dialog()).toHaveCount(0);
  };
  const save = async (title: string, pages: string) => {
    await dialog().getByLabel("Offline list name", { exact: true }).fill(title);
    await selectValue(page, "Record limit", pages);
    await dialog()
      .getByRole("button", { name: "Download list", exact: true })
      .click();
    await expect(dialog().getByRole("status")).toContainText(`${title}:`);
  };
  const edit = async (phone = "Pending offline edit") => {
    const row = page.getByRole("table").getByRole("row").nth(1);
    await row.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Phone", { exact: true }).fill(phone);
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await nav();
  await selectValue(page, "Records per page", "10");
  await page.getByPlaceholder("Search contacts", { exact: true }).fill("Route");
  await expect(
    page.getByRole("status").filter({ hasText: /^Page 1\./ }),
  ).toHaveText("Page 1. 10 records.");
  await open();
  await save("Delivery route", "5");
  await expect(dialog().getByRole("status")).toHaveText(
    "Delivery route: 35 records downloaded.",
  );
  await save("First ten", "1");
  await expect(dialog().getByRole("status")).toContainText(
    "First ten: 10 records downloaded. More records are available online.",
  );
  await dialog()
    .getByRole("button", { name: "Clear recently viewed pages", exact: true })
    .click();
  await expect(dialog().getByRole("status")).toContainText(
    "Recently viewed pages cleared.",
  );
  expect(Object.keys((await stored()).pages)).toHaveLength(4);
  await close();
  if (options.kind === "web")
    await page.evaluate(() =>
      navigator.serviceWorker.ready.then(() => undefined),
    );
  await options.offline(true);
  page = await options.restartOffline();
  await nav();
  await open();
  await dialog()
    .getByRole("button", { name: "Open Delivery route", exact: true })
    .click();
  await expect(dialog()).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: /^Page 1\./ }),
  ).toHaveText("Page 1. 10 records.");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Page 2\./ }),
  ).toHaveText("Page 2. 10 records.");
  await edit();
  const pending = (await stored()).journal;
  expect(pending).toHaveLength(1);
  await open();
  await dialog()
    .getByRole("button", { name: "Remove First ten", exact: true })
    .click();
  await expect(
    dialog().getByRole("button", { name: "Open First ten", exact: true }),
  ).toHaveCount(0);
  expect((await stored()).journal).toEqual(pending);
  expect(Object.keys((await stored()).pages)).toHaveLength(4);
  await close();
  await options.offline(false);
  await expect
    .poll(async () => (await stored()).journal[0]?.state)
    .toBe("accepted");
  await create("Route 36");
  await open();
  await dialog()
    .getByRole("button", { name: "Refresh Delivery route", exact: true })
    .click();
  await expect(dialog().getByRole("status")).toHaveText(
    "Delivery route: 36 records downloaded.",
  );
  expect(
    (
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await mkdir("docs/verification/offline-lists", { recursive: true });
  await page.screenshot({
    path: `docs/verification/offline-lists/${options.kind}-wide.png`,
  });
  await options.resize(390, 844);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/verification/offline-lists/${options.kind}-narrow.png`,
  });
  await dialog()
    .getByRole("button", { name: "Remove Delivery route", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/offline-lists/${options.kind}-narrow-actions.png`,
  });
  await options.resize(1440, 1000);
  await dialog()
    .getByRole("button", { name: "Open Delivery route", exact: true })
    .click();
  await options.offline(true);
  for (let i = 0; i < 3; i++)
    await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Page 4\./ }),
  ).toHaveText("Page 4. 6 records.");
  await edit();
  const retained = (await stored()).journal;
  await open();
  await dialog()
    .getByRole("button", { name: "Remove Delivery route", exact: true })
    .click();
  await expect(dialog()).toContainText("No lists selected for this resource.");
  expect((await stored()).journal).toEqual(retained);
  expect((await stored()).offlineLists).toEqual({});
  await close();
  await options.offline(false);
  await expect
    .poll(async () =>
      (await stored()).journal.every((entry) => entry.state === "accepted"),
    )
    .toBe(true);
  await open();
  await save("Settings route", "5");
  await close();
  await options.offline(true);
  await edit("Keep after clearing");
  const beforeClear = (await stored()).journal;
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Clear downloaded lists and pages",
      exact: true,
    })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Downloaded lists and recent pages cleared." }),
  ).toBeVisible();
  const cleared = await stored();
  expect(cleared.pages).toEqual({});
  expect(cleared.offlineLists).toEqual({});
  expect(cleared.journal).toEqual(beforeClear);
  await page.screenshot({
    path: `docs/verification/offline-lists/${options.kind}-settings.png`,
  });
}
