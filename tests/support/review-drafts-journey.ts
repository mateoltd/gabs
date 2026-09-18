import { hostReviewRecovery } from "./host-review-recovery";
import { publishOnlineReviewFixture } from "./review-fixture";
import {
  expect,
  type Locator,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ResourceRecord } from "@suite/module-sdk";
import { resourceDraftKey } from "../../packages/client/src/modules/drafts";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function reviewDraftsJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  exportWork(button: Locator): Promise<unknown>;
  offline(value: boolean): Promise<void>;
  restart(offline?: boolean): Promise<Page>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: scope.workspaceId,
      name: "Independent review acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const onlineId = `online-review-${randomUUID().slice(0, 8)}`;
  await publishOnlineReviewFixture(pool, scope.workspaceId, onlineId);
  const version = (
    await (
      await api.get(
        `/api/v1/module/contacts/workspaces/${scope.workspaceId}/artifact`,
      )
    ).json()
  ).version as string;
  const command = async (action: string, input: Record<string, unknown>) => {
    const response = await api.post(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": version,
        },
        data: { resource: "contacts", action, input },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as ResourceRecord;
  };
  const records = await Promise.all(
    ["Alpha", "Beta"].map((name) =>
      command("create", {
        data: { name, kind: "person", relationship: "customer" },
      }),
    ),
  );
  const contacts = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
  const pending = (name: string) =>
    page.getByRole("group", {
      name: `Pending update: Local ${name}`,
      exact: true,
    });
  const editor = () =>
    page.getByRole("dialog", { name: "Edit record", exact: true });
  const close = async () => {
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  const state = () => options.storage(page, scope);
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await contacts();
  await expect(
    page.getByRole("cell", { name: "Alpha", exact: true }),
  ).toBeVisible();
  await options.offline(true);
  for (const record of records) {
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: record.data.name as string,
          exact: true,
        }),
      })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill(`Local ${record.data.name}`);
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await command("update", {
      id: record.id,
      baseVersion: record.version,
      data: {
        ...record.data,
        name: `Server ${record.data.name}`,
        email: `${String(record.data.name).toLowerCase()}@example.test`,
      },
    });
  }
  await options.offline(false);
  await expect
    .poll(async () => (await state()).journal.map((e) => e.state))
    .toEqual(["conflict", "conflict"]);
  const entries = (await state()).journal;
  const keys = entries.map((entry) =>
    resourceDraftKey("contacts", "contacts", { entryId: entry.id }),
  );
  await pending("Alpha")
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await selectValue(page, "Use value for name", "local");
  await page
    .getByLabel("Address", { exact: true })
    .fill("Alpha reviewed address");
  await close();
  // A separate ordinary draft must not replace either review.
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Unsubmitted ordinary draft");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "supplier");
  await close();
  await pending("Beta")
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await selectValue(page, "Use value for name", "remote");
  await page
    .getByLabel("Address", { exact: true })
    .fill("Beta reviewed address");
  await close();
  await expect
    .poll(async () => {
      const saved = await state();
      return keys.map((key) => ({
        address: saved.drafts[key]?.address,
        choices: saved.draftReviews?.[key]?.comparison?.choices,
      }));
    })
    .toEqual([
      { address: "Alpha reviewed address", choices: { name: "local" } },
      { address: "Beta reviewed address", choices: { name: "remote" } },
    ]);
  page = await hostReviewRecovery({
    ...options,
    page,
    scope,
    moduleId: "contacts",
    moduleName: "Contacts",
    scenario: "queued-reviews",
    restartOffline: () => options.restart(true),
    reconnect: () => options.restart(),
    inspect: async (dialog) => {
      await expect(
        dialog.getByRole("heading", {
          name: "Contacts: saved review",
          exact: true,
        }),
      ).toHaveCount(2);
      for (const value of [
        "Alpha reviewed address",
        "Beta reviewed address",
        "Unsubmitted ordinary draft",
        "local",
        "remote",
      ])
        await expect(dialog.getByText(value, { exact: true })).toBeVisible();
      for (const entry of entries) await expect(dialog).toContainText(entry.id);
    },
  });
  await contacts();
  await expect(
    pending("Alpha").getByRole("button", {
      name: "Resume review",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    pending("Beta").getByRole("button", { name: "Resume review", exact: true }),
  ).toBeVisible();
  await mkdir("docs/verification/review-drafts", { recursive: true });
  await page
    .getByRole("heading", { name: "Pending changes", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/review-drafts/${options.kind}-reviews.png`,
  });
  await options.narrow();
  await pending("Beta").scrollIntoViewIfNeeded();
  await expect(pending("Alpha")).toBeInViewport();
  await expect(pending("Beta")).toBeInViewport();
  let axe = new AxeBuilder({ page });
  if (options.kind === "native") axe = axe.setLegacyMode();
  expect(
    (
      await axe
        .include("#main-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/verification/review-drafts/${options.kind}-reviews-narrow.png`,
  });
  await options.wide();
  page = await options.restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  await contacts();
  await expect(
    pending("Alpha").getByRole("button", {
      name: "Resume review",
      exact: true,
    }),
  ).toBeVisible();
  await options.offline(true);
  await pending("Alpha")
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Local Alpha",
  );
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue(
    "Alpha reviewed address",
  );
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "alpha@example.test",
  );
  await page.getByLabel("Phone", { exact: true }).fill("111");
  await editor()
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const afterAlpha = await state();
  expect(afterAlpha.drafts[keys[0]]).toBeUndefined();
  expect(afterAlpha.drafts[keys[1]].address).toBe("Beta reviewed address");
  expect(afterAlpha.drafts["contacts/contacts"].name).toBe(
    "Unsubmitted ordinary draft",
  );
  await pending("Beta")
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Server Beta",
  );
  await expect(page.getByLabel("Address", { exact: true })).toHaveValue(
    "Beta reviewed address",
  );
  await expect(
    page.getByRole("combobox", { name: "Use value for name", exact: true }),
  ).toContainText("Server value");
  await editor()
    .getByRole("button", { name: "Save pending change", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await options.offline(false);
  await expect
    .poll(async () =>
      (await state()).journal
        .filter((e) => !e.supersededBy)
        .map((e) => e.state),
    )
    .toEqual(["accepted", "accepted"]);
  await page
    .getByRole("button", { name: "Resume saved draft", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsubmitted ordinary draft",
  );
  await close();
  const final = await state();
  expect(final.drafts[keys[0]]).toBeUndefined();
  expect(final.drafts[keys[1]]).toBeUndefined();
  const rows = (
    await pool.query(
      "select id,data from suite.module_records where workspace_id=$1 and module_id='contacts' order by data->>'name'",
      [scope.workspaceId],
    )
  ).rows;
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({
    id: records[0].id,
    data: {
      name: "Local Alpha",
      address: "Alpha reviewed address",
      phone: "111",
      email: "alpha@example.test",
    },
  });
  expect(rows[1]).toMatchObject({
    id: records[1].id,
    data: {
      name: "Server Beta",
      address: "Beta reviewed address",
      email: "beta@example.test",
    },
  });
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action='contacts.contacts.update'",
        [scope.workspaceId],
      )
    ).rows[0].n,
  ).toBe(4);
  // The same independence applies to explicitly online resource reviews, with caching enabled.
  const onlineCommand = async (
    action: string,
    input: Record<string, unknown>,
  ) => {
    const response = await api.post(
      `/api/v1/module/${onlineId}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": "1.0.0",
        },
        data: { resource: "records", action, input },
      },
    );
    expect(response.ok(), await response.text()).toBe(true);
    return (await response.json()) as ResourceRecord;
  };
  const onlineRecords = await Promise.all(
    ["Direct Alpha", "Direct Beta"].map((name) =>
      onlineCommand("create", { data: { name } }),
    ),
  );
  const onlineLink = () =>
    page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Online review records", exact: true })
      .click();
  await onlineLink();
  for (const [i, record] of onlineRecords.entries()) {
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: record.data.name as string,
          exact: true,
        }),
      })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill(`Local ${record.data.name}`);
    await onlineCommand("update", {
      id: record.id,
      baseVersion: record.version,
      data: {
        ...record.data,
        name: `Remote ${record.data.name}`,
        note: "Remote note",
      },
    });
    await editor().getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      editor().getByRole("region", {
        name: "Conflict comparison",
        exact: true,
      }),
    ).toBeVisible();
    await selectValue(page, "Use value for name", i ? "remote" : "local");
    await page
      .getByLabel("Note", { exact: true })
      .fill(`Reviewed ${record.data.name}`);
    await close();
  }
  await page.getByRole("button", { name: "New records", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Ordinary online draft");
  await close();
  const savedReviews = () =>
    page.getByRole("region", { name: "Saved reviews", exact: true });
  await expect(
    savedReviews().getByRole("button", { name: "Resume review", exact: true }),
  ).toHaveCount(2);
  await expect
    .poll(async () => (await state()).drafts[`${onlineId}/records`]?.name)
    .toBe("Ordinary online draft");
  page = await hostReviewRecovery({
    ...options,
    page,
    scope,
    moduleId: onlineId,
    moduleName: "Online review records",
    scenario: "direct-reviews",
    restartOffline: () => options.restart(true),
    reconnect: () => options.restart(),
    inspect: async (dialog) => {
      await expect(
        dialog.getByRole("heading", {
          name: "Records: saved review",
          exact: true,
        }),
      ).toHaveCount(2);
      for (const value of [
        "Reviewed Direct Alpha",
        "Reviewed Direct Beta",
        "Ordinary online draft",
        "local",
        "remote",
      ])
        await expect(dialog.getByText(value, { exact: true })).toBeVisible();
      await expect(
        dialog.getByRole("button", {
          name: "Resolve record outcome",
          exact: true,
        }),
      ).toHaveCount(0);
    },
  });
  await onlineLink();
  await savedReviews().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/review-drafts/${options.kind}-direct.png`,
  });
  await options.narrow();
  await savedReviews()
    .getByRole("button", { name: "Resume review", exact: true })
    .last()
    .scrollIntoViewIfNeeded();
  await expect(savedReviews()).toBeInViewport();
  let directAxe = new AxeBuilder({ page });
  if (options.kind === "native") directAxe = directAxe.setLegacyMode();
  expect(
    (
      await directAxe
        .include("#main-content")
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/review-drafts/${options.kind}-direct-narrow.png`,
  });
  await options.wide();
  page = await options.restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  await onlineLink();
  await options.offline(true);
  await savedReviews()
    .locator(".module-pending")
    .filter({ hasText: "Local Direct Alpha" })
    .getByRole("button", { name: "Resume review", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Local Direct Alpha",
  );
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue(
    "Reviewed Direct Alpha",
  );
  await expect(
    editor().getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(editor()).toContainText("Connect to submit it.");
  await page
    .getByLabel("Note", { exact: true })
    .fill("Direct Alpha after restart");
  await close();
  await options.offline(false);
  await savedReviews()
    .locator(".module-pending")
    .filter({ hasText: "Local Direct Alpha" })
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await editor().getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    savedReviews().getByRole("button", { name: "Resume review", exact: true }),
  ).toHaveCount(1);
  await savedReviews()
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Remote Direct Beta",
  );
  await expect(page.getByLabel("Note", { exact: true })).toHaveValue(
    "Reviewed Direct Beta",
  );
  await editor().getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(savedReviews()).toHaveCount(0);
  await page
    .getByRole("button", { name: "Resume saved draft", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Ordinary online draft",
  );
  await close();
  expect((await state()).journal).toHaveLength(4); // Only the two rejected queued edits and their replacements.
  const directRows = (
    await pool.query(
      "select data from suite.module_records where workspace_id=$1 and module_id=$2 order by data->>'name'",
      [scope.workspaceId, onlineId],
    )
  ).rows;
  expect(directRows).toEqual([
    {
      data: { name: "Local Direct Alpha", note: "Direct Alpha after restart" },
    },
    { data: { name: "Remote Direct Beta", note: "Reviewed Direct Beta" } },
  ]);
  expect(
    (
      await pool.query(
        "select count(*)::int as n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${onlineId}.records.update`],
      )
    ).rows[0].n,
  ).toBe(4);
}
