import {
  archiveReviewJourney,
  changeArchiveBase,
} from "./archive-review-journey";
import { submittedDescendantJourney } from "./submitted-descendants";
import {
  captureResourceDependents,
  verifyResourceDependents,
} from "./resource-descendants";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";
import module from "../fixtures/queued-notes/module";
import type { CommandCorrectionOptions } from "./command-correction-journey";

export async function commandContinuationJourney(
  options: CommandCorrectionOptions,
) {
  let page = options.page;
  const { api, pool } = options;
  const archiveReviewMode = options.mode.startsWith("archive-review");
  const submitted = options.mode.startsWith("submitted-");
  const selectedAction = submitted ? options.mode.split("-")[1] : undefined;
  const resourceAction =
    selectedAction === "create" || options.mode === "command-resource"
      ? "create"
      : selectedAction === "update" || options.mode === "command-update"
        ? "update"
        : selectedAction === "archive" ||
            options.mode === "command-archive" ||
            archiveReviewMode
          ? "archive"
          : undefined;
  const resourceChild = resourceAction !== undefined;
  const childChoice = resourceAction
    ? `Continue ${resourceAction[0].toUpperCase()}${resourceAction.slice(1)} Notes`
    : "Continue Save note";
  const evidence = submitted
    ? `submitted-descendants/${selectedAction}-${options.mode.split("-")[2]}`
    : resourceAction === "update" || resourceAction === "archive"
      ? `resource-${resourceAction}-continuation`
      : resourceChild
        ? "resource-continuation"
        : "command-continuation";
  const modules = ["parent", "child"].map((name) => ({
    id: `continue-${name}-${randomUUID().slice(0, 8)}`,
    name: `Continuation ${name} notes`,
  }));
  for (const entry of modules)
    await publishExecutableFixture({
      ...entry,
      sourceDirectory:
        resourceChild && entry === modules[1]
          ? "tests/fixtures/queued-resources"
          : "tests/fixtures/queued-notes",
      transform: (file, source) =>
        file !== "view.tsx" || (resourceChild && entry === modules[1])
          ? source
          : source.replace(
              '<Field label="Note name">',
              '<Field label="Prerequisite identity"><Input value={parent ?? ""} onChange={(event) => setParent(event.target.value)} /></Field><Field label="Note name">',
            ),
    });
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
      name: "Command continuation acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  for (const { id } of modules) {
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [scope.workspaceId, id],
    );
    await pool.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) values($1,$2,'enabled','{}')",
      [scope.workspaceId, id],
    );
    await pool.query(
      "insert into suite.module_assignments(workspace_id,module_id,membership_id) select workspace_id,$2,id from suite.memberships where workspace_id=$1",
      [scope.workspaceId, id],
    );
    await pool.query(
      "update suite.roles set permissions=array(select distinct unnest(permissions || $2::text[])) where workspace_id=$1 and protected",
      [
        scope.workspaceId,
        module.permissions.map((permission) =>
          permission.replaceAll(module.id, id),
        ),
      ],
    );
  }
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  const stored = () => options.storage(page, scope);
  const open = async (index: number) => {
    await page
      .getByRole("link", { name: modules[index].name, exact: true })
      .click();
    await expect(
      page.getByRole("region", {
        name: `${modules[index].name} workspace`,
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(
        async () => !!(await stored()).installed[modules[index].id]?.version,
      )
      .toBe(true);
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeVisible();
  };
  for (const index of [0, 1]) await open(index);
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
  await open(0);
  const capture = async (name: string, dependent = false) => {
    await page.getByLabel("Note name", { exact: true }).fill(name);
    await page
      .getByRole("button", {
        name: dependent ? "Save dependent note" : "Save pending note",
        exact: true,
      })
      .click();
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  };
  await capture("Reject this note");
  const original = (await stored()).journal[0];
  await open(1);
  await page
    .getByLabel("Prerequisite identity", { exact: true })
    .fill(original.id);
  const existingTargets =
    resourceAction === "update" || resourceAction === "archive"
      ? await captureResourceDependents({
          options,
          page,
          scope,
          headers,
          moduleId: modules[1].id,
          action: resourceAction,
          parent: original.id,
          open: () => open(1),
        })
      : undefined;
  if (!existingTargets) {
    await capture("Selected foreign command", true);
    await capture("Unselected foreign command", true);
  }
  const before = (await stored()).journal;
  expect(before.slice(1).map((entry) => entry.dependencies)).toEqual([
    [original.id],
    [original.id],
  ]);
  await options.reconnect();
  await expect
    .poll(async () => (await stored()).journal.map((entry) => entry.state))
    .toEqual(["rejected", "pending", "pending"]);
  const inbox = async () => {
    await open(0);
    await page.getByRole("button", { name: /^Saved commands/ }).click();
    return page.getByRole("dialog", { name: "Saved commands", exact: true });
  };
  let dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Review command", exact: true })
    .click();
  let review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(
    review.getByRole("checkbox", { name: childChoice, exact: true }),
  ).toHaveCount(2);
  await options.offline(true);
  await review.getByLabel("Name", { exact: true }).fill("Corrected parent");
  await review
    .getByRole("checkbox", { name: childChoice, exact: true })
    .first()
    .check();
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review.getByRole("status")).toHaveText(
    "Review saved on this device.",
  );
  const saved = (await stored()).commandReviews?.[original.id];
  expect(saved?.continuations?.map((choice) => choice.id)).toEqual([
    before[1].id,
  ]);
  page = await options.restartOffline();
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(
    review.getByRole("checkbox", { name: childChoice, exact: true }).first(),
  ).toBeChecked();
  await expect(
    review.getByRole("checkbox", { name: childChoice, exact: true }).last(),
  ).not.toBeChecked();
  await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
    "Corrected parent",
  );
  const dependentInput = review
    .getByRole("group", { name: "Dependent changes", exact: true })
    .locator("details.resource-value > summary");
  for (const summary of await dependentInput.all()) await summary.click();
  await expect(
    review.getByText(
      resourceAction === "archive"
        ? existingTargets![0]
        : "Selected foreign command",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    review.getByText(
      resourceAction === "archive"
        ? existingTargets![1]
        : "Unselected foreign command",
      { exact: true },
    ),
  ).toBeVisible();
  await mkdir(`docs/verification/${evidence}`, { recursive: true });
  const screenshot = (name: string) =>
    submitted || archiveReviewMode
      ? Promise.resolve()
      : page.screenshot({
          path: `docs/verification/${evidence}/${options.kind}-${name}.png`,
        });
  await screenshot("review");
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await options.narrow();
  expect(
    await review.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await screenshot("review-narrow");
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    review.getByRole("button", {
      name: "Prepare corrected command",
      exact: true,
    }),
  ).toBeVisible();
  await screenshot("review-actions-narrow");
  await options.wide();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await options.reconnect();
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(
    review.getByRole("checkbox", { name: childChoice, exact: true }).first(),
  ).toBeChecked();
  const held = await options.holdSettlement!();
  await review
    .getByRole("button", { name: "Prepare corrected command", exact: true })
    .click();
  const confirm = page.getByRole("dialog", {
    name: "Submit corrected command",
    exact: true,
  });
  await confirm
    .getByRole("button", {
      name: "Resolve original and save correction",
      exact: true,
    })
    .click();
  await held.arrived();
  const permission = async (granted: boolean) => {
    await pool.query(
      granted
        ? "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and not ($2=any(permissions))"
        : "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [
        scope.workspaceId,
        `${modules[1].id}.${resourceChild ? "notes.write" : "capture"}`,
      ],
    );
    await pool.query(
      "update suite.workspace_policy set revision=revision+1 where workspace_id=$1",
      [scope.workspaceId],
    );
    await pool.query("select pg_notify('suite_policy',$1)", [
      scope.workspaceId,
    ]);
  };
  await permission(false);
  await expect(confirm).toContainText("0 dependent changes selected");
  await expect(confirm.getByRole("status")).toContainText(
    "A selected change became unavailable.",
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
  await expect(confirm.getByRole("alert")).toBeVisible();
  const denied = await stored();
  expect(denied.journal).toHaveLength(3);
  expect(denied.journal[0]).toMatchObject({
    call: original.call,
    settlement: "cancelled",
  });
  expect(denied.journal.slice(1)).toEqual(before.slice(1));
  expect(denied.commandReviews?.[original.id]).toEqual(saved);
  await page.keyboard.press("Escape");
  await expect(review.getByRole("checkbox")).toHaveCount(0);
  await expect(
    review.getByText("Selected foreign command", { exact: true }),
  ).toHaveCount(0);
  await expect(review).toContainText("Their saved selection is retained");
  await expect(
    review.getByRole("button", {
      name: "Prepare corrected command",
      exact: true,
    }),
  ).toBeDisabled();
  await options.narrow();
  await screenshot("revoked-narrow");
  await options.wide();
  await permission(true);
  if (archiveReviewMode)
    await changeArchiveBase(options, scope, headers, before[1].call);
  if (submitted)
    await options.interruptCall!(
      before[1].id,
      options.mode.endsWith("accepted") ? "accepted" : "cancelled",
    );
  await expect(
    review.getByRole("checkbox", { name: childChoice, exact: true }).first(),
  ).toBeChecked();
  await review
    .getByRole("button", { name: "Prepare corrected command", exact: true })
    .click();
  await confirm
    .getByRole("button", {
      name: "Resolve original and save correction",
      exact: true,
    })
    .click();
  if (submitted || archiveReviewMode) {
    await expect(review).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await page
      .getByRole("dialog", { name: "Saved commands", exact: true })
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (archiveReviewMode)
      return archiveReviewJourney({
        options,
        page,
        scope,
        headers,
        modules,
        before,
      });
    return submittedDescendantJourney({
      options,
      page,
      scope,
      headers,
      modules,
      before,
      targets: existingTargets,
    });
  }
  await expect
    .poll(async () => (await stored()).journal.map((entry) => entry.state))
    .toEqual(["rejected", "accepted", "pending", "accepted"]);
  const final = (await stored()).journal;
  expect(final[0].call).toEqual(before[0].call);
  expect(final[0].supersededBy).toBe(final[3].id);
  expect(final[1].call).toEqual(before[1].call);
  expect(final[1].dependencies).toEqual([final[3].id]);
  expect(final[2]).toEqual(before[2]);
  expect(final[3].call.input).toEqual({ name: "Corrected parent" });
  for (const entry of [final[1], final[3]]) {
    const repeat = await api.post(
      `/api/v1/module/${entry.call.moduleId}/workspaces/${scope.workspaceId}/${entry.call.action === "operation" ? "operations/capture" : "records"}`,
      {
        headers: {
          ...headers,
          "idempotency-key": entry.id,
          "x-module-version": entry.call.moduleVersion!,
        },
        data:
          entry.call.action === "operation"
            ? entry.call.input
            : {
                action: entry.call.action,
                resource: entry.call.resource,
                input: entry.call.input,
              },
      },
    );
    expect(repeat.ok(), await repeat.text()).toBe(true);
  }
  if (existingTargets) {
    await verifyResourceDependents({
      options,
      scope,
      parentModuleId: modules[0].id,
      moduleId: modules[1].id,
      action: resourceAction as "update" | "archive",
      targets: existingTargets,
    });
  } else {
    expect(
      (
        await pool.query(
          "select module_id, data->>'name' as name from suite.module_records where workspace_id=$1 order by name",
          [scope.workspaceId],
        )
      ).rows,
    ).toEqual([
      { module_id: modules[0].id, name: "Corrected parent" },
      { module_id: modules[1].id, name: "Selected foreign command" },
    ]);
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=any($2::text[])",
          [scope.workspaceId, modules.map((m) => `${m.id}.notes.create`)],
        )
      ).rows[0].n,
    ).toBe(2);
  }
  await expect(review).toHaveCount(0);
  if (resourceAction) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Saved commands", exact: true }),
    ).toHaveCount(0);
    await open(1);
    await page
      .getByLabel("Prerequisite identity", { exact: true })
      .fill(original.id);
    await page
      .getByLabel("Saved write identity", { exact: true })
      .fill(final[1].id);
    await page
      .getByRole("button", {
        name: `Retry saved ${resourceAction}`,
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      `Retried accepted: ${final[1].id}`,
    );
    expect((await stored()).journal).toEqual(final);
    if (existingTargets) {
      await verifyResourceDependents({
        options,
        scope,
        parentModuleId: modules[0].id,
        moduleId: modules[1].id,
        action: resourceAction as "update" | "archive",
        targets: existingTargets,
      });
      return;
    }
  }
  if (resourceChild) {
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Saved commands", exact: true }),
    ).toHaveCount(0);
    const child = modules[1];
    const target = (final[1].call.input as { id: string }).id;
    const records = () =>
      pool.query(
        "select id, version, archived, data from suite.module_records where workspace_id=$1 and module_id=$2 and id=$3",
        [scope.workspaceId, child.id, target],
      );
    for (const action of ["update", "archive"] as const) {
      await open(1);
      await page
        .getByLabel("Prerequisite identity", { exact: true })
        .fill(final[3].id);
      await page
        .getByLabel("Accepted record identity", { exact: true })
        .fill(target);
      await page
        .getByRole("button", { name: "Load accepted record", exact: true })
        .click();
      await expect(
        page.getByText(
          `Loaded server version ${action === "update" ? 1 : 2}:`,
          { exact: false },
        ),
      ).toBeVisible();
      await options.offline(true);
      if (action === "update")
        await page
          .getByLabel("Note name", { exact: true })
          .fill("Updated foreign record");
      await page
        .getByRole("button", { name: `Save pending ${action}`, exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await stored()).journal.find(
              (entry) =>
                entry.call.moduleId === child.id &&
                entry.call.action === action,
            )?.state,
        )
        .toBe("pending");
      const captured = (await stored()).journal.find(
        (entry) =>
          entry.call.moduleId === child.id && entry.call.action === action,
      )!;
      expect(captured.call.input).toMatchObject({
        id: target,
        baseVersion: action === "update" ? 1 : 2,
      });
      if (action === "update")
        expect(captured.call.input).toMatchObject({
          baseData: { name: "Selected foreign command" },
          data: { name: "Updated foreign record" },
        });
      expect(captured.dependencies).toContain(final[3].id);
      expect((await records()).rows[0]).toMatchObject({
        version: action === "update" ? 1 : 2,
        archived: false,
      });
      page = await options.restartOffline();
      expect(
        (await stored()).journal.find((entry) => entry.id === captured.id),
      ).toEqual(captured);
      if (action === "update") {
        await page.getByRole("link", { name: "Settings", exact: true }).click();
        await page
          .getByRole("button", { name: /^Saved records and drafts/ })
          .click();
        const recovery = page.getByRole("dialog", {
          name: "Records and drafts",
          exact: true,
        });
        const update = recovery.locator("li").filter({
          has: page.getByRole("heading", {
            name: "Notes: update",
            exact: true,
          }),
        });
        await update.getByText("View saved change", { exact: true }).click();
        await expect(update).toContainText("Selected foreign command");
        await expect(update).toContainText("Updated foreign record");
        await screenshot("update-recovery");
        await options.narrow();
        await screenshot("update-recovery-narrow");
        await options.wide();
        await page.keyboard.press("Escape");
      }
      await options.reconnect();
      await expect
        .poll(
          async () =>
            (await stored()).journal.find((entry) => entry.id === captured.id)
              ?.state,
        )
        .toBe("accepted");
      const repeated = await api.post(
        `/api/v1/module/${child.id}/workspaces/${scope.workspaceId}/records`,
        {
          headers: {
            ...headers,
            "idempotency-key": captured.id,
            "x-module-version": captured.call.moduleVersion!,
          },
          data: { action, resource: "notes", input: captured.call.input },
        },
      );
      expect(repeated.ok(), await repeated.text()).toBe(true);
    }
    expect((await records()).rows[0]).toMatchObject({
      version: 3,
      archived: true,
      data: { name: "Updated foreign record" },
    });
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=any($2::text[])",
          [
            scope.workspaceId,
            [
              `${child.id}.notes.create`,
              `${child.id}.notes.update`,
              `${child.id}.notes.archive`,
            ],
          ],
        )
      ).rows[0].n,
    ).toBe(3);
    expect(
      (await stored()).journal.find((entry) => entry.id === before[2].id),
    ).toEqual(before[2]);
  }
}
