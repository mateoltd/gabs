import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ResourceRecord } from "@suite/module-sdk";
import { selectValue } from "../e2e/controls.helpers";

export type CapturedWrite = {
  key: string;
  version: string;
  body: { resource: string; action: string; input: Record<string, unknown> };
};
export async function directRecoveryJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  loseNext(
    action: "create" | "update" | "archive",
    commit: boolean,
  ): Promise<() => Promise<CapturedWrite>>;
  beforeNext(
    action: string,
    run: () => Promise<unknown>,
  ): Promise<() => Promise<void>>;
  writes(): Promise<CapturedWrite[]>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
}) {
  const { page, api, pool } = options;
  const me = await (await api.get("/api/v1/me")).json();
  const workspaceId = randomUUID();
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const created = await api.post("/api/v1/workspaces", {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: {
      id: workspaceId,
      name: "Direct recovery acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const endpoint = `/api/v1/module/contacts/workspaces/${workspaceId}/records`;
  const version = (
    await (
      await api.get(
        `/api/v1/module/contacts/workspaces/${workspaceId}/artifact`,
      )
    ).json()
  ).version as string;
  const command = async (action: string, input: Record<string, unknown>) => {
    const result = await api.post(endpoint, {
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        "x-module-version": version,
      },
      data: { resource: "contacts", action, input },
    });
    expect(result.ok(), await result.text()).toBe(true);
    return (await result.json()) as ResourceRecord;
  };
  const current = (id: unknown) => command("get", { id });
  const roles = (
    await pool.query(
      "select id from suite.roles where workspace_id=$1 and 'contacts.contacts.write'=any(permissions)",
      [workspaceId],
    )
  ).rows.map((r) => r.id);
  const revoke = () =>
    pool.query(
      "update suite.roles set permissions=array_remove(permissions,'contacts.contacts.write') where workspace_id=$1",
      [workspaceId],
    );
  const restore = () =>
    pool.query(
      "update suite.roles set permissions=array_append(permissions,'contacts.contacts.write') where workspace_id=$1 and id=any($2::uuid[])",
      [workspaceId, roles],
    );
  const row = (name: string) =>
    page
      .getByRole("row")
      .filter({ has: page.getByRole("cell", { name, exact: true }) });
  const editor = () =>
    page.getByRole("dialog", { name: /^(New|Edit) record$/ });
  const save = () =>
    editor().getByRole("button", { name: "Save", exact: true }).click();
  const uncertain = async (canRetry = true) => {
    await expect(
      editor().getByRole("region", { name: "Unconfirmed change", exact: true }),
    ).toBeVisible();
    await expect(editor().getByLabel("Name", { exact: true })).toBeDisabled();
    if (canRetry)
      await expect(
        editor().getByRole("button", { name: "Save", exact: true }),
      ).toBeEnabled();
  };
  const resolve = async (archive = false) => {
    const button = page.getByRole("button", {
      name: archive ? "Resolve archive outcome" : "Resolve outcome",
      exact: true,
    });
    await expect(button).toBeEnabled({ timeout: 45000 });
    await button.click();
    const dialog = page.getByRole("dialog", {
      name: "Resolve pending change",
      exact: true,
    });
    await expect(dialog).toHaveCSS("opacity", "1");
    await dialog
      .getByRole("button", { name: "Check and resolve", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  const fenced = async (call: CapturedWrite) => {
    const late = await api.post(endpoint, {
      headers: {
        ...headers,
        "idempotency-key": call.key,
        "x-module-version": call.version,
      },
      data: call.body,
    });
    expect(late.status()).toBe(409);
    expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  };
  const capture = async (name: string) => {
    await mkdir("docs/verification/direct-recovery", { recursive: true });
    await page.screenshot({
      path: `docs/verification/direct-recovery/${options.kind}-${name}.png`,
    });
  };
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable on this device", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();

  // A committed create must retain its identity through a later permission denial.
  let lost = await options.loseNext("create", true);
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Direct contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await save();
  const create = await lost();
  await uncertain();
  let denied = await options.beforeNext("create", revoke);
  await save();
  await denied();
  await expect(editor()).toContainText("Your role does not allow this action.");
  await uncertain(false);
  expect((await options.writes()).slice(-2).map((c) => c.key)).toEqual([
    create.key,
    create.key,
  ]);
  await editor()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(editor()).toBeVisible();
  await restore();
  await expect(
    page.getByRole("button", { name: "Resolve outcome", exact: true }),
  ).toBeEnabled({ timeout: 45000 });
  await page
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  const confirmation = page.getByRole("dialog", {
    name: "Resolve pending change",
    exact: true,
  });
  await expect(confirmation).toHaveCSS("opacity", "1");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor()).toBeVisible();
  await expect(editor().getByLabel("Name", { exact: true })).toHaveValue(
    "Direct contact",
  );
  await editor()
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  await expect(confirmation).toHaveCSS("opacity", "1");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await capture("confirmation");
  await options.narrow();
  let axe = new AxeBuilder({ page });
  if (options.kind === "native") axe = axe.setLegacyMode();
  expect(
    (
      await axe
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await capture("confirmation-narrow");
  await confirmation
    .getByRole("button", { name: "Close dialog", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    confirmation.getByRole("button", {
      name: "Check and resolve",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await options.wide();
  await expect(row("Direct contact")).toBeVisible();

  // An uncommitted update followed by a conflict is still uncertain until fenced.
  lost = await options.loseNext("update", false);
  await row("Direct contact")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Reviewed contact");
  await save();
  const update = await lost();
  await uncertain();
  const original = await current(update.body.input.id);
  await command("update", {
    id: original.id,
    baseVersion: original.version,
    data: {
      ...original.data,
      name: "Remote contact",
      email: "remote@example.test",
    },
  });
  await save();
  await expect(editor()).toContainText(/conflict/i);
  await uncertain();
  expect((await options.writes()).slice(-2).map((c) => c.key)).toEqual([
    update.key,
    update.key,
  ]);
  await resolve();
  await expect(
    editor().getByRole("region", { name: "Conflict comparison", exact: true }),
  ).toBeVisible();
  await expect(
    editor().getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await fenced(update);
  await options.narrow();
  await capture("comparison-narrow");
  await selectValue(page, "Use value for name", "local");
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "remote@example.test",
  );
  await save();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await options.writes()).at(-1)!.key).not.toBe(update.key);
  await options.wide();
  await expect(row("Reviewed contact")).toBeVisible();

  // A first-attempt conflict is definitive and can open comparison immediately.
  await row("Reviewed contact")
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await page.getByLabel("Name", { exact: true }).fill("Fresh review");
  const before = await current(original.id);
  await command("update", {
    id: before.id,
    baseVersion: before.version,
    data: { ...before.data, name: "Fresh remote" },
  });
  await save();
  await expect(
    editor().getByRole("region", { name: "Conflict comparison", exact: true }),
  ).toBeVisible();
  await expect(
    editor().getByRole("region", { name: "Unconfirmed change", exact: true }),
  ).toHaveCount(0);
  await selectValue(page, "Use value for name", "local");
  await save();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // A committed archive also keeps its key through denial and authoritative recovery.
  lost = await options.loseNext("archive", true);
  await row("Fresh review")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  const archive = await lost();
  await expect(
    page.getByRole("button", { name: "Retry archive", exact: true }),
  ).toBeEnabled();
  denied = await options.beforeNext("archive", revoke);
  await page
    .getByRole("button", { name: "Retry archive", exact: true })
    .click();
  await denied();
  await expect(
    page.getByText("Your role does not allow this action.", { exact: true }),
  ).toBeVisible();
  expect((await options.writes()).slice(-2).map((c) => c.key)).toEqual([
    archive.key,
    archive.key,
  ]);
  await restore();
  await resolve(true);
  await expect(
    page.getByText("Archive confirmed.", { exact: true }),
  ).toBeVisible();
  expect((await current(original.id)).archived).toBe(true);

  // A cancelled archive preserves the live record, and a new attempt uses its new version.
  const second = await command("create", {
    data: { name: "Second contact", kind: "person", relationship: "other" },
  });
  await page.reload();
  await expect(row("Second contact")).toBeVisible();
  lost = await options.loseNext("archive", false);
  await row("Second contact")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  const cancelled = await lost();
  await expect(
    page.getByRole("button", { name: "Retry archive", exact: true }),
  ).toBeEnabled();
  await command("update", {
    id: second.id,
    baseVersion: second.version,
    data: { ...second.data, name: "Updated second" },
  });
  await page
    .getByRole("button", { name: "Retry archive", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Resolve archive outcome", exact: true }),
  ).toBeEnabled();
  expect((await options.writes()).slice(-2).map((c) => c.key)).toEqual([
    cancelled.key,
    cancelled.key,
  ]);
  await resolve(true);
  await expect(
    page.getByText(
      "The original archive request was stopped. Review the current record before archiving again.",
      { exact: true },
    ),
  ).toBeVisible();
  await fenced(cancelled);
  expect((await current(second.id)).archived).toBe(false);
  await expect(row("Updated second")).toBeVisible();
  await row("Updated second")
    .getByRole("button", { name: "Archive", exact: true })
    .click();
  await expect(row("Updated second")).toHaveCount(0);
  expect((await options.writes()).at(-1)!.key).not.toBe(cancelled.key);
  const counts = (
    await pool.query(
      "select action,count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.create','contacts.contacts.update','contacts.contacts.archive','module.attempt.cancel') group by action order by action",
      [workspaceId],
    )
  ).rows;
  expect(counts).toEqual([
    { action: "contacts.contacts.archive", n: 2 },
    { action: "contacts.contacts.create", n: 2 },
    { action: "contacts.contacts.update", n: 5 },
    { action: "module.attempt.cancel", n: 2 },
  ]);
}
