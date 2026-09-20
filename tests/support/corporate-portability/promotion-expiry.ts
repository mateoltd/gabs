import { expect, type ElectronApplication } from "@playwright/test";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { assertSchema } from "@suite/module-sdk";
import { ProfileRecoverySchema } from "../../../packages/contracts/src";
import type { RestorationContext } from "./journey";
import { portabilityStorage } from "./devices";
import { holdServerReply } from "./server-reply";
import { captureArchive } from "./archives";
import { selectValue } from "../../e2e/controls.helpers";

/** Expire exactly the recovering server session, then require a real fresh UI sign-in. */
export async function promotionExpiry(
  context: RestorationContext,
  options: { surface: string; app?: ElectronApplication },
) {
  const { page, scope, input } = context;
  if (input.selection !== "request") throw Error("A request is required.");
  const dialog = () =>
    page.getByRole("dialog", { name: "Imported saved work", exact: true });
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const proof = () =>
    page.evaluate(async () => {
      if (window.suiteDesktop)
        return window.suiteDesktop.execute({ operation: "profileRecovery" });
      const response = await fetch("/api/v1/identity/recovery");
      return {
        status: response.status,
        body: (await response.json()) as unknown,
      };
    });
  const initial = await proof();
  expect(initial.status).toBe(200);
  assertSchema(ProfileRecoverySchema, initial.body);
  const session = initial.body;
  expect(session.userId).toBe(scope.userId);
  await dialog()
    .getByRole("button", { name: "Back to imported copies", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New projects", exact: true }).click();
  await page
    .getByLabel("Name", { exact: true })
    .fill("Preserved across session expiry");
  await selectValue(page, "Status", "planned");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await settings();
  await expect
    .poll(async () =>
      Object.values((await portabilityStorage(page, scope)).drafts),
    )
    .toContainEqual(
      expect.objectContaining({ name: "Preserved across session expiry" }),
    );
  await page
    .getByRole("button", { name: "Import saved work", exact: true })
    .click();
  const before = await portabilityStorage(page, scope);
  const digest = Object.entries(before.recoveryImports!).find(
    ([, copy]) => copy.input.selection === "request",
  )![0];
  const section = () => dialog().locator(`[data-recovery-copy="${digest}"]`);
  const refresh = () =>
    dialog().getByRole("button", {
      name: "Refresh imported copies",
      exact: true,
    });
  const unchanged = async () => {
    const current = await portabilityStorage(page, scope);
    expect(current.recoveryImports).toEqual(before.recoveryImports);
    expect(current.journal).toEqual(before.journal);
    expect(current.drafts).toEqual(before.drafts);
  };
  await section()
    .getByRole("button", { name: "Restore for review", exact: true })
    .click();
  const gate = await holdServerReply(
    page,
    `/api/v1/module/${input.entry.call.moduleId}/workspaces/${scope.workspaceId}/attempts/settle`,
    options.app,
  );
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const audit = async () => {
    expect(
      (
        await pool.query(
          "select action from suite.audit where workspace_id=$1 and target_id=$2",
          [scope.workspaceId, input.entry.id],
        )
      ).rows,
    ).toEqual([{ action: "module.attempt.cancel" }]);
  };
  try {
    try {
      await dialog()
        .getByRole("button", { name: "Confirm restoration", exact: true })
        .click();
      await gate.arrived();
      await audit();
      // The hashed recovery identity selects one disposable session without changing other logins.
      const sessions = await pool.query<{
        token_hash: string;
        csrf_token: string;
      }>("select token_hash,csrf_token from suite.sessions where user_id=$1", [
        scope.userId,
      ]);
      const matching = sessions.rows.filter(
        (row) =>
          createHash("sha256")
            .update(`profile-recovery:${row.csrf_token}`)
            .digest("hex") === session.sessionId,
      );
      expect(matching.length).toBe(1);
      const aged = await pool.query(
        "update suite.sessions set created_at=clock_timestamp()-interval '6 minutes' where token_hash=$1 and user_id=$2",
        [matching[0].token_hash, scope.userId],
      );
      expect(aged.rowCount).toBe(1);
      const expired = await proof();
      expect(expired.status).toBe(403);
      expect(expired.body).toMatchObject({ code: "REAUTHENTICATION_REQUIRED" });
      await gate.release();
      await expect(dialog().getByRole("alert").first()).toContainText(
        /sign in again/i,
      );
      await expect(dialog()).not.toContainText(
        "Saved work restored for review.",
      );
      await unchanged();
      const back = dialog().getByRole("button", {
        name: "Back to imported copies",
        exact: true,
      });
      if (await back.isVisible()) await back.click();
      await refresh().click();
      await expect(refresh()).toBeEnabled();
      await expect(
        dialog().getByRole("button", {
          name: "Restore for review",
          exact: true,
        }),
      ).toHaveCount(0);
      await unchanged();
      await captureArchive(
        page,
        `${options.surface}-promotion-session-expired`,
        false,
      );
    } finally {
      await gate.dispose();
    }

    await dialog()
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Switch profile", exact: true })
      .click();
    const profiles = page.getByRole("dialog", {
      name: "Saved online profiles",
      exact: true,
    });
    await profiles
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    if (!options.app)
      await selectValue(
        page,
        "Local demonstration account",
        "owner@demo.local",
      );
    await page
      .getByRole("button", {
        name: options.app ? "Open local workspace" : "Open workspace",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    const renewed = await proof();
    expect(renewed.status).toBe(200);
    assertSchema(ProfileRecoverySchema, renewed.body);
    expect(renewed.body.userId).toBe(scope.userId);
    expect(renewed.body.sessionId).not.toBe(session.sessionId);
    await selectValue(page, "Workspace", scope.workspaceId);
    await settings();
    const enable = page.getByRole("button", {
      name: "Enable on this device",
      exact: true,
    });
    const disable = page.getByRole("button", {
      name: "Disable offline storage",
      exact: true,
    });
    await expect(enable.or(disable)).toBeVisible();
    if (await enable.isVisible()) await enable.click();
    await expect(disable).toBeVisible();
    await unchanged();
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    await section()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(section()).toContainText(
      "Restored. The imported copy is retained separately.",
    );
    await expect(refresh()).toBeEnabled();
    const restored = await portabilityStorage(page, scope);
    expect(restored.recoveryImports![digest].input).toEqual(input);
    expect(restored.recoveryImports![digest].promotion).toMatchObject({
      requestId: input.entry.id,
      outcome: "cancelled",
    });
    expect(restored.drafts).toEqual(before.drafts);
    await audit();
    await captureArchive(
      page,
      `${options.surface}-promotion-session-renewed`,
      false,
    );
  } finally {
    await pool.end();
  }
  return page;
}
