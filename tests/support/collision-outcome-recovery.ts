import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { JournalEntry } from "@suite/module-sdk/sync";
import type { CommandCorrectionOptions } from "./command-correction-journey";

/** Legacy/out-of-order envelope setup, with real authoritative effects and settlement. */
export async function recoverCollisionCommandOutcome({
  options,
  page,
  scope,
  headers,
  name,
  child,
  outcome,
}: {
  options: CommandCorrectionOptions;
  page: Page;
  scope: { userId: string; workspaceId: string };
  headers: Record<string, string>;
  name: string;
  child: JournalEntry;
  outcome: "accepted" | "cancelled";
}) {
  const endpoint = `/api/v1/module/${child.call.moduleId}/workspaces/${scope.workspaceId}/operations/capture`;
  if (outcome === "accepted") {
    const response = await options.api.post(endpoint, {
      headers: {
        ...headers,
        "idempotency-key": child.id,
        "x-module-version": child.call.moduleVersion!,
      },
      data: child.call.input,
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await options.offline(true);
  const stored = await options.storage(page, scope);
  const saved = stored.journal.find((entry) => entry.id === child.id)!;
  saved.delivery = "uncertain";
  saved.attempts = 1;
  // The current scheduler correctly holds this request behind the failed create.
  // Seed only old delivery metadata; never invent a server receipt or outcome.
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
  page = await options.restartOffline();
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
  const parent = page.getByRole("dialog", {
    name: "Create a separate record",
    exact: true,
  });
  await parent
    .getByRole("button", {
      name: "Check and create separate record",
      exact: true,
    })
    .click();
  await expect(parent).toContainText(
    "Recover its outcome before changing this record identity",
  );
  expect((await options.storage(page, scope)).journal).toHaveLength(2);
  await parent
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const inbox = async () => {
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await page
      .getByRole("region", { name: `${name} saved work`, exact: true })
      .getByRole("button", { name: /^Saved commands/ })
      .click();
    return page.getByRole("dialog", { name: "Saved commands", exact: true });
  };
  let dialog = await inbox();
  await expect(dialog).toContainText("Outcome unknown");
  await options.loseSettlementReply();
  const resolve = async () => {
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
  expect((await options.storage(page, scope)).journal[1]).toMatchObject({
    state: "pending",
    delivery: "uncertain",
    call: child.call,
  });
  await options.offline(true);
  page = await options.restartOffline();
  dialog = await inbox();
  await expect(dialog).toContainText("Outcome unknown");
  await expect(
    dialog.getByRole("button", { name: "Resolve outcome", exact: true }),
  ).toBeDisabled();
  const evidence = `docs/verification/collision-outcomes/command-${outcome}`;
  await mkdir(evidence, { recursive: true });
  await expect(dialog).toBeVisible();
  if (options.kind === "web") {
    await expect(dialog).toHaveClass(/is-open/);
    await expect(dialog).toHaveCSS("opacity", "1");
  }
  await page.screenshot({ path: `${evidence}/${options.kind}-unknown.png` });
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
    .poll(async () => (await options.storage(page, scope)).journal[1].state)
    .toBe(outcome === "accepted" ? "accepted" : "rejected");
  expect((await options.storage(page, scope)).journal[1].call).toEqual(
    child.call,
  );
  await dialog
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  return page;
}
