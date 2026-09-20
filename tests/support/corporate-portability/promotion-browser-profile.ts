import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { assertSchema } from "@suite/module-sdk";
import { ProfileRecoverySchema } from "../../../packages/contracts/src";
import type { operations } from "../../../packages/client/src/api";
import type { RestorationContext } from "./journey";
import { portabilityStorage } from "./devices";
import { holdServerReply } from "./server-reply";
import { captureArchive } from "./archives";
import { selectValue } from "../../e2e/controls.helpers";

type Identity =
  operations["me"]["responses"][200]["content"]["application/json"];
const pin = "12567890";
const lockHeading = (page: Page) =>
  page.getByRole("heading", { name: "Unlock your profile", exact: true });
async function unlock(page: Page) {
  await page
    .getByRole("main")
    .getByLabel("Device PIN", { exact: true })
    .fill(pin);
  await page
    .getByRole("button", { name: "Unlock with PIN", exact: true })
    .click();
  await expect(lockHeading(page)).toHaveCount(0);
}
async function signIn(page: Page, email: string) {
  await selectValue(page, "Local demonstration account", email);
  await page
    .getByRole("button", { name: "Open workspace", exact: true })
    .click();
}
async function switchProfile(page: Page) {
  await page.getByRole("button", { name: "Account menu", exact: true }).click();
  await page
    .getByRole("menuitem", { name: "Switch profile", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Saved online profiles", exact: true })
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
}

/** Real second-tab policy/session changes interrupt a first-tab restoration. */
export async function promotionBrowserProfile(
  context: RestorationContext,
  action: "lock" | "replace",
) {
  const { page, scope, input } = context;
  if (input.selection !== "request")
    throw Error("Expected a captured request.");
  const proof = async () => {
    const response = await page.request.get("/api/v1/identity/recovery");
    expect(response.status()).toBe(200);
    const body: unknown = await response.json();
    assertSchema(ProfileRecoverySchema, body);
    return body;
  };
  const initial = await proof();
  const dialog = () =>
    page.getByRole("dialog", { name: "Imported saved work", exact: true });
  const settings = () =>
    page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
  const bytes = await readFile(context.path);
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
    .fill("Preserved across browser tabs");
  await selectValue(page, "Status", "planned");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await settings();
  await page.getByLabel("Device PIN", { exact: true }).fill(pin);
  await page.getByLabel("Confirm device PIN", { exact: true }).fill(pin);
  await page
    .getByRole("button", { name: "Enable device unlock", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Update device unlock", exact: true }),
  ).toBeVisible();
  const before = await portabilityStorage(page, scope);
  expect(Object.values(before.drafts)).toContainEqual(
    expect.objectContaining({ name: "Preserved across browser tabs" }),
  );
  const digest = Object.keys(before.recoveryImports!).find(
    (key) => before.recoveryImports![key].input.selection === "request",
  )!;
  const unchanged = async () => {
    // Inspect durable bytes only; this raw IDB read is not an application authorization claim.
    const saved = await portabilityStorage(page, scope);
    expect(saved.recoveryImports).toEqual(before.recoveryImports);
    expect(saved.journal).toEqual(before.journal);
    expect(saved.drafts).toEqual(before.drafts);
  };
  const audit = async () => {
    const pool = new Pool({
      connectionString: process.env.MIGRATION_DATABASE_URL,
    });
    try {
      expect(
        (
          await pool.query(
            "select action from suite.audit where workspace_id=$1 and target_id=$2",
            [scope.workspaceId, input.entry.id],
          )
        ).rows,
      ).toEqual([{ action: "module.attempt.cancel" }]);
    } finally {
      await pool.end();
    }
  };
  const peer = await page.context().newPage();
  peer.setDefaultTimeout(15000);
  const gate = await holdServerReply(
    page,
    `/api/v1/module/${input.entry.call.moduleId}/workspaces/${scope.workspaceId}/attempts/settle`,
  );
  try {
    await peer.goto("/");
    await expect(lockHeading(peer)).toBeVisible();
    await unlock(peer);
    await expect(
      peer.getByRole("button", { name: "Account menu", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Import saved work", exact: true })
      .click();
    const section = () => dialog().locator(`[data-recovery-copy="${digest}"]`);
    await section()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await gate.arrived();
    await audit();
    await unchanged();
    if (action === "lock") {
      await peer
        .getByRole("button", { name: "Account menu", exact: true })
        .click();
      await peer
        .getByRole("menuitem", { name: "Lock profile", exact: true })
        .click();
      await expect(lockHeading(peer)).toBeVisible();
      await expect(lockHeading(page)).toBeVisible();
      await expect(dialog()).not.toBeVisible();
    } else {
      await switchProfile(peer);
      await expect(dialog()).not.toBeVisible();
      await signIn(peer, "sales@demo.local");
      await expect(
        peer.getByRole("button", { name: "Account menu", exact: true }),
      ).toBeVisible();
      const response = await peer.request.get("/api/v1/me");
      expect(response.status()).toBe(200);
      const identity = (await response.json()) as Identity;
      expect(identity.user.email).toBe("sales@demo.local");
      expect(identity.user.id).not.toBe(scope.userId);
      expect(
        identity.workspaces.map((workspace) => workspace.id),
      ).not.toContain(scope.workspaceId);
      const denied = await peer.request.get(
        `/api/v1/workspaces/${scope.workspaceId}/bootstrap`,
      );
      expect([403, 404]).toContain(denied.status());
      await expect(
        peer.getByRole("dialog", { name: "Imported saved work", exact: true }),
      ).toHaveCount(0);
    }
    await gate.release();
    await expect
      .poll(() =>
        page.evaluate(
          async (name) =>
            (await navigator.locks.query()).held?.some(
              (lock) => lock.name === name,
            ) ?? false,
          `suite-sync:${scope.userId}:${scope.workspaceId}`,
        ),
      )
      .toBe(false);
    await unchanged();
    await expect(
      page.getByText("Saved work restored for review.", { exact: false }),
    ).toHaveCount(0);
    if (action === "lock") await unlock(page);
    else {
      await switchProfile(peer);
      await signIn(peer, "owner@demo.local");
      await expect(lockHeading(peer)).toBeVisible();
      await unlock(peer);
      const renewed = await proof();
      expect(renewed.userId).toBe(scope.userId);
      expect(renewed.sessionId).not.toBe(initial.sessionId);
      await peer.close();
      await page.reload();
      await expect(lockHeading(page)).toBeVisible();
      await unlock(page);
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
      await page
        .getByRole("button", { name: "Import saved work", exact: true })
        .click();
    }
    await unchanged();
    const refresh = dialog().getByRole("button", {
      name: "Refresh imported copies",
      exact: true,
    });
    await expect(refresh).toBeEnabled();
    await refresh.click();
    await section()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "Confirm restoration", exact: true })
      .click();
    await expect(section()).toContainText(
      "Restored. The imported copy is retained separately.",
    );
    await expect(refresh).toBeEnabled();
    const after = await portabilityStorage(page, scope);
    expect(after.recoveryImports![digest].input).toEqual(input);
    expect(after.recoveryImports![digest].promotion).toMatchObject({
      requestId: input.entry.id,
      outcome: "cancelled",
    });
    expect(
      after.journal.filter((entry) => entry.id === input.entry.id),
    ).toHaveLength(1);
    expect(after.drafts).toEqual(before.drafts);
    expect(await readFile(context.path)).toEqual(bytes);
    await audit();
    await captureArchive(page, `web-promotion-tab-${action}`, false);
    return page;
  } finally {
    await gate.dispose();
    if (!peer.isClosed()) await peer.close();
  }
}
