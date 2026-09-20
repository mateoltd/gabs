import { expect } from "@playwright/test";
import { Pool } from "pg";
import type { RestorationContext } from "./journey";
import { portabilityStorage, type nativePortabilityDevice } from "./devices";

interface HeldSettlement {
  status: number;
  request: unknown;
  response: unknown;
}

/** Lose an actual committed server reply before either main or renderer consumes it. */
export async function crashSettlementReply(
  context: RestorationContext,
  device: Awaited<ReturnType<typeof nativePortabilityDevice>>,
) {
  const { page, scope, input } = context;
  if (input.selection !== "request" || input.entry.call.action !== "create")
    throw Error("The exported create request is required.");
  const before = await portabilityStorage(page, scope);
  const path = `/api/v1/module/${input.entry.call.moduleId}/workspaces/${scope.workspaceId}/attempts/settle`;
  await device.app.evaluate((_, path) => {
    const root = globalThis as typeof globalThis & {
      heldSettlement?: HeldSettlement;
    };
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const request = new Request(args[0], args[1]);
      const response = await original(...args);
      if (new URL(request.url).pathname === path && request.method === "POST") {
        root.heldSettlement = {
          status: response.status,
          request: await request.json(),
          response: await response.clone().json(),
        };
        // Deliberately never return this response. Only the owning process is killed.
        await new Promise<void>(() => {});
      }
      return response;
    };
  }, path);
  const dialog = page.getByRole("dialog", {
    name: "Imported saved work",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Confirm restoration", exact: true })
    .click();
  await expect
    .poll(() =>
      device.app.evaluate(
        () =>
          (
            globalThis as typeof globalThis & {
              heldSettlement?: HeldSettlement;
            }
          ).heldSettlement,
      ),
    )
    .toEqual({
      status: 200,
      request: {
        key: input.entry.id,
        call: {
          action: input.entry.call.action,
          resource: input.entry.call.resource,
          input: input.entry.call.input,
        },
      },
      response: { key: input.entry.id, outcome: "cancelled" },
    });
  // Independently inspect committed server state while the real reply remains withheld.
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  try {
    const audit = await pool.query(
      "select action from suite.audit where workspace_id=$1 and target_id=$2",
      [scope.workspaceId, input.entry.id],
    );
    expect(audit.rows).toEqual([{ action: "module.attempt.cancel" }]);
  } finally {
    await pool.end();
  }
  const waiting = await portabilityStorage(page, scope);
  expect(waiting.recoveryImports).toEqual(before.recoveryImports);
  expect(waiting.journal).toEqual(before.journal);
  expect(waiting.drafts).toEqual(before.drafts);
  await expect(dialog).not.toContainText("Saved work restored for review.");
  expect(
    await device.app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().every(
        (window) =>
          !window.isFocused() && (!window.isVisible() || window.isMinimized()),
      ),
    ),
  ).toBe(true);
  const child = device.app.process();
  expect(child.kill("SIGKILL")).toBe(true);
  await expect.poll(() => child.signalCode).toBe("SIGKILL");
}
