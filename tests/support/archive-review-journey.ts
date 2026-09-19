import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { ModuleCall } from "@suite/module-sdk";
import type { JournalEntry } from "@suite/module-sdk/sync";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "./executable-fixture";
import type { CommandCorrectionOptions } from "./command-correction-journey";

type Scope = { userId: string; workspaceId: string };
export async function changeArchiveBase(
  options: CommandCorrectionOptions,
  scope: Scope,
  headers: Record<string, string>,
  call: ModuleCall,
) {
  const result = await options.api.post(
    `/api/v1/module/${call.moduleId}/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        "x-module-version": call.moduleVersion!,
      },
      data: {
        action: "update",
        resource: "notes",
        input: {
          id: (call.input as { id: string }).id,
          baseVersion: 1,
          data: { name: "Changed server record" },
        },
      },
    },
  );
  expect(result.ok(), await result.text()).toBe(true);
}

export async function archiveReviewJourney({
  options,
  page,
  scope,
  headers,
  modules,
  before,
}: {
  options: CommandCorrectionOptions;
  page: Page;
  scope: Scope;
  headers: Record<string, string>;
  modules: { id: string; name: string }[];
  before: JournalEntry[];
}) {
  const alreadyArchived = options.mode === "archive-review-archived";
  const child = before[1],
    target = (child.call.input as { id: string }).id;
  const read = () => options.storage(page, scope);
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual(["rejected", "conflict", "pending", "accepted"]);
  const next = await publishExecutableFixture({
    ...modules[1],
    sourceDirectory: "tests/fixtures/queued-resources",
    transform: (file, source) =>
      file === "module.ts" ? source.replace('    view: "home",\n', "") : source,
  });
  const rollout = await options.api.post(
    `/api/v1/workspaces/${scope.workspaceId}/platform`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "rollout",
        version: 0,
        value: {
          moduleId: next.module_id,
          version: next.version,
          mandatory: false,
          acceptedVersions: [child.call.moduleVersion],
        },
      },
    },
  );
  expect(rollout.ok(), await rollout.text()).toBe(true);
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page
    .locator(".module-install-card")
    .filter({
      has: page.getByRole("heading", { name: modules[1].name, exact: true }),
    })
    .filter({
      has: page.getByText(`Version ${next.version}`, { exact: true }),
    });
  await expect(card).toContainText(`Version ${next.version}`);
  await card.getByRole("button", { name: "Update", exact: true }).click();
  await expect(card).toContainText(`Installed ${next.version}`);
  if (alreadyArchived) {
    const archived = await options.api.post(
      `/api/v1/module/${next.module_id}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": next.version,
        },
        data: {
          action: "archive",
          resource: "notes",
          input: { id: target, baseVersion: 2 },
        },
      },
    );
    expect(archived.ok(), await archived.text()).toBe(true);
  }
  const open = async () => {
    await page
      .getByRole("link", { name: modules[1].name, exact: true })
      .click();
    const row = page
      .getByRole("group", { name: /^Pending archive:/ })
      .filter({ hasText: target });
    await row.getByRole("button", { name: "Review", exact: true }).click();
    return page.getByRole("dialog", { name: "Review archive", exact: true });
  };
  let review = await open();
  await expect(review).toContainText("Captured server version: 1");
  await expect(review).toContainText(
    `Current server version: ${alreadyArchived ? 3 : 2}`,
  );
  await expect(
    review.getByText("Changed server record", { exact: true }),
  ).toBeVisible();
  expect((await read()).journal[1].call).toEqual(child.call);
  const evidence = "docs/verification/archive-review";
  await mkdir(evidence, { recursive: true });
  const screenshot = (name: string) =>
    page.screenshot({ path: `${evidence}/${options.kind}-${name}.png` });
  await screenshot(alreadyArchived ? "archived" : "review");
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await options.narrow();
  expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await screenshot(alreadyArchived ? "archived-narrow" : "review-narrow");
  await options.wide();
  if (alreadyArchived) {
    await expect(review).toContainText("This record is already archived");
    await expect(
      review.getByRole("button", {
        name: "Confirm reviewed archive",
        exact: true,
      }),
    ).toBeDisabled();
    await review
      .getByRole("button", { name: "Resolve original outcome", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    const state = await read();
    expect(state.journal).toHaveLength(4);
    expect(state.journal[1]).toMatchObject({
      call: child.call,
      state: "rejected",
      settlement: "cancelled",
    });
    expect(state.journal[1].supersededBy).toBeUndefined();
    expect(state.journal[2]).toEqual(before[2]);
    expect(
      (
        await options.pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
          [scope.workspaceId, `${next.module_id}.notes.archive`],
        )
      ).rows[0].n,
    ).toBe(1);
    return;
  }
  await options.offline(true);
  await expect(review).toContainText(
    "Reconnect with current read and write access",
  );
  await expect(
    review.getByText("Changed server record", { exact: true }),
  ).toHaveCount(0);
  page = await options.restartOffline();
  expect((await read()).journal[1].call).toEqual(child.call);
  await options.reconnect();
  review = await open();
  await expect(review).toContainText("Current server version: 2");
  const grant = async (value: boolean) => {
    await options.pool.query(
      value
        ? "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and not ($2=any(permissions))"
        : "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [scope.workspaceId, `${next.module_id}.notes.write`],
    );
    await options.pool.query(
      "update suite.workspace_policy set revision=revision+1 where workspace_id=$1",
      [scope.workspaceId],
    );
    await options.pool.query("select pg_notify('suite_policy',$1)", [
      scope.workspaceId,
    ]);
  };
  const held = await options.holdSettlement!();
  await review
    .getByRole("button", { name: "Confirm reviewed archive", exact: true })
    .click();
  await held.arrived();
  await grant(false);
  await expect(review).toContainText(
    "Reconnect with current read and write access",
  );
  await held.release();
  await page.evaluate(
    (scope) =>
      navigator.locks.request(
        `suite-sync:${scope.userId}:${scope.workspaceId}`,
        async () => {},
      ),
    scope,
  );
  expect((await read()).journal).toHaveLength(4);
  expect((await read()).journal[1]).toMatchObject({
    call: child.call,
    state: "conflict",
  });
  await options.narrow();
  await screenshot("revoked-narrow");
  await options.wide();
  await grant(true);
  await expect(review).toContainText("Current server version: 2");
  await options.loseSettlementReply();
  await review
    .getByRole("button", { name: "Confirm reviewed archive", exact: true })
    .click();
  await expect(review.getByRole("alert")).toBeVisible();
  expect((await read()).journal).toHaveLength(4);
  await options.offline(true);
  page = await options.restartOffline();
  expect((await read()).journal[1].call).toEqual(child.call);
  await options.reconnect();
  review = await open();
  await expect(review).toContainText("Current server version: 2");
  await review
    .getByRole("button", { name: "Confirm reviewed archive", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect
    .poll(async () => (await read()).journal[4]?.state)
    .toBe("accepted");
  const final = (await read()).journal;
  expect(final).toHaveLength(5);
  expect(final[1]).toMatchObject({
    call: child.call,
    settlement: "cancelled",
    supersededBy: final[4].id,
  });
  expect(final[2]).toEqual(before[2]);
  expect(final[4].call).toMatchObject({
    action: "archive",
    moduleVersion: next.version,
    input: { id: target, baseVersion: 2 },
  });
  for (const entry of [child, final[4]]) {
    const repeat = await options.api.post(
      `/api/v1/module/${next.module_id}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": entry.id,
          "x-module-version": entry.call.moduleVersion!,
        },
        data: { action: "archive", resource: "notes", input: entry.call.input },
      },
    );
    if (entry === child) {
      expect(repeat.status()).toBe(409);
      expect(await repeat.json()).toMatchObject({ code: "ATTEMPT_CANCELLED" });
    } else expect(repeat.ok(), await repeat.text()).toBe(true);
  }
  expect(
    (
      await options.pool.query(
        "select version, archived, data from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3",
        [scope.workspaceId, next.module_id, target],
      )
    ).rows,
  ).toEqual([
    { version: 3, archived: true, data: { name: "Changed server record" } },
  ]);
  expect(
    (
      await options.pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${next.module_id}.notes.archive`],
      )
    ).rows[0].n,
  ).toBe(1);
  await page
    .getByRole("button", { name: "Show archived", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "Changed server record", exact: true }),
  ).toBeVisible();
  await screenshot("accepted");
}
