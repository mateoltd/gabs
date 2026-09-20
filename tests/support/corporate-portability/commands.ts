import { expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { assertSchema } from "@suite/module-sdk";
import { SavedWorkRecoverySchema } from "@suite/module-sdk/platform";
import { selectValue } from "../../e2e/controls.helpers";
import type { corporatePortability } from "./journey";
import { commandWorkspace } from "./command-workspace";
import { portabilityStorage } from "./devices";

export async function corporateCommandPortability(
  options: Parameters<typeof corporatePortability>[0] & { pool: Pool },
) {
  let page = options.source;
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { workspaceId, userId, headers, modules } = await commandWorkspace(
    options.api,
    options.pool,
  );
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const enable = async () => {
    await page.reload();
    await selectValue(page, "Workspace", workspaceId);
    await settings();
    await page
      .getByRole("button", { name: "Enable on this device", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Disable offline storage",
        exact: true,
      }),
    ).toBeVisible();
  };
  const open = async (index: number) => {
    await page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("link", { name: modules[index].name, exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Save pending note", exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          !!(await portabilityStorage(page, { userId, workspaceId }))
            ?.installed[modules[index].id]?.version,
      )
      .toBe(true);
  };
  const inbox = async () => {
    await page.getByRole("button", { name: /^Saved commands/ }).click();
    return page.getByRole("dialog", { name: "Saved commands", exact: true });
  };
  const recoveryInbox = async (index: number) => {
    await settings();
    await page
      .getByRole("region", {
        name: `${modules[index].name} saved work`,
        exact: true,
      })
      .getByRole("button", { name: /^Saved commands/ })
      .click();
    return page.getByRole("dialog", { name: "Saved commands", exact: true });
  };
  const close = async (dialog: Locator) => {
    await dialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
  };
  const exportRequest = async (button: Locator, filename: string) => {
    const path = resolve(options.directory, filename);
    await options.exportFile(button, path);
    const bytes = await readFile(path);
    const input: unknown = JSON.parse(bytes.toString());
    assertSchema(SavedWorkRecoverySchema, input);
    if (input.selection !== "request")
      throw Error("Expected an actual saved request export.");
    return { input, bytes, path };
  };
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
  await enable();
  for (const index of [1, 0]) await open(index);
  await options.offline(true);
  await capture("Reject this note");
  let list = await recoveryInbox(0);
  const original = await exportRequest(
    list.getByRole("button", { name: "Export saved request", exact: true }),
    "parent-before-review.json",
  );
  await close(list);
  await open(1);
  await page
    .getByLabel("Prerequisite identity", { exact: true })
    .fill(original.input.entry.id);
  await capture("Selected imported child", true);
  await capture("Unselected imported child", true);
  await options.offline(false);
  await open(0);
  list = await inbox();
  await list
    .getByRole("button", { name: "Review command", exact: true })
    .click();
  let review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await review
    .getByLabel("Name", { exact: true })
    .fill("Corrected imported parent");
  await review
    .getByRole("checkbox", { name: "Continue Save note", exact: true })
    .first()
    .check();
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review.getByRole("status")).toHaveText(
    "Review saved on this device.",
  );
  await close(review);
  await close(list);
  await options.offline(true);
  list = await recoveryInbox(0);
  const parent = await exportRequest(
    list.getByRole("button", { name: "Export saved request", exact: true }),
    "parent.json",
  );
  expect(parent.input.review?.continuations).toHaveLength(1);
  await close(list);
  list = await recoveryInbox(1);
  const selected = await exportRequest(
    list
      .getByRole("button", { name: "Export saved request", exact: true })
      .nth(0),
    "selected.json",
  );
  const unselected = await exportRequest(
    list
      .getByRole("button", { name: "Export saved request", exact: true })
      .nth(1),
    "unselected.json",
  );
  expect(selected.input.entry.call.input).toEqual({
    name: "Selected imported child",
  });
  expect(selected.input.entry.dependencies).toEqual([parent.input.entry.id]);
  expect(unselected.input.entry.dependencies).toEqual([parent.input.entry.id]);

  page = await options.replaceDevice();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enable();
  let restoredCount = 0;
  const restore = async (file: typeof parent) => {
    await settings();
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    const imported = page.getByRole("dialog", {
      name: "Imported saved work",
      exact: true,
    });
    await expect(
      imported.getByLabel("Saved-work recovery file", { exact: true }),
    ).toBeEnabled();
    await imported
      .getByLabel("Saved-work recovery file", { exact: true })
      .setInputFiles(file.path);
    await imported
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await imported
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(
      imported.getByText(
        "Restored. The imported copy is retained separately.",
        { exact: true },
      ),
    ).toHaveCount(++restoredCount);
    await close(imported);
  };
  // Recover the child first: an absent parent never makes it executable.
  await restore(selected);
  list = await recoveryInbox(1);
  await expect(list).toContainText(
    "The server stopped retries of this original request.",
  );
  const held = await exportRequest(
    list.getByRole("button", { name: "Export saved request", exact: true }),
    "held-child.json",
  );
  expect(held.input.entry).toMatchObject({
    id: selected.input.entry.id,
    state: "rejected",
    settlement: "cancelled",
    dependencies: [parent.input.entry.id],
  });
  await close(list);
  await restore(unselected);
  await restore(parent);
  for (const index of [1, 0]) await open(index);
  list = await inbox();
  await list
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
    "Corrected imported parent",
  );
  const choices = review.getByRole("checkbox", {
    name: "Continue Save note",
    exact: true,
  });
  await expect(choices).toHaveCount(2);
  await expect(choices.nth(0)).not.toBeChecked();
  await expect(choices.nth(1)).not.toBeChecked();
  await expect(
    review.getByText(
      "This change will keep waiting for its own explicit review. Selecting it updates its prerequisite without submitting it.",
      { exact: true },
    ),
  ).toHaveCount(2);
  await choices.first().focus();
  await page.keyboard.press("Space");
  await expect(choices.first()).toBeChecked();
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review.getByRole("status")).toHaveText(
    "Review saved on this device.",
  );
  await close(review);
  await close(list);
  await page.reload();
  await open(0);
  list = await inbox();
  await list
    .getByRole("button", { name: "Resume command review", exact: true })
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(
    review
      .getByRole("checkbox", { name: "Continue Save note", exact: true })
      .nth(0),
  ).toBeChecked();
  await expect(
    review
      .getByRole("checkbox", { name: "Continue Save note", exact: true })
      .nth(1),
  ).not.toBeChecked();
  const evidence = resolve("docs/verification/imported-command-dependencies");
  await mkdir(evidence, { recursive: true });
  const name = options.evidenceName ?? "native";
  await review.getByRole("checkbox").first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidence, `${name}-review.png`),
    animations: "disabled",
  });
  const native = await page.evaluate(() => Boolean(window.suiteDesktop));
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(native)
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await review
    .getByRole("button", { name: "Prepare corrected command", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidence, `${name}-narrow.png`),
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize(viewport);
  const submitCorrection = async (stopped = false) => {
    await review
      .getByRole("button", { name: "Prepare corrected command", exact: true })
      .click();
    if (stopped)
      await expect(
        page.getByRole("dialog", {
          name: "Submit corrected command",
          exact: true,
        }),
      ).toContainText("Selected stopped requests remain stopped.");
    await page
      .getByRole("dialog", { name: "Submit corrected command", exact: true })
      .getByRole("button", {
        name: "Resolve original and save correction",
        exact: true,
      })
      .click();
    await expect(review).toHaveCount(0);
  };
  await submitCorrection(true);
  await expect(list.getByText("Accepted", { exact: true })).toBeVisible();
  await close(list);
  list = await recoveryInbox(0);
  const correctedParent = await exportRequest(
    list.getByRole("button", { name: "Export saved request", exact: true }),
    "corrected-parent.json",
  );
  expect(correctedParent.input.entry.call.input).toEqual({
    name: "Corrected imported parent",
  });
  await close(list);
  list = await recoveryInbox(1);
  const selectedAfter = await exportRequest(
    list
      .getByRole("button", { name: "Export saved request", exact: true })
      .nth(0),
    "selected-after.json",
  );
  const unselectedAfter = await exportRequest(
    list
      .getByRole("button", { name: "Export saved request", exact: true })
      .nth(1),
    "unselected-after.json",
  );
  expect(selectedAfter.input.entry).toMatchObject({
    id: selected.input.entry.id,
    call: selected.input.entry.call,
    state: "rejected",
    settlement: "cancelled",
    dependencies: [correctedParent.input.entry.id],
    captureDependencies: [parent.input.entry.id],
  });
  expect(unselectedAfter.input.entry).toMatchObject({
    id: unselected.input.entry.id,
    call: unselected.input.entry.call,
    state: "rejected",
    settlement: "cancelled",
    dependencies: [parent.input.entry.id],
  });
  const records = () =>
    options.pool.query(
      "select data->>'name' as name from suite.module_records where workspace_id=$1 order by name",
      [workspaceId],
    );
  expect((await records()).rows).toEqual([
    { name: "Corrected imported parent" },
  ]);
  await close(list);
  await open(1);
  list = await inbox();
  await list
    .getByRole("button", { name: "Review command", exact: true })
    .first()
    .click();
  review = page.getByRole("dialog", {
    name: "Review saved command",
    exact: true,
  });
  await expect(review.getByLabel("Name", { exact: true })).toHaveValue(
    "Selected imported child",
  );
  await review
    .getByLabel("Name", { exact: true })
    .fill("Corrected imported child");
  await submitCorrection();
  await expect(list.getByText("Accepted", { exact: true })).toBeVisible();
  await close(list);
  list = await recoveryInbox(1);
  const acceptedRow = list
    .getByRole("listitem")
    .filter({ has: page.getByText("Accepted", { exact: true }) });
  const correctedChild = await exportRequest(
    acceptedRow.getByRole("button", {
      name: "Export saved request",
      exact: true,
    }),
    "corrected-child.json",
  );
  expect(correctedChild.input.entry.dependencies).toEqual([
    correctedParent.input.entry.id,
  ]);
  for (const file of [
    parent,
    selected,
    unselected,
    correctedParent,
    correctedChild,
  ]) {
    const entry = file.input.entry;
    const response = await options.api.post(
      `/api/v1/module/${entry.call.moduleId}/workspaces/${workspaceId}/operations/capture`,
      {
        headers: {
          ...headers,
          "idempotency-key": entry.id,
          "x-module-version": entry.call.moduleVersion,
        },
        data: entry.call.input,
      },
    );
    if (file === correctedParent || file === correctedChild)
      expect(response.ok(), await response.text()).toBe(true);
    else {
      expect(response.status()).toBe(409);
      expect((await response.json()).code).toBe("ATTEMPT_CANCELLED");
    }
    expect(await readFile(file.path)).toEqual(file.bytes);
  }
  expect((await records()).rows).toEqual([
    { name: "Corrected imported child" },
    { name: "Corrected imported parent" },
  ]);
  expect(
    (
      await options.pool.query(
        "select count(*)::int n from suite.audit where workspace_id=$1 and action=any($2::text[])",
        [workspaceId, modules.map((m) => `${m.id}.notes.create`)],
      )
    ).rows[0].n,
  ).toBe(2);
}
