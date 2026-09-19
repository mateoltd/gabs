import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import module from "../fixtures/queued-resources/module";
import { recoverCollisionOutcome } from "./collision-outcome-recovery";

export async function collisionCommandJourney(
  options: CommandCorrectionOptions,
) {
  let page = options.page;
  const { api, pool } = options;
  const outcome =
    options.mode === "collision-command-accepted"
      ? "accepted"
      : options.mode === "collision-command-cancelled"
        ? "cancelled"
        : undefined;
  const destination =
    options.mode === "collision-command-existing" ? "existing" : "separate";
  const id = `command-collision-${randomUUID().slice(0, 8)}`;
  const name = `Command collision ${id}`;
  const transform = (file: string, source: string) => {
    if (file === "module.ts")
      return source.replace(
        "{ name: Type.String({ minLength: 1 }) }",
        `{ name: Type.String({ minLength: 1 }), targetId: field.reference("${id}", "notes") }`,
      );
    if (file === "module-server.ts")
      return source.replace(
        'ctx.resource("notes").create(input)',
        'ctx.resource("notes").create({ name: input.name + ": " + (await ctx.resource("notes").get(input.targetId)).data.name })',
      );
    if (file === "view.tsx")
      return source
        .replace(
          ".queue.create({ name }, { dependencies:",
          ".queue.create({ name }, { id: recordId || undefined, dependencies:",
        )
        .replace(
          "      <PageHeading",
          `      <Button disabled={busy || !parent || !recordId || !name} onClick={() => { setBusy(true); void client.queue("capture", { name, targetId: recordId }, { dependencies: parent ? [parent] : [] }).then(() => setName("")).catch(setError).finally(() => setBusy(false)); }}>Save linked command</Button>
      <PageHeading`,
        );
    return source;
  };
  const published = await publishExecutableFixture({
    id,
    name,
    sourceDirectory: "tests/fixtures/queued-resources",
    transform,
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
      name: "Command collision acceptance",
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
  await page.getByLabel("Note name", { exact: true }).fill("Linked effect");
  await page
    .getByRole("button", { name: "Save linked command", exact: true })
    .click();
  const read = () => options.storage(page, scope);
  await expect.poll(async () => (await read()).journal.length).toBe(2);
  const before = (await read()).journal;
  expect(before[0].call.input).toEqual({
    id: originalTarget,
    data: { name: "Separate recovered record" },
  });
  expect(before[1].call.input).toEqual({
    name: "Linked effect",
    targetId: originalTarget,
  });
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
      file === "module.ts"
        ? transform(file, source).replace('    view: "home",\n', "")
        : transform(file, source),
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
  if (outcome) {
    page = await recoverCollisionOutcome({
      options,
      page,
      scope,
      headers,
      name,
      child: before[1],
      outcome,
    });
    await page.getByRole("link", { name, exact: true }).click();
  }
  await page
    .getByRole("group", {
      name: "Pending create: Separate recovered record",
      exact: true,
    })
    .getByRole("button", {
      name: outcome ? "Resume review" : "Review",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  const choice = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await choice
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(choice).toHaveCount(0);
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual([
      "conflict",
      outcome === "accepted" ? "accepted" : "conflict",
      "accepted",
    ]);
  const recovered = (await read()).journal;
  const separateTarget = (recovered[2].call.input as { id: string }).id;
  const target = destination === "existing" ? originalTarget : separateTarget;
  expect(recovered[1].call).toEqual(before[1].call);
  expect(recovered[1].id).toBe(before[1].id);
  if (outcome === "accepted") {
    expect(recovered[1].dependencies).toEqual(before[1].dependencies);
    expect(recovered[1].supersededBy).toBeUndefined();
    expect(recovered[1].createRecovery).toBeUndefined();
    const effect = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
      {
        headers: {
          ...headers,
          "idempotency-key": before[1].id,
          "x-module-version": before[1].call.moduleVersion!,
        },
        data: before[1].call.input,
      },
    );
    expect(effect.status()).toBe(200);
    expect(await effect.json()).toEqual(recovered[1].result);
    const evidence = "docs/verification/collision-outcomes/command-accepted";
    await mkdir(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/${options.kind}-accepted.png` });
    const acceptedRows = await pool.query(
      "select data from suite.module_records where workspace_id=$1 and module_id=$2",
      [scope.workspaceId, id],
    );
    expect(acceptedRows.rows.map((r) => r.data.name).sort()).toEqual(
      [
        "Existing corporate record",
        "Separate recovered record",
        "Linked effect: Existing corporate record",
      ].sort(),
    );
    expect(
      (
        await pool.query(
          "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
          [scope.workspaceId, `${id}.notes.create`],
        )
      ).rows[0].n,
    ).toBe(3);
    await options.offline(true);
    page = await options.restartOffline();
    expect((await read()).journal).toEqual(recovered);
    return;
  }
  expect(recovered[1].captureDependencies).toEqual([before[0].id]);
  expect(recovered[1].dependencies).toEqual([recovered[2].id]);
  expect(recovered[1].attempts).toBe(outcome ? 1 : 0);
  const records = () =>
    pool.query(
      "select id,data from suite.module_records where workspace_id=$1 and module_id=$2 order by id",
      [scope.workspaceId, id],
    );
  expect((await records()).rows).toHaveLength(2);
  await options.offline(true);
  page = await options.restartOffline();
  const inbox = async () => {
    await page.getByRole("link", { name, exact: true }).click();
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
  await expect(review).toContainText(originalTarget);
  await expect(review).toContainText(separateTarget);
  await expect(review.getByLabel("Target Id", { exact: true })).toHaveValue(
    originalTarget,
  );
  await review.getByLabel("Target Id", { exact: true }).fill(target);
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review).toContainText("Review saved on this device.");
  const evidence = outcome
    ? `docs/verification/collision-outcomes/command-${outcome}`
    : `docs/verification/collision-commands/${destination}`;
  await mkdir(evidence, { recursive: true });
  const capture = (label: string) =>
    page.screenshot({ path: `${evidence}/${options.kind}-${label}.png` });
  await capture("offline-review");
  await options.narrow();
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(await review.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await capture("offline-review-narrow");
  await options.wide();
  page = await options.restartOffline();
  await options.reconnect();
  if (destination === "separate") {
    await pool.query(
      "update suite.roles set permissions=array_remove(permissions,$2) where workspace_id=$1",
      [scope.workspaceId, `${id}.capture`],
    );
    await page.reload();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    await options.offline(true);
    page = await options.restartOffline();
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("button", { name: /^Saved commands/ }),
    ).toHaveCount(0);
    expect((await read()).journal[1].call).toEqual(before[1].call);
    expect((await read()).commandReviews?.[before[1].id]?.input).toEqual({
      name: "Linked effect",
      targetId: target,
    });
    await pool.query(
      "update suite.roles set permissions=array_append(permissions,$2) where workspace_id=$1 and not ($2=any(permissions))",
      [scope.workspaceId, `${id}.capture`],
    );
    await options.reconnect();
    await page.reload();
  }
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(review.getByLabel("Target Id", { exact: true })).toHaveValue(
    target,
  );
  expect((await records()).rows).toHaveLength(2);
  await options.loseSettlementReply();
  const submit = async () => {
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
    return confirm;
  };
  let confirm = await submit();
  await expect(confirm.getByRole("alert")).toBeVisible();
  expect((await read()).journal[1].call).toEqual(before[1].call);
  expect((await records()).rows).toHaveLength(2);
  await options.offline(true);
  page = await options.restartOffline();
  await options.reconnect();
  dialog = await inbox();
  await dialog
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  confirm = await submit();
  await expect(confirm).toHaveCount(0);
  await expect
    .poll(async () => (await read()).journal[3]?.state)
    .toBe("accepted");
  const final = (await read()).journal;
  expect(final[1].call).toEqual(before[1].call);
  expect(final[3].call.input).toEqual({
    name: "Linked effect",
    targetId: target,
  });
  for (const entry of [before[1], final[3]]) {
    const response = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/operations/capture`,
      {
        headers: {
          ...headers,
          "idempotency-key": entry.id,
          "x-module-version": entry.call.moduleVersion!,
        },
        data: entry.call.input,
      },
    );
    expect(response.status()).toBe(entry === final[3] ? 200 : 409);
    if (entry !== final[3])
      expect(await response.json()).toMatchObject({
        code: "ATTEMPT_CANCELLED",
      });
  }
  const rows = (await records()).rows;
  expect(rows).toHaveLength(3);
  expect(
    rows
      .filter((r) => r.id !== originalTarget && r.id !== separateTarget)
      .map((r) => r.data.name),
  ).toEqual([
    `Linked effect: ${destination === "existing" ? "Existing corporate record" : "Separate recovered record"}`,
  ]);
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.notes.create`],
      )
    ).rows[0].n,
  ).toBe(3);
  await expect(dialog).toContainText("Accepted");
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    page.getByRole("cell", {
      name: `Linked effect: ${destination === "existing" ? "Existing corporate record" : "Separate recovered record"}`,
      exact: true,
    }),
  ).toBeVisible();
  await capture("accepted");
}
