import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { publishExecutableFixture } from "./executable-fixture";
import { selectValue } from "../e2e/controls.helpers";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import module from "../fixtures/queued-resources/module";
import { recoverCollisionOutcome } from "./collision-outcome-recovery";

export async function collisionResourceJourney(
  options: CommandCorrectionOptions,
) {
  let page = options.page;
  const { api, pool } = options;
  const action = options.mode.split("-")[2] as "create" | "update" | "archive";
  const outcome = options.mode.endsWith("accepted") ? "accepted" : "cancelled";
  const repeated = action === "update" && outcome === "cancelled";
  const id = `resource-collision-${randomUUID().slice(0, 8)}`;
  const name = `Resource collision ${id}`;
  const transform = (file: string, source: string) => {
    if (file === "module.ts")
      return source.replace(
        "notes: resource({ name: field.text({ minLength: 1 }) }",
        `notes: resource({ name: field.text({ minLength: 1 }), parentId: Type.Optional(field.reference("${id}", "notes")) }`,
      );
    if (file === "view.tsx")
      return source.replace(
        ".queue.create({ name }, { dependencies:",
        ".queue.create({ name, ...(dependency ? { parentId: recordId } : {}) }, { id: dependency ? undefined : recordId || undefined, dependencies:",
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
      name: "Resource collision acceptance",
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
    .getByLabel("Note name", { exact: true })
    .fill("Linked resource change");
  await page
    .getByRole("button", {
      name:
        action === "create"
          ? "Save dependent note"
          : action === "update"
            ? "Save pending update"
            : "Save pending archive",
      exact: true,
    })
    .click();
  const read = () => options.storage(page, scope);
  await expect.poll(async () => (await read()).journal.length).toBe(2);
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  const before = (await read()).journal;
  expect(before[0].call.input).toEqual({
    id: originalTarget,
    data: { name: "Separate recovered record" },
  });
  expect(before[1].call.action).toBe(action);
  expect(before[1].dependencies).toEqual([before[0].id]);
  if (action === "create")
    expect(before[1].call.input).toMatchObject({
      data: { name: "Linked resource change", parentId: originalTarget },
    });
  let acceptedSibling: (typeof before)[number] | undefined;
  if (repeated) {
    await page
      .getByLabel("Note name", { exact: true })
      .fill("Accepted sibling");
    await page
      .getByRole("button", { name: "Save dependent note", exact: true })
      .click();
    await expect.poll(async () => (await read()).journal.length).toBe(3);
    await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
    acceptedSibling = (await read()).journal[2];
    expect(acceptedSibling.dependencies).toEqual([before[0].id]);
  }
  // A blocked dependency branch must not hold independent captured work.
  await page.getByLabel("Accepted record identity", { exact: true }).fill("");
  await page
    .getByLabel("Note name", { exact: true })
    .fill("Independent progress");
  await page
    .getByRole("button", { name: "Save pending note", exact: true })
    .click();
  await expect
    .poll(async () => (await read()).journal.length)
    .toBe(repeated ? 4 : 3);
  await expect(page.getByLabel("Note name", { exact: true })).toHaveValue("");
  await options.reconnect();
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual([
      "conflict",
      "pending",
      ...(repeated ? ["pending"] : []),
      "accepted",
    ]);
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
  page = await recoverCollisionOutcome({
    options,
    page,
    scope,
    headers,
    name,
    child: before[1],
    outcome,
    ...(action !== "create" ? { targetChoice: "separate" as const } : {}),
  });
  if (acceptedSibling) {
    page = await recoverCollisionOutcome({
      options,
      page,
      scope,
      headers,
      name,
      child: acceptedSibling,
      outcome: "accepted",
      checkParent: false,
    });
    acceptedSibling = structuredClone(
      (await read()).journal.find((entry) => entry.id === acceptedSibling!.id)!,
    );
  }
  const settled = structuredClone((await read()).journal[1]);
  await page.getByRole("link", { name, exact: true }).click();
  let priorDraft: { key: string; review: unknown; data: unknown } | undefined;
  let openReviewPage: Page | undefined;
  if (outcome === "cancelled" && action !== "archive") {
    await page
      .getByRole("group", {
        name: new RegExp(`^Pending ${action}: Linked resource change`),
      })
      .getByRole("button", { name: "Review", exact: true })
      .click();
    const review = page.getByRole("dialog");
    await review
      .getByLabel("Name", { exact: true })
      .fill("Preserved before parent recovery");
    await expect
      .poll(async () =>
        Object.values((await read()).drafts).some(
          (draft) => draft.name === "Preserved before parent recovery",
        ),
      )
      .toBe(true);
    const state = await read();
    const saved = Object.entries(state.draftReviews ?? {}).find(
      ([, review]) => review.entryId === before[1].id,
    )!;
    priorDraft = {
      key: saved[0],
      review: structuredClone(saved[1]),
      data: structuredClone(state.drafts[saved[0]]),
    };
    await review
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    if (repeated && options.openPeer) {
      openReviewPage = await options.openPeer();
      await selectValue(openReviewPage, "Workspace", scope.workspaceId);
      await openReviewPage.getByRole("link", { name, exact: true }).click();
      await openReviewPage
        .getByRole("group", { name: /^Pending update:/ })
        .getByRole("button", { name: "Resume review", exact: true })
        .click();
      await expect(
        openReviewPage.getByRole("dialog").getByLabel("Name", { exact: true }),
      ).toHaveValue("Preserved before parent recovery");
    }
  }
  await page
    .getByRole("group", {
      name: "Pending create: Separate recovered record",
      exact: true,
    })
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  const choice = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  if (action !== "create" && outcome === "cancelled")
    await selectValue(
      page,
      `Record for later ${action === "archive" ? "archive" : "edit"} 1`,
      "separate",
    );
  let competingTarget: string | undefined;
  if (repeated) {
    const forcedIds = [randomUUID(), randomUUID()];
    competingTarget = forcedIds[1];
    const competing = await api.post(
      `/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`,
      {
        headers: {
          ...headers,
          "idempotency-key": randomUUID(),
          "x-module-version": next.version,
        },
        data: {
          action: "create",
          resource: "notes",
          input: {
            id: competingTarget,
            data: { name: "Competing separate record" },
          },
        },
      },
    );
    expect(competing.ok(), await competing.text()).toBe(true);
    // Force the next generated record identity to collide with a real server row.
    // The replacement request still uses a fresh key and the ordinary host path.
    await page.evaluate((ids) => {
      const original = crypto.randomUUID;
      crypto.randomUUID = () => {
        const next = ids.shift();
        if (!ids.length) crypto.randomUUID = original;
        return next ?? original.call(crypto);
      };
    }, forcedIds);
  }
  await choice
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  if (repeated) {
    await expect
      .poll(async () => (await read()).journal.map((entry) => entry.state))
      .toEqual(["conflict", "conflict", "accepted", "accepted", "conflict"]);
    const first = await read();
    expect((first.journal[4].call.input as { id: string }).id).toBe(
      competingTarget,
    );
    expect(first.journal[1].recordRecovery?.targetId).toBe(competingTarget);
    expect(first.draftReviews?.[priorDraft!.key]).toEqual(priorDraft!.review);
    expect(first.drafts[priorDraft!.key]).toEqual(priorDraft!.data);
    await options.offline(true);
    page = await options.restartOffline();
    expect((await read()).journal).toEqual(first.journal);
    await options.reconnect();
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
    await selectValue(page, "Record for later edit 1", "separate");
    await page
      .getByRole("dialog", { name: "Create a separate record", exact: true })
      .getByRole("button", {
        name: "Check and create separate record",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  await expect
    .poll(async () => (await read()).journal.map((e) => e.state))
    .toEqual([
      "conflict",
      outcome === "accepted" ? "accepted" : "conflict",
      ...(repeated ? ["accepted"] : []),
      "accepted",
      ...(repeated ? ["conflict"] : []),
      "accepted",
    ]);
  const recovered = (await read()).journal;
  const rootIndex = repeated ? 5 : 3;
  const correctedIndex = rootIndex + 1;
  const separateTarget = (recovered[rootIndex].call.input as { id: string }).id;
  if (priorDraft) {
    expect((await read()).draftReviews?.[priorDraft.key]).toEqual(
      priorDraft.review,
    );
    expect((await read()).drafts[priorDraft.key]).toEqual(priorDraft.data);
  }
  if (openReviewPage) {
    const stale = openReviewPage.getByRole("dialog");
    await expect(stale).toBeVisible();
    await stale.getByLabel("Name", { exact: true }).fill("Open stale input");
    await expect(stale).toContainText(
      "This review no longer belongs to an editable pending change. Refresh pending changes.",
    );
    expect((await read()).drafts[priorDraft!.key]).toEqual(priorDraft!.data);
    await stale.getByRole("button", { name: "Save", exact: true }).click();
    await expect(stale).toContainText(
      "A reviewed change must preserve its original record target.",
    );
    await expect(stale.getByLabel("Name", { exact: true })).toHaveValue(
      "Open stale input",
    );
    expect((await read()).journal).toEqual(recovered);
    expect((await read()).drafts[priorDraft!.key]).toEqual(priorDraft!.data);
    const evidence =
      "docs/verification/collision-outcomes/resources/update-cancelled";
    await mkdir(evidence, { recursive: true });
    await openReviewPage.screenshot({
      path: `${evidence}/web-open-stale-review.png`,
    });
    await openReviewPage.close();
  }
  if (acceptedSibling)
    expect(recovered.find((entry) => entry.id === acceptedSibling!.id)).toEqual(
      acceptedSibling,
    );
  const original = before[1];
  expect(recovered[1].call).toEqual(original.call);
  expect(recovered[1].id).toBe(original.id);
  const evidence = `docs/verification/collision-outcomes/resources/${action}-${outcome}`;
  await mkdir(evidence, { recursive: true });
  const capture = async (
    label: "saved-review" | "review" | "review-narrow" | "accepted",
  ) => {
    const dialog = page.locator('.t-modal[role="dialog"]').last();
    if (label !== "accepted") {
      await expect(dialog).toBeVisible();
      if (options.kind === "web") {
        await expect(dialog).toHaveClass(/is-open/);
        await expect(dialog).toHaveCSS("opacity", "1");
      }
    }
    await page.screenshot({ path: `${evidence}/${options.kind}-${label}.png` });
  };
  const rows = () =>
    pool.query(
      "select id,data,version,archived from suite.module_records where workspace_id=$1 and module_id=$2 order by id",
      [scope.workspaceId, id],
    );
  const retry = (entry: typeof original) =>
    api.post(`/api/v1/module/${id}/workspaces/${scope.workspaceId}/records`, {
      headers: {
        ...headers,
        "idempotency-key": entry.id,
        "x-module-version": entry.call.moduleVersion!,
      },
      data: {
        action: entry.call.action,
        resource: entry.call.resource,
        input: entry.call.input,
      },
    });
  if (outcome === "accepted") {
    expect(recovered[1]).toEqual(settled);
    const response = await retry(original);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(settled.result);
    await options.offline(true);
    page = await options.restartOffline();
    expect((await read()).journal).toEqual(recovered);
    await options.reconnect();
    await page.getByRole("link", { name, exact: true }).click();
  } else {
    expect(recovered[1].captureDependencies).toEqual([before[0].id]);
    expect(recovered[1].dependencies).toEqual([recovered[rootIndex].id]);
    expect(recovered[1].settlement).toBe("cancelled");
    expect(recovered[1].attempts).toBe(1);
    if (action !== "create")
      expect(recovered[1].recordRecovery).toEqual({
        targetId: separateTarget,
        destination: "separate",
      });
    expect(
      (await rows()).rows.every((r) => r.version === 1 && !r.archived),
    ).toBe(true);
    await options.offline(true);
    page = await options.restartOffline();
    expect((await read()).journal).toEqual(recovered);
    await options.reconnect();
    await page.getByRole("link", { name, exact: true }).click();
    const group = page.getByRole("group", {
      name: new RegExp(`^Pending ${action}:`),
    });
    await group
      .getByRole("button", {
        name: priorDraft ? "Resume review" : "Review",
        exact: true,
      })
      .click();
    let review = page.getByRole("dialog");
    await expect(review).toContainText(`Original record: ${originalTarget}`);
    await expect(review).toContainText(`Separate record: ${separateTarget}`);
    if (action === "archive") {
      await expect(review).toContainText("Separate recovered record");
    } else {
      if (action === "update") {
        await selectValue(page, "Use value for name", "local");
      }
      if (priorDraft)
        await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
          "Preserved before parent recovery",
        );
      await review
        .getByLabel("Name", { exact: true })
        .fill("Reviewed resource change");
      if (action === "create")
        await selectValue(page, "Parent Id", separateTarget);
      // Editing saves the review independently; the exact original call stays unchanged.
      await expect
        .poll(
          async () =>
            Object.values((await read()).draftReviews ?? {}).find(
              (saved) => saved.entryId === original.id,
            )?.createRecovery,
        )
        .toEqual(recovered[1].createRecovery);
      await expect
        .poll(async () =>
          Object.values((await read()).drafts).some(
            (draft) => draft.name === "Reviewed resource change",
          ),
        )
        .toBe(true);
      await review
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await options.offline(true);
      page = await options.restartOffline();
      await page.getByRole("link", { name, exact: true }).click();
      await page
        .getByRole("group", { name: new RegExp(`^Pending ${action}:`) })
        .getByRole("button", { name: "Resume review", exact: true })
        .click();
      review = page.getByRole("dialog");
      await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
        "Reviewed resource change",
      );
      await capture("saved-review");
      await review
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await options.reconnect();
      await page.getByRole("link", { name, exact: true }).click();
      await page
        .getByRole("group", { name: new RegExp(`^Pending ${action}:`) })
        .getByRole("button", { name: "Resume review", exact: true })
        .click();
      review = page.getByRole("dialog");
    }
    await capture("review");
    await options.narrow();
    expect(
      await review.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode(options.kind === "native")
          .include('[role="dialog"]')
          .analyze()
      ).violations,
    ).toEqual([]);
    await capture("review-narrow");
    await options.wide();
    await review
      .getByRole("button", {
        name: action === "archive" ? "Confirm reviewed archive" : "Save",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
    await expect
      .poll(async () => (await read()).journal[correctedIndex]?.state)
      .toBe("accepted");
    const final = (await read()).journal;
    expect(final[1].call).toEqual(original.call);
    expect(final[1].supersededBy).toBe(final[correctedIndex].id);
    const cancelled = await retry(original);
    expect(cancelled.status()).toBe(409);
    expect(await cancelled.json()).toMatchObject({ code: "ATTEMPT_CANCELLED" });
    const accepted = await retry(final[correctedIndex]);
    expect(accepted.status()).toBe(200);
    expect(await accepted.json()).toEqual(final[correctedIndex].result);
  }
  const data = (await rows()).rows;
  const originalData = data.find((row) => row.id === originalTarget)!;
  const separateData = data.find((row) => row.id === separateTarget)!;
  expect(data).toHaveLength(repeated ? 5 : action === "create" ? 4 : 3);
  if (acceptedSibling) {
    expect(
      (await read()).journal.find((entry) => entry.id === acceptedSibling!.id),
    ).toEqual(acceptedSibling);
    expect(
      data.find(
        (row) => row.id === (acceptedSibling!.call.input as { id: string }).id,
      ),
    ).toMatchObject({
      data: { name: "Accepted sibling", parentId: originalTarget },
      version: 1,
      archived: false,
    });
    const reply = await retry(acceptedSibling);
    expect(reply.status()).toBe(200);
    expect(await reply.json()).toEqual(acceptedSibling.result);
  }
  if (competingTarget)
    expect(data.find((row) => row.id === competingTarget)).toMatchObject({
      data: { name: "Competing separate record" },
      version: 1,
      archived: false,
    });
  if (outcome === "accepted") {
    expect(separateData).toMatchObject({
      data: { name: "Separate recovered record" },
      version: 1,
      archived: false,
    });
    if (action === "create")
      expect(
        data.find(
          (row) => row.id === (original.call.input as { id: string }).id,
        ),
      ).toMatchObject({
        data: { name: "Linked resource change", parentId: originalTarget },
        version: 1,
      });
    else
      expect(originalData).toMatchObject({
        version: 2,
        archived: action === "archive",
        data: {
          name:
            action === "update"
              ? "Linked resource change"
              : "Existing corporate record",
        },
      });
  } else {
    expect(originalData).toMatchObject({
      data: { name: "Existing corporate record" },
      version: 1,
      archived: false,
    });
    if (action === "create")
      expect(
        data.find(
          (row) => row.id === (original.call.input as { id: string }).id,
        ),
      ).toMatchObject({
        data: { name: "Reviewed resource change", parentId: separateTarget },
        version: 1,
      });
    else
      expect(separateData).toMatchObject({
        version: 2,
        archived: action === "archive",
        data: {
          name:
            action === "update"
              ? "Reviewed resource change"
              : "Separate recovered record",
        },
      });
  }
  expect(
    (
      await pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
        [scope.workspaceId, `${id}.notes.${action}`],
      )
    ).rows[0].n,
  ).toBe(action === "create" ? 4 : 1);
  if (action === "archive")
    await page
      .getByRole("button", { name: "Show archived", exact: true })
      .click();
  await expect(
    page.getByRole("cell", {
      name:
        action === "archive"
          ? outcome === "accepted"
            ? "Existing corporate record"
            : "Separate recovered record"
          : outcome === "accepted"
            ? "Linked resource change"
            : "Reviewed resource change",
      exact: true,
    }),
  ).toBeVisible();
  await capture("accepted");
}
