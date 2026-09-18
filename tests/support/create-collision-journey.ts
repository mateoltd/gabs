import { hostReviewRecovery } from "./host-review-recovery";
import { expect, type Page, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import type { Pool } from "pg";
import type { ModuleStorage } from "../../packages/client/src/modules/storage";
import { selectValue } from "../e2e/controls.helpers";

export async function createCollisionJourney(options: {
  page: Page;
  api: APIRequestContext;
  pool: Pool;
  kind: "web" | "native";
  sameRecord?: boolean;
  archiveChosen?: boolean;
  ordinaryDrafts?: boolean;
  offline(value: boolean): Promise<void>;
  restart(offline?: boolean): Promise<Page>;
  narrow(): Promise<void>;
  wide(): Promise<void>;
  loseSettlementReply(): Promise<void>;
  storage(
    page: Page,
    scope: { userId: string; workspaceId: string },
  ): Promise<ModuleStorage>;
}) {
  let page = options.page;
  const { api, pool } = options;
  const me = await (await api.get("/api/v1/me")).json();
  const scope = { userId: me.user.id as string, workspaceId: randomUUID() };
  const created = await api.post("/api/v1/workspaces", {
    headers: {
      origin: "http://localhost:4300",
      "x-csrf-token": me.csrfToken,
      "idempotency-key": randomUUID(),
    },
    data: {
      id: scope.workspaceId,
      name: "Create collision acceptance",
      currency: "EUR",
    },
  });
  expect(created.ok(), await created.text()).toBe(true);
  await page.reload();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Enable on this device", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Disable offline storage", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New projects", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New contacts", exact: true }),
  ).toBeVisible();
  if (options.kind === "web")
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  await options.offline(true);
  const save = async () => {
    await page
      .getByRole("button", { name: "Save pending change", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await page.getByRole("button", { name: "New contacts", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Collision contact");
  await selectValue(page, "Kind", "person");
  await selectValue(page, "Relationship", "customer");
  await save();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page.getByRole("button", { name: "New notes", exact: true }).click();
  await page.getByRole("combobox", { name: "Contact Id", exact: true }).click();
  await page
    .getByRole("option", { name: "Collision contact (pending)", exact: true })
    .click();
  await page.getByLabel("Text", { exact: true }).fill("Dependent note");
  await save();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Independent project");
  await selectValue(page, "Status", "planned");
  await save();
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  const captured = (await options.storage(page, scope)).journal;
  expect(captured).toHaveLength(3);
  expect(captured[1].dependencies).toEqual([captured[0].id]);
  expect(captured.every((e) => e.delivery === "unsubmitted")).toBe(true);

  const journal = async () => (await options.storage(page, scope)).journal;
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
    "x-module-version": captured[0].call.moduleVersion!,
  };
  const originalId = (captured[0].call.input as { id: string }).id;
  // A different authenticated session claims the identity while this client is offline.
  const collision = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "create",
        resource: "contacts",
        input: {
          id: originalId,
          data: {
            name: "Existing corporate record",
            kind: "organization",
            relationship: "supplier",
          },
        },
      },
    },
  );
  expect(collision.ok(), await collision.text()).toBe(true);
  const existing = await collision.json();
  await options.offline(false);
  await expect
    .poll(async () => (await journal()).map((e) => e.state))
    .toEqual(["conflict", "pending", "accepted"]);
  expect((await journal())[0].errorCode).toBe("RECORD_EXISTS");
  if (options.sameRecord) {
    await expect(
      page.getByRole("cell", {
        name: "Existing corporate record",
        exact: true,
      }),
    ).toBeVisible();
    await options.offline(true);
    for (const phone of ["222", "333"]) {
      await page
        .getByRole("row")
        .filter({
          has: page.getByRole("cell", {
            name: "Existing corporate record",
            exact: true,
          }),
        })
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await page.getByLabel("Phone", { exact: true }).fill(phone);
      await save();
    }
    await options.offline(false);
  }
  if (options.ordinaryDrafts) {
    await expect(
      page.getByRole("cell", {
        name: "Existing corporate record",
        exact: true,
      }),
    ).toBeVisible();
    await options.offline(true);
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("cell", {
          name: "Existing corporate record",
          exact: true,
        }),
      })
      .getByRole("button", { name: "Edit", exact: true })
      .click();
    await page.getByLabel("Phone", { exact: true }).fill("444");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page.getByRole("button", { name: "New notes", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Contact Id", exact: true })
      .click();
    await page
      .getByRole("option", {
        name: "Collision contact (needs review)",
        exact: true,
      })
      .click();
    await page.getByLabel("Text", { exact: true }).fill("Unqueued linked note");
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { name: "Contacts", exact: true }).click();
    await options.offline(false);
    const drafts = await options.storage(page, scope);
    expect(drafts.drafts["contacts/contacts"].phone).toBe("444");
    expect(drafts.drafts["contacts/notes"]).toEqual({
      contactId: originalId,
      text: "Unqueued linked note",
    });
    expect(drafts.draftVersions?.["contacts/notes"]).toBe(
      captured[0].call.moduleVersion,
    );
    expect(drafts.journal).toHaveLength(3);
  }
  const laterEdits = (await journal()).slice(3);
  if (options.sameRecord)
    expect(laterEdits.map((entry) => entry.dependencies)).toEqual([
      [captured[0].id],
      [laterEdits[0].id],
    ]);
  await page
    .getByRole("group", {
      name: "Pending create: Collision contact",
      exact: true,
    })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Failed create recovery" }),
  ).toContainText("already exists");
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Recovered separate contact");
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog).toContainText("Existing server records stay unchanged");
  await expect(dialog).toHaveClass(/is-open/);
  await expect(dialog).toHaveCSS("opacity", "1");
  const evidence = `docs/verification/${options.ordinaryDrafts ? "collision-drafts" : options.sameRecord ? "collision-edits" : "create-collisions"}`;
  const chooseTargets = async () => {
    if (options.ordinaryDrafts) {
      await expect(
        dialog.getByRole("button", {
          name: "Check and create separate record",
          exact: true,
        }),
      ).toBeDisabled();
      await selectValue(page, "Record for saved draft 1", "separate");
      await selectValue(page, "Record for saved draft 2", "existing");
      const disclosure = dialog
        .getByText("View saved draft", { exact: true })
        .first();
      await disclosure.focus();
      await page.keyboard.press("Enter");
      await expect(dialog).toContainText("This draft has not been submitted.");
      await expect(dialog).toContainText("444");
      await page.keyboard.press("Enter");
    }
    if (!options.sameRecord) return;
    await expect(
      dialog.getByRole("button", {
        name: "Check and create separate record",
        exact: true,
      }),
    ).toBeDisabled();
    await selectValue(page, "Record for later edit 1", "separate");
    await selectValue(page, "Record for later edit 2", "existing");
  };
  await chooseTargets();
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: `${evidence}/${options.kind}-confirmation.png`,
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
    path: `${evidence}/${options.kind}-confirmation-narrow.png`,
  });
  await options.wide();
  // Escape returns to the preserved input rather than leaving stacked editors.
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered separate contact",
  );
  const action = page.getByRole("button", {
    name: "Create separate record",
    exact: true,
  });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await chooseTargets();
  await options.loseSettlementReply();
  await dialog
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect
    .poll(
      async () =>
        (
          await pool.query(
            "select outcome from suite.idempotency where workspace_id=$1 and key=$2",
            [scope.workspaceId, captured[0].id],
          )
        ).rows[0]?.outcome,
    )
    .toBe("cancelled");
  await expect(
    dialog.getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    }),
  ).toBeEnabled();
  expect((await journal()).map((e) => e.state)).toEqual([
    "conflict",
    "pending",
    "accepted",
    ...(options.sameRecord ? ["pending", "pending"] : []),
  ]);
  page = await options.restart();
  await selectValue(page, "Workspace", scope.workspaceId);
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("link", { name: "Contacts", exact: true })
    .click();
  await options.offline(true);
  await page
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Recovered separate contact",
  );
  await expect(
    page.getByRole("button", { name: "Create separate record", exact: true }),
  ).toBeDisabled();
  await options.offline(false);
  await page
    .getByRole("button", { name: "Create separate record", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await chooseTargets();
  await dialog
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  // Retain dialog errors in native failures, whose trace has no DOM snapshot.
  await expect
    .poll(() => page.getByRole("dialog").allTextContents())
    .toEqual([]);
  await expect
    .poll(
      async () =>
        (await journal()).filter((e) => !e.supersededBy).map((e) => e.state),
      { timeout: 45000 },
    )
    .toEqual([
      "accepted",
      "accepted",
      "accepted",
      ...(options.sameRecord ? ["conflict", "conflict"] : []),
    ]);
  const final = await journal();
  expect(final).toHaveLength(options.sameRecord ? 9 : 5);
  const parent = final.find((e) => e.id === final[0].supersededBy)!;
  const child = final.find((e) => e.id === final[1].supersededBy)!;
  const newId = (parent.call.input as { id: string }).id;
  expect(newId).not.toBe(originalId);
  expect(final[0].call).toEqual(captured[0].call);
  expect(final[1].call).toEqual(captured[1].call);
  expect(child.call.input).toEqual({
    ...(captured[1].call.input as object),
    data: { contactId: newId, text: "Dependent note" },
  });
  expect(child.dependencies).toEqual([parent.id]);
  const records = (
    await pool.query(
      "select id,module_id,resource,data,version from suite.module_records where workspace_id=$1",
      [scope.workspaceId],
    )
  ).rows;
  expect(records).toHaveLength(4);
  expect(records.find((r) => r.id === originalId)).toMatchObject({
    data: existing.data,
    version: existing.version,
  });
  expect(records.find((r) => r.id === newId).data.name).toBe(
    "Recovered separate contact",
  );
  expect(records.find((r) => r.resource === "notes").data.contactId).toBe(
    newId,
  );
  if (options.sameRecord) {
    const recoveries = laterEdits.map((prior) =>
      final.find(
        (entry) =>
          entry.id === final.find((old) => old.id === prior.id)!.supersededBy,
      )!,
    );
    expect(recoveries.map((entry) => entry.recordRecovery?.targetId)).toEqual([
      newId,
      originalId,
    ]);
    expect(recoveries.map((entry) => entry.call.input)).toEqual(
      laterEdits.map((entry) => entry.call.input),
    );
    expect(records.find((record) => record.id === newId).version).toBe(1);
    // Restart after target choices were committed. They must not become automatic effects.
    page = await options.restart();
    await selectValue(page, "Workspace", scope.workspaceId);
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
    const edits = () =>
      page.getByRole("group", {
        name: "Pending update: Existing corporate record",
        exact: true,
      });
    await expect(edits()).toHaveCount(2);
    if (options.archiveChosen) {
      const archived = await api.post(
        `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
        {
          headers: { ...headers, "idempotency-key": randomUUID() },
          data: {
            resource: "contacts",
            action: "archive",
            input: { id: newId, baseVersion: 1 },
          },
        },
      );
      expect(archived.ok(), await archived.text()).toBe(true);
      await edits()
        .first()
        .getByRole("button", { name: "Review", exact: true })
        .click();
      const archivedReview = page.getByRole("dialog", {
        name: "Recover input",
        exact: true,
      });
      await expect(
        archivedReview.getByRole("region", {
          name: "Archived input",
          exact: true,
        }),
      ).toContainText("222");
      await expect(
        archivedReview.getByRole("button", { name: "Save", exact: true }),
      ).toHaveCount(0);
      const downloaded = page.waitForEvent("download");
      await archivedReview
        .getByRole("button", { name: "Export input", exact: true })
        .click();
      const file = await downloaded;
      const recovered = JSON.parse(
        await readFile((await file.path())!, "utf8"),
      );
      expect(recovered.input).toEqual({
        id: originalId,
        baseVersion: existing.version,
        data: (laterEdits[0].call.input as { data: unknown }).data,
      });
      expect(
        (
          await pool.query(
            "select data,version from suite.module_records where workspace_id=$1 and id=$2",
            [scope.workspaceId, originalId],
          )
        ).rows[0],
      ).toEqual({ data: existing.data, version: existing.version });
      expect(
        (await journal())
          .filter(
            (entry) => !entry.supersededBy && entry.call.action === "update",
          )
          .map((entry) => entry.state),
      ).toEqual(["conflict", "conflict"]);
      await page.screenshot({
        path: `${evidence}/${options.kind}-archived-target.png`,
      });
      return;
    }
    await expect(
      edits().nth(1).getByRole("button", { name: "Review", exact: true }),
    ).toBeDisabled();
    for (let i = 0; i < 2; i++) {
      await expect(edits().first()).toContainText(
        i === 0 ? "separate record" : "existing corporate record",
      );
      await edits()
        .first()
        .getByRole("button", { name: "Review", exact: true })
        .click();
      const review = page.getByRole("dialog", {
        name: "Edit record",
        exact: true,
      });
      await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
        i === 0 ? "Recovered separate contact" : "Existing corporate record",
      );
      await expect(review.getByLabel("Phone", { exact: true })).toHaveValue(
        i === 0 ? "222" : "333",
      );
      if (i === 0) {
        await options.offline(true);
        await page.keyboard.press("Escape");
        await edits()
          .first()
          .getByRole("button", { name: "Resume review", exact: true })
          .click();
        await expect(review.getByLabel("Phone", { exact: true })).toHaveValue(
          "222",
        );
        await options.offline(false);
      }
      await review.getByRole("button", { name: "Save", exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(edits()).toHaveCount(1 - i);
    }
    const reviewed = (await journal()).filter(
      (entry) => entry.call.action === "update" && entry.state === "accepted",
    );
    expect(reviewed).toHaveLength(2);
    for (const [id, phone] of [
      [newId, "222"],
      [originalId, "333"],
    ]) {
      expect(
        (
          await pool.query(
            "select data,version from suite.module_records where workspace_id=$1 and id=$2",
            [scope.workspaceId, id],
          )
        ).rows[0],
      ).toMatchObject({ version: 2, data: { phone } });
    }
    expect(
      (
        await pool.query(
          "select count(*)::int as n from suite.audit where workspace_id=$1 and action='contacts.contacts.update'",
          [scope.workspaceId],
        )
      ).rows[0].n,
    ).toBe(2);
  }
  if (options.ordinaryDrafts) {
    const state = await options.storage(page, scope);
    const reviews = Object.entries(state.draftReviews ?? {}).filter(
      ([, review]) => !!review.collision,
    );
    expect(reviews).toHaveLength(2);
    expect(state.drafts["contacts/contacts"]).toBeUndefined();
    expect(state.drafts["contacts/notes"]).toBeUndefined();
    expect(state.journal).toHaveLength(5);
    expect(
      reviews.find(([key]) => key.startsWith("contacts/contacts/"))![1]
        .collision,
    ).toMatchObject({
      targetId: newId,
      sourceTarget: { id: originalId },
      sourceData: { phone: "444" },
    });
    expect(
      state.drafts[
        reviews.find(([key]) => key.startsWith("contacts/notes/"))![0]
      ],
    ).toEqual({ contactId: originalId, text: "Unqueued linked note" });
    page = await hostReviewRecovery({
      ...options,
      page,
      scope,
      moduleId: "contacts",
      moduleName: "Contacts",
      scenario: "collision-reviews",
      restartOffline: () => options.restart(true),
      reconnect: () => options.restart(),
      inspect: async (dialog) => {
        for (const title of ["Contacts: saved review", "Notes: saved review"])
          await expect(
            dialog.getByRole("heading", { name: title, exact: true }),
          ).toBeVisible();
        for (const value of [
          "444",
          "Unqueued linked note",
          originalId,
          newId,
          parent.id,
        ])
          await expect(dialog).toContainText(value);
        await expect(dialog).toContainText(
          "Review the selected target before submitting this draft.",
        );
        const note = dialog.locator("li").filter({
          has: dialog.page().getByRole("heading", {
            name: "Notes: saved review",
            exact: true,
          }),
        });
        await expect(note).toContainText(
          "Review this reassigned draft before submitting it.",
        );
        await expect(note).not.toContainText("Review the selected target");
      },
    });
    page = await options.restart();
    await selectValue(page, "Workspace", scope.workspaceId);
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: "Contacts", exact: true })
      .click();
    await page
      .getByRole("group", {
        name: "Saved review: Existing corporate record",
        exact: true,
      })
      .getByRole("button", { name: "Resume review", exact: true })
      .click();
    const edit = page.getByRole("dialog", { name: "Edit record", exact: true });
    await expect(edit.getByLabel("Name", { exact: true })).toHaveValue(
      "Recovered separate contact",
    );
    await expect(edit.getByLabel("Phone", { exact: true })).toHaveValue("444");
    await options.offline(true);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Resume review", exact: true })
      .click();
    await expect(edit.getByLabel("Phone", { exact: true })).toHaveValue("444");
    await options.offline(false);
    await edit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(edit).toHaveCount(0);
    await page.getByRole("tab", { name: "Notes", exact: true }).click();
    await page
      .getByRole("button", { name: "Resume review", exact: true })
      .click();
    await expect(page.getByLabel("Text", { exact: true })).toHaveValue(
      "Unqueued linked note",
    );
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(async () =>
        (await journal())
          .filter((entry) => !entry.supersededBy)
          .every((entry) => entry.state === "accepted"),
      )
      .toBe(true);
    expect(
      (
        await pool.query(
          "select data,version from suite.module_records where workspace_id=$1 and id=$2",
          [scope.workspaceId, newId],
        )
      ).rows[0],
    ).toMatchObject({
      version: 2,
      data: { name: "Recovered separate contact", phone: "444" },
    });
    expect(
      (
        await pool.query(
          "select data,version from suite.module_records where workspace_id=$1 and id=$2",
          [scope.workspaceId, originalId],
        )
      ).rows[0],
    ).toEqual({ data: existing.data, version: existing.version });
    expect(
      (
        await pool.query(
          "select data from suite.module_records where workspace_id=$1 and resource='notes' and data->>'text'='Unqueued linked note'",
          [scope.workspaceId],
        )
      ).rows[0].data.contactId,
    ).toBe(originalId);
    expect(
      (
        await pool.query(
          "select count(*)::int as n from suite.audit where workspace_id=$1 and action='contacts.contacts.update'",
          [scope.workspaceId],
        )
      ).rows[0].n,
    ).toBe(1);
    await page.getByRole("tab", { name: "Contacts", exact: true }).click();
  }
  const late = await api.post(
    `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
    {
      headers: { ...headers, "idempotency-key": captured[0].id },
      data: {
        action: "create",
        resource: "contacts",
        input: captured[0].call.input,
      },
    },
  );
  expect(late.status()).toBe(409);
  expect((await late.json()).code).toBe("ATTEMPT_CANCELLED");
  // Repeating both replacement requests returns their receipts without additional effects.
  for (const entry of [parent, child]) {
    const retry = await api.post(
      `/api/v1/module/contacts/workspaces/${scope.workspaceId}/records`,
      {
        headers: { ...headers, "idempotency-key": entry.id },
        data: {
          action: entry.call.action,
          resource: entry.call.resource,
          input: entry.call.input,
        },
      },
    );
    expect(retry.ok(), await retry.text()).toBe(true);
  }
  expect(
    (
      await pool.query(
        "select action,count(*)::int as n from suite.audit where workspace_id=$1 and action in ('contacts.contacts.create','contacts.notes.create','projects.projects.create','module.attempt.cancel') group by action order by action",
        [scope.workspaceId],
      )
    ).rows,
  ).toEqual([
    { action: "contacts.contacts.create", n: 2 },
    { action: "contacts.notes.create", n: options.ordinaryDrafts ? 2 : 1 },
    { action: "module.attempt.cancel", n: 1 },
    { action: "projects.projects.create", n: 1 },
  ]);
  await expect(
    page.getByRole("cell", { name: "Recovered separate contact", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/${options.kind}-recovered.png`,
  });
  await options.narrow();
  await page.screenshot({
    path: `${evidence}/${options.kind}-recovered-narrow.png`,
  });
}
