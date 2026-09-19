import { expect, type Page } from "@playwright/test";
import { selectValue } from "../e2e/controls.helpers";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { CommandCorrectionOptions } from "./command-correction-journey";

/** Legacy/out-of-order envelope setup, with real authoritative effects and settlement. */
export async function recoverCollisionOutcome({
  options,
  page,
  scope,
  headers,
  name,
  child,
  outcome,
  targetChoice,
  checkParent = true,
}: {
  options: CommandCorrectionOptions;
  page: Page;
  scope: { userId: string; workspaceId: string };
  headers: Record<string, string>;
  name: string;
  child: JournalEntry;
  outcome: "accepted" | "cancelled";
  targetChoice?: "existing" | "separate";
  checkParent?: boolean;
}) {
  const command = child.call.action === "operation";
  const endpoint = `/api/v1/module/${child.call.moduleId}/workspaces/${scope.workspaceId}/${command ? `operations/${child.call.operation}` : "records"}`;
  const body = command
    ? child.call.input
    : {
        action: child.call.action,
        resource: child.call.resource,
        input: child.call.input,
      };
  if (outcome === "accepted") {
    const response = await options.api.post(endpoint, {
      headers: {
        ...headers,
        "idempotency-key": child.id,
        "x-module-version": child.call.moduleVersion!,
      },
      data: body,
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await options.offline(true);
  const stored = await options.storage(page, scope);
  const initialSize = stored.journal.length;
  const saved = stored.journal.find((entry) => entry.id === child.id)!;
  saved.delivery = "uncertain";
  saved.attempts = 1;
  // The current scheduler correctly holds this request behind the failed create.
  // Seed only old delivery metadata; never invent a server receipt or outcome.
  await writeLegacyCollisionState(options, page, scope, stored);
  page = await options.restartOffline();
  await options.reconnect();
  await page.getByRole("link", { name, exact: true }).click();
  if (checkParent) {
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
    const parent = page.getByRole("dialog", {
      name: "Create a separate record",
      exact: true,
    });
    if (targetChoice)
      await selectValue(
        page,
        `Record for later ${child.call.action === "archive" ? "archive" : "edit"} 1`,
        targetChoice,
      );
    await parent
      .getByRole("button", {
        name: "Check and create separate record",
        exact: true,
      })
      .click();
    await expect(parent).toContainText(
      "Recover its outcome before changing this record identity",
    );
    expect((await options.storage(page, scope)).journal).toHaveLength(
      initialSize,
    );
    await parent
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  }
  const inbox = async () => {
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await page
      .getByRole("region", { name: `${name} saved work`, exact: true })
      .getByRole("button", {
        name: command ? /^Saved commands/ : /^Saved records and drafts/,
      })
      .click();
    return page.getByRole("dialog", {
      name: command ? "Saved commands" : "Records and drafts",
      exact: true,
    });
  };
  let dialog = await inbox();
  await expect(dialog).toContainText("Outcome unknown");
  await options.loseSettlementReply();
  const resolve = async () => {
    await dialog
      .getByRole("listitem")
      .filter({ hasText: child.id })
      .getByRole("button", {
        name: command ? "Resolve outcome" : "Resolve record outcome",
        exact: true,
      })
      .click();
    await page
      .getByRole("dialog", {
        name: command ? "Resolve command outcome" : "Resolve record outcome",
        exact: true,
      })
      .getByRole("button", {
        name: command
          ? "Recover result or stop retries"
          : "Recover record result or stop retries",
        exact: true,
      })
      .click();
    await page.evaluate(
      (scope) =>
        navigator.locks.request(
          `suite-sync:${scope.userId}:${scope.workspaceId}`,
          async () => {},
        ),
      scope,
    );
  };
  await resolve();
  await expect
    .poll(
      async () =>
        (
          await options.pool.query(
            "select outcome from suite.idempotency where workspace_id=$1 and key=$2",
            [scope.workspaceId, child.id],
          )
        ).rows[0]?.outcome,
    )
    .toBe(outcome);
  expect(
    (await options.storage(page, scope)).journal.find(
      (entry) => entry.id === child.id,
    )!,
  ).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    call: child.call,
  });
  await options.offline(true);
  page = await options.restartOffline();
  dialog = await inbox();
  await expect(dialog).toContainText("Outcome unknown");
  await expect(
    dialog
      .getByRole("listitem")
      .filter({ hasText: child.id })
      .getByRole("button", {
        name: command ? "Resolve outcome" : "Resolve record outcome",
        exact: true,
      }),
  ).toBeDisabled();
  const evidence = command
    ? `docs/verification/collision-outcomes/command-${outcome}`
    : `docs/verification/collision-outcomes/resources/${options.mode.replace("collision-resource-", "")}`;
  await mkdir(evidence, { recursive: true });
  await expect(dialog).toBeVisible();
  if (options.kind === "web") {
    await expect(dialog).toHaveClass(/is-open/);
    await expect(dialog).toHaveCSS("opacity", "1");
  }
  await page.screenshot({
    path: `${evidence}/${options.kind}-unknown${command ? "" : `-${child.call.action}`}.png`,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(options.kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await options.reconnect();
  dialog = await inbox();
  await resolve();
  await expect
    .poll(
      async () =>
        (await options.storage(page, scope)).journal.find(
          (entry) => entry.id === child.id,
        )!.state,
    )
    .toBe(outcome === "accepted" ? "accepted" : "rejected");
  expect(
    (await options.storage(page, scope)).journal.find(
      (entry) => entry.id === child.id,
    )!.call,
  ).toEqual(child.call);
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  return page;
}

/** Seed legacy client state only; outcomes must come from the real server. */
export async function writeLegacyCollisionState(
  options: CommandCorrectionOptions,
  page: Page,
  scope: { userId: string; workspaceId: string },
  stored: Awaited<ReturnType<CommandCorrectionOptions["storage"]>>,
) {
  await page.evaluate(
    async ({ scope, stored, kind }) => {
      await navigator.locks.request(
        `suite-sync:${scope.userId}:${scope.workspaceId}`,
        () =>
          navigator.locks.request(
            `suite-modules:${scope.userId}:${scope.workspaceId}`,
            async () => {
              if (kind === "native") {
                await window.suiteDesktop!.cacheWrite(
                  scope,
                  "module-state",
                  stored,
                );
                return;
              }
              const db = await new Promise<IDBDatabase>((resolve, reject) => {
                const request = indexedDB.open("suite-offline-v1");
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              });
              try {
                await new Promise<void>((resolve, reject) => {
                  const transaction = db.transaction("records", "readwrite");
                  transaction
                    .objectStore("records")
                    .put(
                      stored,
                      `${scope.userId}/${scope.workspaceId}/module-state`,
                    );
                  transaction.oncomplete = () => resolve();
                  transaction.onerror = () => reject(transaction.error);
                  transaction.onabort = () => reject(transaction.error);
                });
              } finally {
                db.close();
              }
            },
          ),
      );
    },
    { scope, stored, kind: options.kind },
  );
}
