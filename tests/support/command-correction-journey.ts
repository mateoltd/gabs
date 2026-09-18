import { commandContinuationJourney } from "./command-continuation-journey";
import { resourceHostJourney } from "./resource-host-journey";
import {
  expect,
  type Page,
  type Locator,
  type APIRequestContext,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";
import module from "../fixtures/queued-notes/module";
import { commandRetirementJourney } from "./command-retirement-journey";
export type CommandCorrectionOptions = {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  mode:
    | "cross-module"
    | "rejected"
    | "uncertain"
    | "late-accepted"
    | "lease-expired"
    | "permission-revoked"
    | "upgrade"
    | "removed"
    | "service-only"
    | "viewless"
    | "uninstalled"
    | "resource-viewless"
    | "resource-uninstalled";
  recoverySurface?: "viewless" | "uninstalled";
  exportWork(button: Locator): Promise<unknown>;
  rejectExport(
    button: Locator,
    moduleId: string,
    during: () => Promise<void>,
  ): Promise<void>;
  holdSettlement?(): Promise<{
    arrived(): Promise<void>;
    release(): Promise<void>;
  }>;
  offline(value: boolean): Promise<void>;
  restartOffline(): Promise<Page>;
  reconnect(): Promise<void>;
  blockOriginal(key: string): Promise<void>;
  loseSettlementReply(): Promise<void>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
};
export async function commandCorrectionJourney(
  options: CommandCorrectionOptions,
) {
  if (options.mode === "cross-module")
    return commandContinuationJourney(options);
  if (
    options.mode === "resource-viewless" ||
    options.mode === "resource-uninstalled"
  )
    return resourceHostJourney(options);
  if (options.mode === "viewless" || options.mode === "uninstalled")
    options = {
      ...options,
      recoverySurface: options.mode,
      mode: options.mode === "viewless" ? "removed" : "service-only",
    };
  let page = options.page;
  const { api, pool, mode } = options;
  const interrupted = mode === "lease-expired" || mode === "permission-revoked";
  const evidence = options.recoverySurface
    ? "command-recovery-host"
    : mode === "removed" || mode === "service-only"
      ? "command-retirement"
      : mode === "upgrade"
        ? "command-upgrade"
        : interrupted
          ? "command-authority"
          : "command-correction";
  const id = `correct-${randomUUID().slice(0, 8)}`;
  const fixtureName = `Correction notes ${id.slice(-8)}`;
  const pkg = await publishExecutableFixture({
    id,
    name: fixtureName,
    sourceDirectory: "tests/fixtures/queued-notes",
  });
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
    "idempotency-key": randomUUID(),
  };
  const created = await api.post("/api/v1/workspaces", {
    headers,
    data: {
      id: scope.workspaceId,
      name: "Command correction acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
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
      module.permissions.map((p) => p.replaceAll(module.id, id)),
    ],
  );
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  const open = async () => {
    await page.getByRole("link", { name: fixtureName, exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeVisible();
  };
  const inbox = async () => {
    await open();
    await page.getByRole("button", { name: /^Saved commands/ }).click();
    return page.getByRole("dialog", { name: "Saved commands", exact: true });
  };
  await open();
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
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
  await capture(
    mode !== "uncertain" ? "Reject this note" : "Never submitted original",
  );
  await capture("Selected dependent", true);
  await capture("Unselected dependent", true);
  const journal = async () =>
    (await options.storage(page, scope)).journal.filter(
      (e) => e.call.moduleId === id,
    );
  const before = await journal();
  expect(before.slice(1).map((e) => e.dependencies)).toEqual([
    [before[0].id],
    [before[0].id],
  ]);
  if (mode === "uncertain") await options.blockOriginal(before[0].id);
  await options.reconnect();
  await open();
  await expect
    .poll(async () => (await journal())[0].attempts)
    .toBeGreaterThan(0);
  let dialog = await inbox();
  if (mode === "uncertain") {
    await dialog
      .getByRole("button", { name: "Resolve outcome", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Resolve command outcome", exact: true })
      .getByRole("button", {
        name: "Recover result or stop retries",
        exact: true,
      })
      .click();
  }
  await expect.poll(async () => (await journal())[0].state).toBe("rejected");
  await dialog
    .getByRole("button", { name: "Review command", exact: true })
    .click();
  let review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await options.offline(true);
  await review.getByLabel("Name", { exact: true }).fill("Corrected parent");
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review.getByRole("status")).toHaveText(
    "Review saved on this device.",
  );
  expect((await journal())[0].call).toEqual(before[0].call);
  page = await options.restartOffline();
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
    "Corrected parent",
  );
  await expect(review).toHaveClass(/is-open/);
  await mkdir(`docs/verification/${evidence}`, { recursive: true });
  await page.screenshot({
    path: `docs/verification/${evidence}/${options.kind}-${mode}-review.png`,
  });
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
  await page.screenshot({
    path: `docs/verification/${evidence}/${options.kind}-${mode}-review-narrow.png`,
  });
  await options.wide();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  if (mode === "removed" || mode === "service-only") {
    if (options.recoverySurface === "viewless") {
      await capture("Independent saved command");
      before.push((await journal()).at(-1)!);
      expect(before.at(-1)!.dependencies).toEqual([]);
    }
    await commandRetirementJourney(
      { ...options, page },
      { id, fixtureName, scope, headers, pkg, before },
    );
    return;
  }
  if (mode === "upgrade") {
    const next = await publishExecutableFixture({
      id,
      name: fixtureName,
      sourceDirectory: "tests/fixtures/queued-notes",
      transform: (file, source) => {
        source = source.replaceAll(`${id}.capture`, `${id}.capture-next`);
        if (file === "module.ts")
          source = source.replace(
            "{ name: Type.String({ minLength: 1 }) },",
            '{ name: Type.String({ minLength: 1 }), reason: Type.String({ minLength: 3, title: "Reason" }) },',
          );
        if (file === "view.tsx")
          source = source.replace(
            "{ name },",
            '{ name, reason: "New capture" },',
          );
        if (file === "module-server.ts")
          source = source.replace(
            ".create(input)",
            ".create({ name: input.name })",
          );
        return source;
      },
    });
    const rollout = await api.post(
      `/api/v1/workspaces/${scope.workspaceId}/platform`,
      {
        headers: { ...headers, "idempotency-key": randomUUID() },
        data: {
          action: "rollout",
          version: 0,
          value: {
            moduleId: id,
            version: next.version,
            mandatory: false,
            acceptedVersions: [pkg.version],
          },
        },
      },
    );
    expect(rollout.ok(), await rollout.text()).toBe(true);
    await options.reconnect();
    await page.reload();
    await page.getByRole("link", { name: "Modules", exact: true }).click();
    const card = page.locator(".module-install-card").filter({
      has: page.getByRole("heading", {
        name: fixtureName,
        exact: true,
      }),
    });
    await expect(card).toContainText(`Version ${next.version}`);
    const update = card.getByRole("button", { name: "Update", exact: true });
    if (await update.isVisible()) await update.click();
    await expect(card).toContainText(`Installed ${next.version}`);
    // Establish an explicit old-only policy and reopen the installed view
    // before testing the permission boundary.
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [scope.workspaceId, `${id}.capture-next`],
    );
    await page.reload();
    await open();
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    expect((await journal()).map((e) => e.call)).toEqual(
      before.map((e) => e.call),
    );
    // Only the new permission cannot disclose an original request or its saved review.
    await pool.query(
      "update suite.roles set permissions=array_append(array_remove(permissions,$2),$3) where workspace_id=$1",
      [scope.workspaceId, `${id}.capture`, `${id}.capture-next`],
    );
    await page.reload();
    await open();
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    const denied = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/attempts/settle`,
      {
        headers: { ...headers, "x-module-version": pkg.version },
        data: {
          key: before[0].id,
          call: {
            action: "operation",
            operation: "capture",
            input: before[0].call.input,
          },
        },
      },
    );
    expect(denied.status()).toBe(403);
    await options.offline(true);
    page = await options.restartOffline();
    await open();
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    await options.narrow();
    await page.screenshot({
      path: `docs/verification/${evidence}/${options.kind}-original-permission-denied.png`,
    });
    await options.wide();
    expect(
      (await options.storage(page, scope)).commandReviews?.[before[0].id]
        ?.moduleVersion,
    ).toBe(pkg.version);
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and not ($2=any(permissions))",
      [scope.workspaceId, `${id}.capture`],
    );
    await options.reconnect();
    await page.reload();
    dialog = await inbox();
    await dialog
      .getByRole("button", { name: "Resume command review", exact: true })
      .click();
    review = page.getByRole("dialog", {
      name: "Review saved command",
      exact: true,
    });
    await expect(review).toContainText("The installed release changed");
    await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
      "Corrected parent",
    );
    await expect(
      review.getByRole("button", {
        name: "Prepare corrected command",
        exact: true,
      }),
    ).toBeDisabled();
    await review
      .getByLabel("Reason", { exact: true })
      .fill("Reviewed after upgrade");
    await review
      .getByRole("button", { name: "Save review", exact: true })
      .click();
    await expect(review).toContainText("Review saved on this device.");
    const revised = (await options.storage(page, scope)).commandReviews?.[
      before[0].id
    ];
    expect(revised).toMatchObject({
      moduleVersion: next.version,
      source: before[0].call,
      input: { name: "Corrected parent", reason: "Reviewed after upgrade" },
    });
    await options.narrow();
    await page.screenshot({
      path: `docs/verification/${evidence}/${options.kind}-upgraded-review-narrow.png`,
    });
    await options.wide();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  if (mode === "late-accepted") {
    await pool.query(
      "update suite.module_activations set config=$3::jsonb where workspace_id=$1 and module_id=$2",
      [scope.workspaceId, id, JSON.stringify({ allowRejected: true })],
    );
    const accepted = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
      {
        headers: {
          ...headers,
          "idempotency-key": before[0].id,
          "x-module-version": pkg.version,
        },
        data: before[0].call.input,
      },
    );
    expect(accepted.ok(), await accepted.text()).toBe(true);
  }
  const held = interrupted ? await options.holdSettlement!() : undefined;
  if (!held) await options.loseSettlementReply();
  await options.reconnect();
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await review
    .getByRole("checkbox", { name: "Continue Save note", exact: true })
    .first()
    .check();
  await review
    .getByRole("button", { name: "Prepare corrected command", exact: true })
    .click();
  let confirm = page.getByRole("dialog", {
    name: "Submit corrected command",
    exact: true,
  });
  await confirm
    .getByRole("button", {
      name: "Resolve original and save correction",
      exact: true,
    })
    .click();
  if (held) {
    await held.arrived();
    const saved = await options.storage(page, scope);
    const permission = async (granted: boolean) => {
      await pool.query(
        granted
          ? "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and not ($2=any(permissions))"
          : "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
        [scope.workspaceId, `${id}.capture`],
      );
      await pool.query(
        "update suite.workspace_policy set revision=revision+1 where workspace_id=$1",
        [scope.workspaceId],
      );
      await pool.query("select pg_notify('suite_policy',$1)", [
        scope.workspaceId,
      ]);
    };
    if (mode === "lease-expired") {
      await options.offline(true);
      await page.clock.install();
      await page.clock.setSystemTime(new Date(Date.now() + 25 * 3600000));
      await expect(
        page.getByText(
          "Connect to revalidate this workspace. Unsent drafts remain stored.",
          { exact: true },
        ),
      ).toBeVisible();
    } else {
      await permission(false);
      await expect(
        page.getByRole("button", { name: "Save pending note", exact: true }),
      ).toBeDisabled();
    }
    await expect(review).toHaveCount(0);
    await expect(confirm).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    await held.release();
    // Wait for the same workspace recovery lock, proving the held action has finished.
    await page.evaluate(
      (scope) =>
        navigator.locks.request(
          `suite-sync:${scope.userId}:${scope.workspaceId}`,
          async () => {},
        ),
      scope,
    );
    const retained = await options.storage(page, scope);
    expect(retained.journal).toEqual(saved.journal);
    expect(retained.commandReviews).toEqual(saved.commandReviews);
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.module_records where workspace_id=$1 and module_id=$2",
          [scope.workspaceId, id],
        )
      ).rows[0].n,
    ).toBe(0);
    await options.narrow();
    await page.screenshot({
      path: `docs/verification/${evidence}/${options.kind}-${mode}-blocked-narrow.png`,
    });
    await options.wide();
    if (mode === "lease-expired") await page.clock.setSystemTime(new Date());
    else await permission(true);
    await options.reconnect();
    await page.reload();
    await open();
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeEnabled();
  } else await expect(confirm.getByRole("alert")).toBeVisible();
  expect(await journal()).toHaveLength(3);
  const late = await api.post(
    `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
    {
      headers: {
        ...headers,
        "idempotency-key": before[0].id,
        "x-module-version": pkg.version,
      },
      data: before[0].call.input,
    },
  );
  if (mode === "late-accepted") expect(late.ok(), await late.text()).toBe(true);
  else {
    expect(late.status()).toBe(409);
    expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  }
  await options.offline(true);
  page = await options.restartOffline();
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
    "Corrected parent",
  );
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
  await review
    .getByRole("checkbox", { name: "Continue Save note", exact: true })
    .first()
    .check();
  await review
    .getByRole("button", { name: "Prepare corrected command", exact: true })
    .click();
  confirm = page.getByRole("dialog", {
    name: "Submit corrected command",
    exact: true,
  });
  await confirm
    .getByRole("button", {
      name: "Resolve original and save correction",
      exact: true,
    })
    .click();
  if (mode === "late-accepted") {
    await expect
      .poll(async () => (await journal()).map((e) => e.state))
      .toEqual(["accepted", "accepted", "accepted"]);
    const final = await journal();
    expect(final.map((e) => e.call)).toEqual(before.map((e) => e.call));
    expect(final[0].supersededBy).toBeUndefined();
    expect(
      (await options.storage(page, scope)).commandReviews?.[before[0].id]
        ?.input,
    ).toEqual({ name: "Corrected parent" });
    await expect(review).toContainText("The original command was accepted");
    await expect(
      review.getByRole("button", {
        name: "Remove unavailable selections",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(review).toContainText("Review saved on this device.");
    await expect(review).not.toContainText("Review has unsaved changes.");
    await expect(
      review.getByRole("button", { name: "Save review", exact: true }),
    ).toBeDisabled();
    expect(
      (
        await pool.query(
          "select data->>'name' as name from suite.module_records where workspace_id=$1 and module_id=$2 order by name",
          [scope.workspaceId, id],
        )
      ).rows.map((r) => r.name),
    ).toEqual([
      "Reject this note",
      "Selected dependent",
      "Unselected dependent",
    ]);
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
          [scope.workspaceId, `${id}.notes.create`],
        )
      ).rows[0].n,
    ).toBe(3);
    await options.narrow();
    await page.screenshot({
      path: `docs/verification/${evidence}/${options.kind}-${mode}-result-narrow.png`,
    });
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode(options.kind === "native")
          .include('[role="dialog"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    return;
  }
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["rejected", "accepted", "pending", "accepted"]);
  const final = await journal();
  expect(final[0].call).toEqual(before[0].call);
  expect(final[0].settlement).toBe("cancelled");
  expect(final[0].supersededBy).toBe(final[3].id);
  expect(final[1].call).toEqual(before[1].call);
  expect(final[1].dependencies).toEqual([final[3].id]);
  expect(final[2]).toEqual(before[2]);
  expect(final[3].call.input).toEqual(
    mode === "upgrade"
      ? { name: "Corrected parent", reason: "Reviewed after upgrade" }
      : { name: "Corrected parent" },
  );
  const repeat = await api.post(
    `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
    {
      headers: {
        ...headers,
        "idempotency-key": final[3].id,
        "x-module-version": final[3].call.moduleVersion!,
      },
      data: final[3].call.input,
    },
  );
  expect(repeat.ok(), await repeat.text()).toBe(true);
  expect(
    (
      await pool.query(
        "select data->>'name' as name from suite.module_records where workspace_id=$1 and module_id=$2 order by name",
        [scope.workspaceId, id],
      )
    ).rows.map((r) => r.name),
  ).toEqual(["Corrected parent", "Selected dependent"]);
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.notes.create`],
      )
    ).rows[0].n,
  ).toBe(2);
  await expect(review).toHaveCount(0);
  await expect(confirm).toHaveCount(0);
  await options.narrow();
  await page.screenshot({
    path: `docs/verification/${evidence}/${options.kind}-${mode}-result-narrow.png`,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}
