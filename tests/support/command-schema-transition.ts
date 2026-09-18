import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import { publishExecutableFixture } from "./executable-fixture";

/** A second upgrade must preserve the first review until the user resolves removed fields. */
export async function commandSchemaTransition({
  options,
  page,
  id,
  fixtureName,
  scope,
  headers,
  originalVersion,
  reviewVersion,
  original,
  reviewInput,
}: {
  options: CommandCorrectionOptions;
  page: Page;
  id: string;
  fixtureName: string;
  scope: { userId: string; workspaceId: string };
  headers: Record<string, string>;
  originalVersion: string;
  reviewVersion: string;
  original: JournalEntry;
  reviewInput: unknown;
}) {
  const next = await publishExecutableFixture({
    id,
    name: fixtureName,
    sourceDirectory: "tests/fixtures/queued-notes",
    transform(file, source) {
      source = source.replaceAll(`${id}.capture`, `${id}.capture-next`);
      if (file === "module.ts")
        source = source.replace(
          "{ name: Type.String({ minLength: 1 }) },",
          "{ name: Type.String({ minLength: 1 }), explanation: Type.String({ minLength: 3 }), context: Type.Object({ retained: Type.String({ minLength: 1 }) }, { additionalProperties: false }) },",
        );
      if (file === "view.tsx")
        source = source.replace(
          "{ name },",
          '{ name, explanation: "New capture", context: { retained: "New context" } },',
        );
      if (file === "module-server.ts")
        source = source.replace(
          ".create(input)",
          ".create({ name: input.name })",
        );
      return source;
    },
  });
  const platformResponse = await options.api.get(
    `/api/v1/workspaces/${scope.workspaceId}/platform`,
  );
  expect(platformResponse.ok()).toBe(true);
  const platform = (await platformResponse.json()) as {
    settings: { key: string; version: number }[];
  };
  const pin = platform.settings.find((setting) => setting.key === `pin:${id}`);
  expect(pin).toBeDefined();
  const rollout = await options.api.post(
    `/api/v1/workspaces/${scope.workspaceId}/platform`,
    {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: {
        action: "rollout",
        version: pin!.version,
        value: {
          moduleId: id,
          version: next.version,
          mandatory: false,
          acceptedVersions: [originalVersion, reviewVersion],
        },
      },
    },
  );
  expect(rollout.ok(), await rollout.text()).toBe(true);
  await page.reload();
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  const card = page.locator(".module-install-card").filter({
    has: page.getByRole("heading", { name: fixtureName, exact: true }),
  });
  await expect(card).toContainText(`Version ${next.version}`);
  const update = card.getByRole("button", { name: "Update", exact: true });
  if (await update.isVisible()) await update.click();
  await expect(card).toContainText(`Installed ${next.version}`);
  const state = () => options.storage(page, scope);
  const openReview = async () => {
    await page.getByRole("link", { name: fixtureName, exact: true }).click();
    await page.getByRole("button", { name: /^Saved commands/ }).click();
    await page
      .getByRole("dialog", { name: "Saved commands", exact: true })
      .getByRole("button", { name: "Resume command review", exact: true })
      .click();
    return page.getByRole("dialog", {
      name: "Review saved command",
      exact: true,
    });
  };
  let review = await openReview();
  await options.offline(true);
  page = await options.restartOffline();
  review = await openReview();
  const saved = (await state()).commandReviews?.[original.id];
  expect(saved).toMatchObject({
    source: original.call,
    moduleVersion: reviewVersion,
    input: reviewInput,
  });
  await expect(review).toContainText("The installed release changed");
  await expect(review.getByLabel("Retained", { exact: true })).toHaveValue(
    "Keep this field",
  );
  await review.getByText("Saved review input", { exact: true }).click();
  const savedDetails = review.locator("details").filter({
    has: page.locator("summary", { hasText: /^Saved review input$/ }),
  });
  await expect(savedDetails).toContainText(
    `Saved against release ${reviewVersion}`,
  );
  await expect(savedDetails).toContainText("Reviewed after upgrade");
  await expect(savedDetails).toContainText("Keep until reviewed");
  // This action did not exist before the correction: the stale value was hidden and blocked validation.
  const removeReason = () =>
    review.getByRole("button", {
      name: "Remove Reason from draft",
      exact: true,
    });
  const removeLegacy = () =>
    review.getByRole("button", {
      name: "Remove Legacy from draft",
      exact: true,
    });
  await expect(removeReason()).toBeVisible();
  await expect(removeLegacy()).toBeVisible();
  await review
    .getByLabel("Explanation", { exact: true })
    .fill("Reviewed against latest release");
  await expect(review.getByRole("alert")).toContainText("/input/reason");
  await expect(review.getByRole("alert")).toContainText(
    "/input/context/legacy",
  );
  await removeLegacy().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/command-schema-review/${options.kind}-removed-fields.png`,
  });
  await options.narrow();
  await removeLegacy().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/command-schema-review/${options.kind}-removed-fields-narrow.png`,
  });
  expect(await review.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await removeReason().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/command-schema-review/${options.kind}-removed-root-field-narrow.png`,
  });
  await options.wide();
  await removeReason().click();
  await expect(review.getByRole("alert")).not.toContainText("/input/reason");
  await expect(review.getByRole("alert")).toContainText(
    "/input/context/legacy",
  );
  await removeLegacy().focus();
  await page.keyboard.press("Enter");
  await expect(review.getByRole("alert")).toHaveCount(0);
  await review
    .getByLabel("Explanation", { exact: true })
    .fill("Reviewed against latest release");
  // Editing is not saving: closing and restarting restores the previous complete review.
  expect((await state()).commandReviews?.[original.id]).toEqual(saved);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  page = await options.restartOffline();
  review = await openReview();
  await expect(removeReason()).toBeVisible();
  await expect(removeLegacy()).toBeVisible();
  await expect(review.getByLabel("Explanation", { exact: true })).toHaveValue(
    "",
  );
  await removeReason().click();
  await removeLegacy().click();
  await review
    .getByLabel("Explanation", { exact: true })
    .fill("Reviewed against latest release");
  const input = {
    name: "Corrected parent",
    explanation: "Reviewed against latest release",
    context: { retained: "Keep this field" },
  };
  await review
    .getByRole("button", { name: "Save review", exact: true })
    .click();
  await expect(review).toContainText("Review saved on this device.");
  expect((await state()).commandReviews?.[original.id]).toMatchObject({
    source: original.call,
    moduleVersion: next.version,
    input,
  });
  expect(
    (await state()).journal.find((entry) => entry.id === original.id)?.call,
  ).toEqual(original.call);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  page = await options.restartOffline();
  review = await openReview();
  await expect(removeReason()).toHaveCount(0);
  await expect(removeLegacy()).toHaveCount(0);
  await expect(review.getByLabel("Explanation", { exact: true })).toHaveValue(
    input.explanation,
  );
  await expect(review.getByLabel("Retained", { exact: true })).toHaveValue(
    input.context.retained,
  );
  expect((await state()).commandReviews?.[original.id]?.input).toEqual(input);
  expect((await state()).journal).toHaveLength(3);
  expect(
    (
      await options.pool.query(
        "select count(*)::int n from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, id],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/command-schema-review/${options.kind}-latest-review.png`,
  });
  await options.narrow();
  await page.screenshot({
    path: `docs/verification/command-schema-review/${options.kind}-latest-review-narrow.png`,
  });
  await options.wide();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  return { page, input };
}
