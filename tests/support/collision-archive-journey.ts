import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import module from "../fixtures/queued-resources/module";

export async function collisionArchiveJourney(
  options: CommandCorrectionOptions,
) {
  let page = options.page;
  const { api, pool } = options;
  const destination =
    options.mode === "collision-archive-existing" ? "existing" : "separate";
  const id = `archive-collision-${randomUUID().slice(0, 8)}`;
  const name = `Archive collision ${id}`;
  const published = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/queued-resources",
    transform: (file, source) =>
      file === "view.tsx"
        ? source.replace(
            ".queue.create({ name }, { dependencies:",
            ".queue.create({ name }, { id: recordId || undefined, dependencies:",
          )
        : source,
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
      name: "Archive collision acceptance",
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
  const originalTarget = randomUUID();
  const originalRow = await api.post(
    `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
    {
      headers: {
        ...headers,
        "idempotency-key": randomUUID(),
        "x-module-version": published.version,
      },
      data: {
        action: "create",
        resource: "notes",
        input: {
          id: originalTarget,
          data: { name: "Existing corporate record" },
        },
      },
    },
  );
  expect(originalRow.ok(), await originalRow.text()).toBe(true);
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByLabel("Accepted record identity", { exact: true })
    .fill(originalTarget);
  await page
    .getByRole("button", { name: "Load accepted record", exact: true })
    .click();
  await expect(
    page.getByText("Loaded server version 1: Existing corporate record", {
      exact: true,
    }),
  ).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Separate recovered record");
  await page
    .getByRole("button", { name: "Save pending note", exact: true })
    .click();
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  await page
    .getByRole("button", { name: "Save pending archive", exact: true })
    .click();
  const read = () => options.storage(page, scope);
  await expect.poll(async () => (await read()).journal.length).toBe(2);
  const before = (await read()).journal;
  expect(before[0].call.input).toEqual({
    id: originalTarget,
    data: { name: "Separate recovered record" },
  });
  expect(before[1].call.input).toEqual({ id: originalTarget, baseVersion: 1 });
  expect(before[1].dependencies).toEqual([before[0].id]);
  await options.reconnect();
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual(["conflict", "pending"]);
  const next = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/queued-resources",
    transform: (file, source) =>
      file === "module.ts" ? source.replace('    view: "home",\n', "") : source,
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
          acceptedVersions: [published.version],
        },
      },
    },
  );
  expect(rollout.ok(), await rollout.text()).toBe(true);
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page
    .locator(".module-install-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await expect(card).toContainText(`Version ${next.version}`);
  await card.getByRole("button", { name: "Update", exact: true }).click();
  await expect(card).toContainText(`Installed ${next.version}`);
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByRole("group", {
      name: "Pending create: Separate recovered record",
      exact: true,
    })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  let choice = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await expect(
    choice.getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    }),
  ).toBeDisabled();
  await selectValue(page, "Record for later archive 1", destination);
  await choice.getByText("View archive target", { exact: true }).click();
  await expect(choice).toContainText(originalTarget);
  const evidence = `docs/verification/collision-archives/${destination}`;
  await mkdir(evidence, { recursive: true });
  const capture = async (label: string) => {
    await page.mouse.move(200, 60);
    await expect(page.locator('[role="tooltip"]')).toHaveCount(0);
    return page.screenshot({
      path: `${evidence}/${options.kind}-${label}.png`,
    });
  };
  await capture("choice");
  await options.narrow();
  const navigationLabel = () =>
    page.locator(".sidebar .nav-label").filter({ hasText: name });
  await expect(navigationLabel()).toBeHidden();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await choice.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await capture("choice-narrow");
  await options.wide();
  await options.loseSettlementReply();
  await choice
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(choice.getByRole("alert")).toBeVisible();
  expect((await read()).journal.map((e) => e.call)).toEqual(
    before.map((e) => e.call),
  );
  await options.offline(true);
  page = await options.restartOffline();
  await options.reconnect();
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  choice = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await selectValue(page, "Record for later archive 1", destination);
  await choice
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual(["conflict", "pending", "accepted", "conflict"]);
  const remapped = (await read()).journal;
  const separateTarget = (remapped[2].call.input as { id: string }).id;
  const target = destination === "separate" ? separateTarget : originalTarget;
  expect(remapped[1].call).toEqual(before[1].call);
  expect(remapped[3]).toMatchObject({
    state: "conflict",
    delivery: "unsubmitted",
    recordRecovery: { targetId: target, destination },
  });
  expect(remapped[3].call.input).toEqual(before[1].call.input);
  const rows = () =>
    pool.query(
      "select id,data,version,archived from suite.module_records where workspace_id=$1 and module_id=$2 order by id",
      [scope.workspaceId, id],
    );
  expect((await rows()).rows.every((r) => r.version === 1 && !r.archived)).toBe(
    true,
  );
  await options.offline(true);
  page = await options.restartOffline();
  expect((await read()).journal).toEqual(remapped);
  await options.reconnect();
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByRole("group", { name: /^Pending archive:/ })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  let review = page.getByRole("dialog", {
    name: "Review archive",
    exact: true,
  });
  await expect(review).toContainText(`Original target: ${originalTarget}`);
  if (destination === "separate")
    await expect(review).toContainText(`Selected recovery target: ${target}`);
  await expect(
    review.getByText(
      destination === "separate"
        ? "Separate recovered record"
        : "Existing corporate record",
      { exact: true },
    ),
  ).toBeVisible();
  await capture("review");
  await options.loseSettlementReply();
  await review
    .getByRole("button", { name: "Confirm reviewed archive", exact: true })
    .click();
  await expect(review.getByRole("alert")).toBeVisible();
  expect((await rows()).rows.every((r) => r.version === 1 && !r.archived)).toBe(
    true,
  );
  await options.offline(true);
  page = await options.restartOffline();
  await options.reconnect();
  await page.getByRole("link", { name, exact: true }).click();
  await page
    .getByRole("group", { name: /^Pending archive:/ })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  review = page.getByRole("dialog", { name: "Review archive", exact: true });
  await expect(review).toContainText("Current server version: 1");
  await review
    .getByRole("button", { name: "Confirm reviewed archive", exact: true })
    .click();
  await expect(review).toHaveCount(0);
  await expect
    .poll(async () => (await read()).journal[4]?.state)
    .toBe("accepted");
  const final = (await read()).journal;
  expect(final[0].call).toEqual(before[0].call);
  expect(final[1].call).toEqual(before[1].call);
  expect(final[3].call).toEqual(remapped[3].call);
  expect(final[4].call.input).toEqual({ id: target, baseVersion: 1 });
  for (const entry of [before[0], remapped[3], final[4]]) {
    const reply = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": entry.id,
          "x-module-version": entry.call.moduleVersion!,
        },
        data: {
          action: entry.call.action,
          resource: "notes",
          input: entry.call.input,
        },
      },
    );
    expect(reply.status()).toBe(entry === final[4] ? 200 : 409);
    if (entry !== final[4])
      expect(await reply.json()).toMatchObject({ code: "ATTEMPT_CANCELLED" });
  }
  const stored = (await rows()).rows;
  expect(stored).toHaveLength(2);
  expect(stored.find((r) => r.id === target)).toMatchObject({
    version: 2,
    archived: true,
  });
  expect(stored.find((r) => r.id !== target)).toMatchObject({
    version: 1,
    archived: false,
  });
  expect(stored.find((r) => r.id === originalTarget)?.data).toEqual({
    name: "Existing corporate record",
  });
  expect(stored.find((r) => r.id === separateTarget)?.data).toEqual({
    name: "Separate recovered record",
  });
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.notes.archive`],
      )
    ).rows[0].n,
  ).toBe(1);
  await page
    .getByRole("button", { name: "Show archived", exact: true })
    .click();
  await expect(
    page.getByRole("cell", {
      name:
        destination === "separate"
          ? "Separate recovered record"
          : "Existing corporate record",
      exact: true,
    }),
  ).toBeVisible();
  await capture("accepted");
  await options.narrow();
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  await expect(navigationLabel()).toBeVisible();
  expect(
    await navigationLabel().evaluate((label) => {
      const bounds = label.getBoundingClientRect();
      const link = label.closest("a")!.getBoundingClientRect();
      return bounds.left >= link.left && bounds.right <= link.right;
    }),
  ).toBe(true);
  await capture("navigation-narrow");
  await page.keyboard.press("Escape");
  await expect(navigationLabel()).toBeHidden();
}
