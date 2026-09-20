import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { selectValue } from "../e2e/controls.helpers";
import type { SavedWorkRecovery } from "@suite/module-sdk/platform";

export async function corporateImportJourney(
  page: Page,
  api: APIRequestContext,
  surface: string,
  restart: () => Promise<Page>,
) {
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Saved-work recovery",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const pkg = await (
    await api.get(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
    )
  ).json();
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page
    .getByRole("navigation", { name: "Preferences", exact: true })
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  const open = async () => {
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    return page.getByRole("dialog", {
      name: "Imported saved work",
      exact: true,
    });
  };
  let dialog = await open();
  const input: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...scope,
    moduleId: "contacts",
    moduleVersion: pkg.version,
    selection: "draft",
    resource: "contacts",
    key: "contacts/contacts",
    data: {
      name: "Recovered company draft",
      kind: "person",
      relationship: "customer",
    },
    target: null,
    draftVersion: pkg.version,
  };
  const upload = async (input: SavedWorkRecovery) => {
    await expect(
      dialog.getByLabel("Saved-work recovery file", { exact: true }),
    ).toBeEnabled();
    await dialog
      .getByLabel("Saved-work recovery file", { exact: true })
      .setInputFiles({
        name: "company-work.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(input)),
      });
  };
  await upload(input);
  await expect(
    dialog.getByText(
      "Copy imported. Inspect its saved input before restoring it.",
      { exact: true },
    ),
  ).toBeVisible();
  await upload(input);
  await expect(
    dialog.getByText(
      "This copy is already saved. Existing work was preserved.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog.getByText("Inspect saved input", { exact: true }).click();
  await expect(
    dialog.getByText("Recovered company draft", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "This creates a separate saved draft for review. Existing drafts stay in place.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm restoration", exact: true })
    .click();
  await expect(
    dialog.getByText("Restored. The imported copy is retained separately.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Refresh imported copies",
      exact: true,
    }),
  ).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Import saved work", exact: true }),
  ).toBeFocused();
  page = await restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  dialog = await open();
  await expect(
    dialog.getByText("Restored. The imported copy is retained separately.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Remove imported copy", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Confirm removal", exact: true })
    .click();
  await expect(
    dialog.getByText("Imported copy removed. Other saved work was preserved.", {
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered company draft",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Recovered company draft", exact: true }),
  ).toBeVisible();
  dialog = await open();
  const id = randomUUID();
  const request: SavedWorkRecovery = {
    kind: "module-work-recovery",
    formatVersion: 1,
    ...scope,
    moduleId: "contacts",
    moduleVersion: pkg.version,
    selection: "request",
    entry: {
      id,
      ...scope,
      call: {
        moduleId: "contacts",
        moduleVersion: pkg.version,
        key: id,
        action: "create",
        resource: "contacts",
        input: {
          id: randomUUID(),
          data: {
            name: "Uncommitted recovered contact",
            kind: "person",
            relationship: "supplier",
          },
        },
      },
      dependencies: [],
      state: "pending",
      createdAt: Date.now(),
      attempts: 1,
      delivery: "uncertain",
    },
  };
  await upload(request);
  await expect(
    dialog.getByText(
      "Copy imported. Inspect its saved input before restoring it.",
      { exact: true },
    ),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  await expect(
    dialog.getByText(/permanently stop the original request/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Confirm restoration", exact: true })
    .click();
  await expect(
    dialog.getByText("Restored. The imported copy is retained separately.", {
      exact: true,
    }),
  ).toBeVisible();
  const late = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": id,
        "x-module-version": pkg.version,
      },
      data: {
        action: "create",
        resource: "contacts",
        input: request.entry.call.input,
      },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  await dialog.getByText("Inspect saved input", { exact: true }).click();
  await dialog.getByText("3 fields", { exact: true }).click();
  const dir = resolve("docs/verification/corporate-work-import");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: resolve(dir, `${surface}-restored.png`) });
  const a11y = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(a11y.violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(dir, `${surface}-narrow.png`) });
  await dialog
    .getByRole("button", { name: "Remove imported copy", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(dir, `${surface}-narrow-actions.png`),
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Disable offline storage", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /before disabling offline storage/ }),
  ).toBeVisible();
  return page;
}
