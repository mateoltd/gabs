import { mixedArchiveJourney } from "./mixed-archives";
import { exportCommandSnapshot } from "./command-snapshots";
import { switchSnapshots } from "./snapshots";
import { expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";
import { collisionCommandJourney } from "../collision-command-journey";
import { selectValue } from "../../e2e/controls.helpers";
import type { corporatePortability } from "./journey";
import { portabilityStorage } from "./devices";

export async function corporateReferenceHints(
  options: Parameters<typeof corporatePortability>[0] & {
    pool: Pool;
    target: "original" | "separate";
    snapshots?: boolean;
  },
) {
  await collisionCommandJourney({
    page: options.source,
    api: options.api,
    pool: options.pool,
    kind: options.evidenceName === "native" ? "native" : "web",
    mode: "capture",
    offline: options.offline,
    reconnect: () => options.offline(false),
    storage: portabilityStorage,
    afterCollision: async (capture) => {
      let page = capture.page;
      const { scope, child, parent, name, moduleId, headers } = capture;
      const hints = child.createRecovery!;
      expect(hints).toEqual([
        {
          moduleId,
          resource: "notes",
          originalId: capture.originalTarget,
          replacementId: capture.separateTarget,
        },
      ]);
      const close = async (dialog: Locator) => {
        await dialog
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
        await expect(dialog).toHaveCount(0);
      };
      const settings = () =>
        page
          .getByRole("navigation", { name: "Preferences", exact: true })
          .getByRole("link", { name: "Settings", exact: true })
          .click();
      const exportFile = async (button: Locator, filename: string) => {
        const path = resolve(options.directory, filename);
        await options.exportFile(button, path);
        return { path, bytes: await readFile(path) };
      };
      await options.offline(true);
      await settings();
      await page.getByRole("button", { name: /^Saved commands/ }).click();
      let dialog = page.getByRole("dialog", {
        name: "Saved commands",
        exact: true,
      });
      const childFile = await exportFile(
        dialog.getByRole("button", {
          name: "Export saved request",
          exact: true,
        }),
        "child.json",
      );
      expect(JSON.parse(childFile.bytes.toString()).entry).toEqual(child);
      await close(dialog);
      const commandName = options.snapshots
        ? "Second command snapshot"
        : "Linked effect";
      const secondFile = options.snapshots
        ? await exportCommandSnapshot({
            page,
            moduleName: name,
            name: commandName,
            exportFile,
          })
        : undefined;
      if (secondFile) await settings();
      await page
        .getByRole("button", { name: /^Saved records and drafts/ })
        .click();
      dialog = page.getByRole("dialog", {
        name: "Records and drafts",
        exact: true,
      });
      const parentFile = await exportFile(
        dialog
          .getByRole("listitem")
          .filter({ has: page.getByText(parent.id, { exact: true }) })
          .getByRole("button", { name: "Export saved request", exact: true }),
        "parent.json",
      );
      page = await options.replaceDevice();
      await page.reload();
      await selectValue(page, "Workspace", scope.workspaceId);
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
      const read = () => portabilityStorage(page, scope);
      const restore = async (path: string) => {
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
          .setInputFiles(path);
        const copy =
          secondFile && path === parentFile.path
            ? imported
                .locator("section")
                .filter({ has: page.getByText(parent.id, { exact: true }) })
            : imported;
        await copy
          .getByRole("button", { name: "Restore for review", exact: true })
          .click();
        if (path === childFile.path) {
          await expect(imported).toContainText(capture.originalTarget);
          await expect(imported).toContainText(capture.separateTarget);
          await expect(imported).toContainText("saved reference hints");
        }
        await imported
          .getByRole("button", { name: "Confirm restoration", exact: true })
          .click();
        await expect(
          imported.getByText(
            "Restored. The imported copy is retained separately.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          imported.getByRole("button", {
            name: "Refresh imported copies",
            exact: true,
          }),
        ).toBeEnabled();
        if (secondFile && path === childFile.path) {
          const evidence = resolve("docs/verification/imported-snapshots");
          await mkdir(evidence, { recursive: true });
          await switchSnapshots({
            kind: "command",
            page,
            scope,
            first: childFile,
            second: secondFile,
            commandName,
            evidence,
            surface: `${options.evidenceName}-command-${options.target}`,
          });
        }
        await close(imported);
      };
      await restore(childFile.path);
      let restored = (await read()).journal.find(
        (entry) => entry.id === child.id,
      )!;
      expect(restored.call).toEqual(child.call);
      expect(restored.createRecovery).toEqual(hints);
      expect(restored.captureDependencies).toEqual(child.captureDependencies);
      expect(restored.dependencies).toEqual([parent.id]);
      expect(restored.settlement).toBe("cancelled");
      const openReview = async () => {
        await page.getByRole("link", { name, exact: true }).click();
        await page.getByRole("button", { name: /^Saved commands/ }).click();
        const inbox = page.getByRole("dialog", {
          name: "Saved commands",
          exact: true,
        });
        await inbox
          .getByRole("button", {
            name: /^(Review command|Resume command review)$/,
            exact: true,
          })
          .click();
        return {
          inbox,
          review: page.getByRole("dialog", {
            name: "Review saved command",
            exact: true,
          }),
        };
      };
      const submit = async (review: Locator) => {
        await review
          .getByRole("button", {
            name: "Prepare corrected command",
            exact: true,
          })
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
      let opened = await openReview();
      await expect(
        opened.review.getByLabel("Target Id", { exact: true }),
      ).toHaveValue(capture.originalTarget);
      // Missing prerequisite receipts must block even an explicitly submitted correction.
      let confirm = await submit(opened.review);
      await expect(confirm.getByRole("alert")).toContainText(
        "Wait for prerequisite",
      );
      expect((await read()).journal).toHaveLength(1);
      await close(confirm);
      await close(opened.review);
      await close(opened.inbox);
      await restore(parentFile.path);
      expect(
        (await read()).journal.find((entry) => entry.id === parent.id)?.state,
      ).toBe("accepted");
      await page.reload();
      opened = await openReview();
      await expect(opened.review).toContainText(capture.originalTarget);
      await expect(opened.review).toContainText(capture.separateTarget);
      await expect(
        opened.review.getByLabel("Target Id", { exact: true }),
      ).toHaveValue(capture.originalTarget);
      const target =
        options.target === "separate"
          ? capture.separateTarget
          : capture.originalTarget;
      await opened.review.getByLabel("Target Id", { exact: true }).fill(target);
      const saveReview = opened.review.getByRole("button", {
        name: "Save review",
        exact: true,
      });
      if (options.target === "separate") await saveReview.click();
      else await expect(saveReview).toBeDisabled(); // The blocked attempt already saved this unchanged review.
      await expect(opened.review).toContainText("Review saved on this device.");
      const evidence = resolve(
        options.snapshots
          ? "docs/verification/imported-snapshots"
          : "docs/verification/imported-reference-hints",
      );
      await mkdir(evidence, { recursive: true });
      const prefix = `${options.evidenceName}-${options.snapshots ? "command-review-" : ""}${options.target}`;
      await saveReview.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(evidence, `${prefix}.png`),
        animations: "disabled",
      });
      expect(
        (
          await new AxeBuilder({ page })
            .setLegacyMode(options.evidenceName === "native")
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
      await opened.review
        .getByRole("button", { name: "Save review", exact: true })
        .scrollIntoViewIfNeeded();
      await page.screenshot({
        path: resolve(evidence, `${prefix}-narrow.png`),
        animations: "disabled",
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.setViewportSize(viewport);
      await page.reload();
      opened = await openReview();
      await expect(
        opened.review.getByLabel("Target Id", { exact: true }),
      ).toHaveValue(target);
      confirm = await submit(opened.review);
      await expect(confirm).toHaveCount(0);
      await expect
        .poll(
          async () =>
            (await read()).journal.find((entry) => entry.id === child.id)
              ?.supersededBy,
        )
        .toBeTruthy();
      restored = (await read()).journal.find((entry) => entry.id === child.id)!;
      await expect
        .poll(
          async () =>
            (await read()).journal.find(
              (entry) => entry.id === restored.supersededBy,
            )?.state,
        )
        .toBe("accepted");
      const corrected = (await read()).journal.find(
        (entry) => entry.id === restored.supersededBy,
      )!;
      expect(corrected.call.input).toEqual({
        name: commandName,
        targetId: target,
      });
      expect(restored.call).toEqual(child.call);
      for (const entry of [child, corrected]) {
        const response = await options.api.post(
          `/api/v1/module/${moduleId}/workspaces/${scope.workspaceId}/operations/capture`,
          {
            headers: {
              ...headers,
              "idempotency-key": entry.id,
              "x-module-version": entry.call.moduleVersion!,
            },
            data: entry.call.input,
          },
        );
        expect(response.status()).toBe(entry === child ? 409 : 200);
        if (entry === child)
          expect((await response.json()).code).toBe("ATTEMPT_CANCELLED");
        else expect(await response.json()).toEqual(corrected.result);
      }
      const records = await options.pool.query(
        "select data from suite.module_records where workspace_id=$1 and module_id=$2",
        [scope.workspaceId, moduleId],
      );
      expect(records.rows.map((row) => row.data.name).sort()).toEqual(
        [
          "Existing corporate record",
          "Separate recovered record",
          `${commandName}: ${options.target === "separate" ? "Separate recovered record" : "Existing corporate record"}`,
        ].sort(),
      );
      expect(
        (
          await options.pool.query(
            "select count(*)::int n from suite.audit where workspace_id=$1 and action=$2",
            [scope.workspaceId, `${moduleId}.notes.create`],
          )
        ).rows[0].n,
      ).toBe(3);
      expect(await readFile(childFile.path)).toEqual(childFile.bytes);
      expect(await readFile(parentFile.path)).toEqual(parentFile.bytes);
      if (options.archive)
        await mixedArchiveJourney({
          page,
          scope,
          moduleId,
          retained: JSON.parse(childFile.bytes.toString()),
          directory: options.directory,
          surface: options.evidenceName!,
          pool: options.pool,
          exportFile: options.exportFile,
          replaceDevice: options.replaceDevice,
        });
    },
  });
}
