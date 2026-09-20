import type { ArchiveReviewContext } from "./archive-lifecycle";
import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { assertSchema } from "@suite/module-sdk";
import { SavedWorkRecoverySchema } from "@suite/module-sdk/platform";
import { selectValue } from "../../e2e/controls.helpers";
import { exportArchive, importArchive } from "./archives";

/** Two independent stores exchange only the actual files produced by the source UI. */
export async function corporatePortability(options: {
  source: Page;
  api: APIRequestContext;
  directory: string;
  evidenceName?: string;
  archive?: boolean;
  archiveExportCheck?(context: ArchiveReviewContext): Promise<void>;
  archiveReviewCheck?(context: ArchiveReviewContext): Promise<Page>;
  offline(value: boolean): Promise<void>;
  exportFile(button: Locator, path: string): Promise<void>;
  replaceDevice(): Promise<Page>;
}) {
  let page = options.source;
  const me = await (await options.api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await options.api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { id: workspaceId, name: "Portable corporate work", currency: "EUR" },
  });
  expect(created.ok(), await created.text()).toBe(true);
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
  const enable = async () => {
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await settings();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
  };
  const fill = async (name: string) => {
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "customer");
  };
  await enable();
  await contacts();
  await expect(
    page.getByRole("button", { name: "New contacts", exact: true }),
  ).toBeEnabled();
  await options.offline(true);
  await fill("Portable queued contact");
  await page
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await fill("Portable independent draft");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await settings();
  await page
    .getByRole("button", { name: /Saved records and drafts \(2\)/ })
    .click();
  const recovery = page.getByRole("dialog", {
    name: "Records and drafts",
    exact: true,
  });
  const requestFile = resolve(options.directory, "original-request.json");
  const draftFile = resolve(options.directory, "original-draft.json");
  await options.exportFile(
    recovery.getByRole("button", { name: "Export saved request", exact: true }),
    requestFile,
  );
  await options.exportFile(
    recovery.getByRole("button", { name: "Export saved draft", exact: true }),
    draftFile,
  );
  const requestBytes = await readFile(requestFile);
  const draftBytes = await readFile(draftFile);
  const request: unknown = JSON.parse(requestBytes.toString());
  const draft: unknown = JSON.parse(draftBytes.toString());
  assertSchema(SavedWorkRecoverySchema, request);
  assertSchema(SavedWorkRecoverySchema, draft);
  expect(request).toMatchObject({
    userId: me.user.id,
    workspaceId,
    selection: "request",
    entry: {
      state: "pending",
      call: {
        action: "create",
        input: { data: { name: "Portable queued contact" } },
      },
    },
  });
  expect(draft).toMatchObject({
    userId: me.user.id,
    workspaceId,
    selection: "draft",
    data: { name: "Portable independent draft" },
  });
  if (request.selection !== "request")
    throw Error("The source did not export a request.");
  if (request.entry.call.action !== "create")
    throw Error("The source did not export the captured create request.");

  const archive = options.archive
    ? await exportArchive({
        page,
        directory: options.directory,
        evidenceName: options.evidenceName ?? "native-to-native",
        expected: [request, draft],
        exportFile: options.exportFile,
      })
    : undefined;
  if (archive && options.archiveExportCheck)
    await options.archiveExportCheck({
      page,
      scope: { userId: request.userId, workspaceId: request.workspaceId },
      file: archive,
      passphrase: archive.passphrase,
    });
  // The source stays offline and is closed; destination receives no cookies, cache or protected key.
  page = await options.replaceDevice();
  await enable();
  await expect(
    page.getByRole("button", { name: /Saved records and drafts/ }),
  ).toHaveCount(0);
  if (archive)
    page = await importArchive({
      page,
      file: archive,
      evidenceName: options.evidenceName ?? "native-to-native",
      scope: { userId: request.userId, workspaceId: request.workspaceId },
      reviewCheck: options.archiveReviewCheck,
    });
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const imported = page.getByRole("dialog", {
    name: "Imported saved work",
    exact: true,
  });
  for (const [index, path] of [requestFile, draftFile].entries()) {
    if (!archive) {
      await expect(
        imported.getByLabel("Saved-work recovery file", { exact: true }),
      ).toBeEnabled();
      await imported
        .getByLabel("Saved-work recovery file", { exact: true })
        .setInputFiles(path);
      await expect(
        imported.getByText(
          "Copy imported. Inspect its saved input before restoring it.",
          { exact: true },
        ),
      ).toBeVisible();
    }
    await imported
      .getByRole("button", { name: "Restore for review", exact: true })
      .first()
      .click();
    await imported
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(
      imported.getByRole("button", { name: "Restore for review", exact: true }),
    ).toHaveCount(archive ? 1 - index : 0);
    await expect(
      imported.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
  }
  await expect(
    imported.getByText("Restored. The imported copy is retained separately.", {
      exact: true,
    }),
  ).toHaveCount(2);
  await expect(
    imported.getByText(
      "Original request stopped by the server. Review saved input before submitting a correction.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(await readFile(requestFile)).toEqual(requestBytes);
  expect(await readFile(draftFile)).toEqual(draftBytes);
  const late = await options.api.post(
    `/api/v1/module/contacts/workspaces/${workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": request.entry.id,
        "x-module-version": request.entry.call.moduleVersion!,
      },
      data: {
        action: request.entry.call.action,
        resource: request.entry.call.resource,
        input: request.entry.call.input,
      },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  await imported
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await contacts();
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Portable independent draft",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "Portable independent draft", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "Portable queued contact", exact: true }),
  ).toHaveCount(0);
  return page;
}
