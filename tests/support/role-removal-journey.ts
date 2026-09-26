import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { RoleDetails } from "@suite/contracts";
import type { PlatformState } from "@suite/module-sdk/platform";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";
import { dropAcceptedReply } from "./drop-reply";

export async function roleRemovalJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  app?: ElectronApplication,
) {
  const params = { workspaceId };
  const create = await send({
    operation: "roleCreate",
    params,
    body: { name: "Dispatch operator", permissions: ["orders.read"] },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(create.status).toBe(200);
  const role = create.body as RoleDetails;
  const state = async () =>
    (await send({ operation: "platformState", params })).body as PlatformState;
  const audits = async () =>
    (
      (await send({ operation: "audit", params })).body as {
        items: { action: string; targetId: string }[];
      }
    ).items.filter((item) => item.action === "roles.removed").length;
  const before = (await state()).organization!;
  const { version, ...policy } = before;
  policy.groups = [
    {
      id: crypto.randomUUID(),
      name: "Dispatch",
      rankIds: [role.id, policy.rootId],
      grants: [],
      denies: [],
      tags: [],
    },
  ];
  policy.tags = [
    {
      id: crypto.randomUUID(),
      name: "Temporary",
      rankIds: [role.id],
      grants: [],
      denies: [],
    },
  ];
  expect(
    (
      await send({
        operation: "platformCommand",
        params,
        body: { action: "organization", value: policy, version },
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  const invite = await send({
    operation: "inviteCreate",
    params,
    body: { email: "dispatch-history@test.local", roleId: role.id },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(invite.status).toBe(200);
  const inviteId = (invite.body as { id: string }).id;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  const chart = page.getByRole("group", {
    name: "Organization hierarchy",
    exact: true,
  });
  const open = async () => {
    const node = chart.locator(`[data-rank-id="${role.id}"]`);
    await node.focus();
    await node.press("Enter");
    await page
      .getByRole("dialog", { name: "Dispatch operator", exact: true })
      .getByRole("button", { name: "Remove role", exact: true })
      .click();
  };
  await chart
    .getByRole("button", { name: "Configure Administrador", exact: true })
    .press("Enter");
  await expect(
    page
      .getByRole("dialog", { name: "Administrador", exact: true })
      .getByRole("button", { name: "Remove role", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await open();
  const dialog = page.getByRole("dialog", { name: /^Remove role:/ });
  await dialog
    .getByRole("button", { name: "Remove role", exact: true })
    .click();
  await expect(dialog).toContainText("Revoke pending invitations");
  await expect(
    dialog.getByRole("button", { name: "Reload removal review" }),
  ).toBeEnabled();
  expect(await audits()).toBe(0);
  const folder = "docs/verification/role-removal",
    prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: `${folder}/${prefix}-blocked.png` });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toBeFocused();
  expect(
    (
      await send({
        operation: "inviteRevoke",
        params: { ...params, id: inviteId },
        idempotencyKey: crypto.randomUUID(),
      })
    ).status,
  ).toBe(200);
  await open();
  const edit = await send({
    operation: "roleEdit",
    params: { ...params, id: role.id },
    body: {
      revision: role.revision,
      name: "Dispatch coordinator",
      permissions: role.permissions,
    },
    idempotencyKey: crypto.randomUUID(),
  });
  expect(edit.status).toBe(200);
  await dialog
    .getByRole("button", { name: "Remove role", exact: true })
    .click();
  await expect(dialog).toContainText("This role changed");
  expect(await audits()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!app)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${folder}/${prefix}-stale-narrow.png` });
  await dialog.getByRole("button", { name: "Reload removal review" }).click();
  await expect(dialog).toHaveAccessibleName(
    "Remove role: Dispatch coordinator",
  );
  const lost = await dropAcceptedReply(
    page,
    `/api/v1/workspaces/${workspaceId}/roles/${role.id}/remove`,
    "POST",
    app,
  );
  try {
    await dialog
      .getByRole("button", { name: "Remove role", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await state()).roles.some((item) => item.id === role.id),
      )
      .toBe(false);
    await expect(dialog).toContainText("The removal could not be confirmed");
    const retry = dialog.getByRole("button", {
      name: "Retry removal",
      exact: true,
    });
    await expect(retry).toBeEnabled();
    await page.screenshot({ path: `${folder}/${prefix}-retry-narrow.png` });
    await retry.click();
    await expect(dialog).toBeHidden();
    expect(await lost.keys()).toEqual([expect.any(String), expect.any(String)]);
    const keys = await lost.keys();
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(await audits()).toBe(1);
  } finally {
    await lost.close();
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(chart.locator(`[data-rank-id="${role.id}"]`)).toHaveCount(0);
  await expect(
    chart.getByRole("button", { name: "Configure Administrador", exact: true }),
  ).toBeVisible();
  const after = (await state()).organization!;
  expect(after.groups[0].rankIds).toEqual([policy.rootId]);
  expect(after.tags![0].rankIds).toEqual([]);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Invitations", exact: true }).click();
  const history = page
    .getByRole("row")
    .filter({ hasText: "dispatch-history@test.local" });
  await expect(history).toContainText("Dispatch coordinator");
  await expect(history).toContainText(/revoked/i);
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(!!app)
        .withTags(["wcag2a", "wcag2aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: `${folder}/${prefix}-history.png` });
}
