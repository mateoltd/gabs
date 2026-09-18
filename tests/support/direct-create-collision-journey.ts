import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import { selectValue } from "../e2e/controls.helpers";
import type { CapturedWrite } from "./direct-recovery-journey";
export type { CapturedWrite } from "./direct-recovery-journey";

export async function directCreateCollisionJourney(options: {
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
  loseSettlementReply(): Promise<void>;
  offline(value: boolean): Promise<void>;
  writes(): Promise<CapturedWrite[]>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
}) {
  const { page, api, pool } = options;
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
      name: "Direct create collision acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  const endpoint = `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`;
  const existing = new Map<string, unknown>();
  const occupy = async (call: CapturedWrite, name: string) => {
    const response = await api.post(endpoint, {
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        "x-module-version": call.version,
      },
      data: {
        ...call.body,
        input: {
          ...call.body.input,
          data: { name, kind: "organization", relationship: "supplier" },
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
    existing.set(String(call.body.input.id), (await response.json()).data);
  };
  const fence = async (call: CapturedWrite) => {
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
  const editor = () =>
    page.getByRole("dialog", { name: "New record", exact: true });
  const confirmation = () =>
    page.getByRole("dialog", { name: "Create a separate record", exact: true });
  const begin = async (name: string) => {
    await page
      .getByRole("button", { name: "New contacts", exact: true })
      .click();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await selectValue(page, "Kind", "person");
    await selectValue(page, "Relationship", "customer");
  };
  const save = () =>
    editor().getByRole("button", { name: "Save", exact: true }).click();
  const separate = async () => {
    await editor()
      .getByRole("button", { name: "Create separate record", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(confirmation()).toContainText(
      "Success requires server acceptance",
    );
  };
  const confirm = () =>
    confirmation()
      .getByRole("button", {
        name: "Check and create separate record",
        exact: true,
      })
      .click();
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enable on this device", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();

  // A real first-attempt collision retains the failed original call for explicit recovery.
  await begin("Definitive local input");
  const inject = await options.beforeNext("create", async () =>
    occupy((await options.writes()).at(-1)!, "Existing first collision"),
  );
  await save();
  await inject();
  const original = (await options.writes()).at(-1)!;
  await expect(
    editor().getByRole("region", { name: "Failed create recovery" }),
  ).toContainText("already exists");
  await expect(
    editor().getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("This record already exists.", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Name", { exact: true })
    .fill("Recovered direct contact");
  await mkdir("docs/verification/direct-create-collisions", {
    recursive: true,
  });
  await expect(editor()).toHaveCSS("opacity", "1");
  await page.screenshot({
    path: `docs/verification/direct-create-collisions/${options.kind}-failed-editor.png`,
  });
  await options.narrow();
  let editorAxe = new AxeBuilder({ page });
  if (options.kind === "native") editorAxe = editorAxe.setLegacyMode();
  expect(
    (
      await editorAxe
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/direct-create-collisions/${options.kind}-failed-editor-narrow.png`,
  });
  await options.wide();
  await options.offline(true);
  await expect(
    page.getByRole("heading", {
      name: "Online authorization required",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await options.writes()).toHaveLength(1);
  await options.offline(false);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered direct contact",
  );
  await separate();
  await expect(confirmation()).toHaveCSS("opacity", "1");
  await mkdir("docs/verification/direct-create-collisions", {
    recursive: true,
  });
  await page.screenshot({
    path: `docs/verification/direct-create-collisions/${options.kind}-confirmation.png`,
  });
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `docs/verification/direct-create-collisions/${options.kind}-confirmation-narrow.png`,
  });
  await options.wide();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered direct contact",
  );
  await editor()
    .getByRole("button", { name: "Create separate record", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await options.loseSettlementReply();
  await confirm();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "select outcome from suite.idempotency where workspace_id=$1 and key=$2",
            [scope.workspaceId, original.key],
          )
        ).rows[0]?.outcome,
    )
    .toBe("cancelled");
  await expect(
    confirmation().getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    }),
  ).toBeEnabled();
  expect(await options.writes()).toHaveLength(1);
  // A lost replacement receipt is a new uncertainty, never another safe-to-replace failure.
  const replacementLoss = await options.loseNext("create", true);
  await confirm();
  const replacement = await replacementLoss();
  await expect(
    editor().getByRole("region", { name: "Unconfirmed change" }),
  ).toBeVisible();
  await expect(editor().getByLabel("Name", { exact: true })).toBeDisabled();
  await expect(
    editor().getByRole("button", {
      name: "Create separate record",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(replacement.key).not.toBe(original.key);
  expect(replacement.body.input.id).not.toBe(original.body.input.id);
  await save();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await options.writes()).at(-1)).toEqual(replacement);
  await fence(original);

  // A create cancelled after an uncertain send can also collide with a record created meanwhile.
  await begin("Uncertain local input");
  const loss = await options.loseNext("create", false);
  await save();
  const cancelled = await loss();
  await occupy(cancelled, "Existing after uncertain send");
  await editor()
    .getByRole("button", { name: "Resolve outcome", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Resolve pending change", exact: true })
    .getByRole("button", { name: "Check and resolve", exact: true })
    .click();
  await expect(
    editor().getByRole("region", { name: "Failed create recovery" }),
  ).toContainText("server stopped");
  await page
    .getByLabel("Name", { exact: true })
    .fill("Recovered cancelled contact");
  await separate();
  await confirm();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const second = (await options.writes()).at(-1)!;
  expect(second.body.input.id).not.toBe(cancelled.body.input.id);
  await fence(cancelled);

  // A second collision on the proposed replacement is definitive on its first attempt.
  await begin("Repeated collision input");
  const firstCollision = await options.beforeNext("create", async () =>
    occupy((await options.writes()).at(-1)!, "Existing repeated original"),
  );
  await save();
  await firstCollision();
  const repeatedOriginal = (await options.writes()).at(-1)!;
  await separate();
  const nextCollision = await options.beforeNext("create", async () =>
    occupy((await options.writes()).at(-1)!, "Existing repeated replacement"),
  );
  await confirm();
  await nextCollision();
  const collidedReplacement = (await options.writes()).at(-1)!;
  await expect(
    editor().getByRole("region", { name: "Failed create recovery" }),
  ).toContainText("already exists");
  await expect(
    editor().getByRole("region", { name: "Unconfirmed change" }),
  ).toHaveCount(0);
  await page
    .getByLabel("Name", { exact: true })
    .fill("Recovered repeated contact");
  await separate();
  await confirm();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const third = (await options.writes()).at(-1)!;
  expect(third.body.input.id).not.toBe(collidedReplacement.body.input.id);
  await fence(repeatedOriginal);
  await fence(collidedReplacement);
  const rows = (
    await pool.query(
      "select id,data,version from suite.module_records where workspace_id=$1 and module_id='contacts' and resource='contacts'",
      [scope.workspaceId],
    )
  ).rows;
  expect(rows).toHaveLength(7);
  for (const [id, data] of existing)
    expect(rows.find((r) => r.id === id)).toMatchObject({ data, version: 1 });
  for (const [call, name] of [
    [replacement, "Recovered direct contact"],
    [second, "Recovered cancelled contact"],
    [third, "Recovered repeated contact"],
  ] as const)
    expect(rows.find((r) => r.id === call.body.input.id).data.name).toBe(name);
  expect(
    (
      await pool.query(
        "select action,count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.create','module.attempt.cancel') group by action order by action",
        [scope.workspaceId],
      )
    ).rows,
  ).toEqual([
    { action: "contacts.contacts.create", n: 7 },
    { action: "module.attempt.cancel", n: 4 },
  ]);
  const cached = (await page.evaluate(async (scope) => {
    if (window.suiteDesktop)
      return window.suiteDesktop.cacheRead(scope, "module-state");
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("suite-offline-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const r = db
          .transaction("records")
          .objectStore("records")
          .get(`${scope.userId}/${scope.workspaceId}/module-state`);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, scope)) as { journal?: unknown[]; drafts?: object } | undefined;
  expect(cached?.journal ?? []).toEqual([]);
  expect(cached?.drafts ?? {}).toEqual({});
  await expect(
    page.getByRole("cell", { name: "Recovered repeated contact", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `docs/verification/direct-create-collisions/${options.kind}-recovered.png`,
  });
  await options.narrow();
  await page.screenshot({
    path: `docs/verification/direct-create-collisions/${options.kind}-recovered-narrow.png`,
  });
}
