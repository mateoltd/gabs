import { expect, type Locator, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { canonical } from "@suite/module-sdk/registry";
import { selectValue } from "../../e2e/controls.helpers";
import { portabilityStorage } from "./devices";

export const snapshotName = "Second snapshot edit";

export async function exportNextSnapshot(options: {
  page: Page;
  moduleName: string;
  scope: { userId: string; workspaceId: string };
  navigate(name: string): Promise<void>;
  exportFile(button: Locator, path: string): Promise<void>;
  path: string;
}) {
  const { page } = options;
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await options.navigate(options.moduleName);
  await page
    .getByRole("group", { name: "Pending update: Recovered edit", exact: true })
    .getByRole("button", { name: "Resume review", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit record", exact: true });
  await editor.getByLabel("Name", { exact: true }).fill(snapshotName);
  await expect
    .poll(async () =>
      Object.values(
        (await portabilityStorage(page, options.scope)).drafts,
      ).some((draft) => draft.name === snapshotName),
    )
    .toBe(true);
  await editor
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await options.navigate("Settings");
  await page.getByRole("button", { name: /^Saved records and drafts/ }).click();
  await options.exportFile(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Export saved draft", exact: true }),
    options.path,
  );
  return { path: options.path, bytes: await readFile(options.path) };
}

type SnapshotSwitchMode =
  | {
      kind: "draft";
      recordChoice: "original" | "reassigned";
    }
  | {
      kind: "command";
      commandName: string;
    };

/** Switch exact UI-exported copies repeatedly, preserving each displaced local review. */
export async function switchSnapshots(
  options: {
    page: Page;
    scope: { userId: string; workspaceId: string };
    first: { path: string; bytes: Buffer };
    second: { path: string; bytes: Buffer };
    evidence: string;
    surface: string;
  } & SnapshotSwitchMode,
) {
  const { page } = options;
  const dialog = page.getByRole("dialog", {
    name: "Imported saved work",
    exact: true,
  });
  await dialog
    .getByLabel("Saved-work recovery file", { exact: true })
    .setInputFiles(options.second.path);
  await expect(dialog.getByRole("status")).toContainText("Copy imported");
  const digest = (bytes: Buffer) =>
    createHash("sha256")
      .update(canonical(JSON.parse(bytes.toString())))
      .digest("hex");
  const firstDigest = digest(options.first.bytes),
    secondDigest = digest(options.second.bytes);
  let retained: string | undefined;
  let previous = firstDigest;
  for (let index = 0; index < 3; index++) {
    const selected = index === 1 ? retained! : secondDigest;
    await dialog
      .locator(`[data-recovery-copy="${selected}"]`)
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    const confirm = dialog.getByRole("button", {
      name: "Confirm restoration",
      exact: true,
    });
    if (options.kind === "draft")
      await selectValue(page, "Record to review", options.recordChoice);
    await expect(confirm).toBeDisabled();
    await dialog.getByText("Compare saved input", { exact: true }).click();
    await expect(dialog).toContainText(
      options.kind === "command" ? "Linked effect" : "Draft reference edit",
    );
    await expect(dialog).toContainText(
      options.kind === "command" ? options.commandName : snapshotName,
    );
    const choice = dialog.getByRole("combobox", {
      name: "Existing review",
      exact: true,
    });
    await choice.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("option", {
        name: "Use imported copy",
        exact: true,
      })
      .focus();
    await page.keyboard.press("Enter");
    await expect(confirm).toBeEnabled();
    if (index === 0) {
      expect(
        (
          await new AxeBuilder({ page })
            .setLegacyMode(await page.evaluate(() => !!window.suiteDesktop))
            .include('[role="dialog"]')
            .withTags(["wcag2a", "wcag2aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await confirm.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(options.evidence, `${options.surface}-switch.png`),
        animations: "disabled",
      });
      const viewport = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      }));
      await page.setViewportSize({ width: 390, height: 844 });
      await choice.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(options.evidence, `${options.surface}-switch-narrow.png`),
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.setViewportSize(viewport);
    }
    await confirm.click();
    await expect(
      dialog.getByRole("button", {
        name: "Refresh imported copies",
        exact: true,
      }),
    ).toBeEnabled();
    const state = await portabilityStorage(page, options.scope);
    expect(
      state.recoveryImports![selected].promotion!.replacedAt,
    ).toBeUndefined();
    expect(
      state.recoveryImports![previous].promotion!.replacedAt,
    ).toBeDefined();
    previous = selected;
    expect(Object.keys(state.recoveryImports!).length).toBeGreaterThan(2);
    if (index === 0) {
      retained = Object.entries(state.recoveryImports!).find(
        ([key, copy]) =>
          key !== firstDigest &&
          key !== secondDigest &&
          (options.kind === "command"
            ? copy.input.selection === "request" &&
              (
                (copy.input.review?.input ??
                  copy.input.entry.call.input) as Record<string, unknown>
              ).name === "Linked effect"
            : copy.input.selection === "draft" &&
              copy.input.review?.comparison?.local.name ===
                "Draft reference edit"),
      )?.[0];
      expect(retained).toBeTruthy();
      await dialog
        .getByRole("button", { name: "Close dialog", exact: true })
        .click();
      await page.reload();
      await page
        .getByRole("button", { name: "Import saved work", exact: true })
        .click();
      await expect(
        dialog.getByRole("button", {
          name: "Refresh imported copies",
          exact: true,
        }),
      ).toBeEnabled();
    }
  }
  expect(await readFile(options.first.path)).toEqual(options.first.bytes);
  expect(await readFile(options.second.path)).toEqual(options.second.bytes);
}
