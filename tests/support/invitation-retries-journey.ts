import { expect, type Page, type ElectronApplication } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { InvitationSchema, Static } from "@suite/contracts";
import type { ReviewTransport } from "./capability-review-journey";
import { selectValue } from "../e2e/controls.helpers";
import { dropAcceptedReply } from "./drop-reply";

export async function invitationRetriesJourney(
  page: Page,
  workspaceId: string,
  send: ReviewTransport,
  app?: ElectronApplication,
) {
  const params = { workspaceId };
  const email = `invite-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const invitations = async () =>
    (await send({ operation: "invitations", params })).body as Static<
      typeof InvitationSchema
    >[];
  const audits = async (action: string) =>
    (
      (await send({ operation: "audit", params })).body as {
        items: { action: string }[];
      }
    ).items.filter((row) => row.action === action).length;
  const folder = "docs/verification/invitation-transitions";
  const prefix = app ? "desktop" : "web";
  await mkdir(folder, { recursive: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await selectValue(page, "Workspace", workspaceId);
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Invite a member", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Invite a teammate",
    exact: true,
  });
  const emailInput = dialog.getByRole("textbox", {
    name: "Email address",
    exact: true,
  });
  await emailInput.fill(email);
  const create = dialog.getByRole("button", {
    name: "Create invitation",
    exact: true,
  });
  const lostCreate = await dropAcceptedReply(
    page,
    `/api/v1/workspaces/${workspaceId}/invitations`,
    "POST",
    app,
  );
  try {
    await create.click();
    await expect.poll(async () => (await invitations()).length).toBe(1);
    await expect(create).toBeEnabled();
    await expect(dialog).toBeVisible();
    await expect(emailInput).toHaveValue(email);
    await expect(
      dialog.getByText(
        "Invitation creation could not be confirmed. Retry without changing the details to check its saved result.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(await audits("invitations.created")).toBe(1);
    await page.screenshot({ path: `${folder}/${prefix}-retry.png` });
    expect(
      (
        await new AxeBuilder({ page })
          .setLegacyMode(!!app)
          .include('[role="dialog"]')
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await create.click();
    await expect(dialog).toBeHidden();
    const keys = await lostCreate.keys();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe("");
    expect(keys[1]).toBe(keys[0]);
    expect(await invitations()).toHaveLength(1);
    expect(await audits("invitations.created")).toBe(1);
  } finally {
    await lostCreate.close();
  }
  const original = (await invitations())[0];
  await page.getByRole("tab", { name: "Invitations", exact: true }).click();
  const revoke = page.getByRole("button", {
    name: `Revoke invitation for ${email}`,
    exact: true,
  });
  const lostRevoke = await dropAcceptedReply(
    page,
    `/api/v1/workspaces/${workspaceId}/invitations/${original.id}`,
    "DELETE",
    app,
  );
  try {
    await revoke.click();
    await expect
      .poll(async () => (await invitations())[0].state)
      .toBe("revoked");
    await expect(revoke).toBeEnabled();
    await revoke.click();
    await expect(revoke).toHaveCount(0);
    expect(await lostRevoke.keys()).toHaveLength(2);
    expect(await audits("invitations.revoked")).toBe(1);
  } finally {
    await lostRevoke.close();
  }
  await page.reload();
  await page.getByRole("tab", { name: "Invitations", exact: true }).click();
  const table = page.getByRole("table", { name: "Invitations", exact: true });
  await expect(table.getByRole("row").filter({ hasText: email })).toContainText(
    "Revoked",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await table
    .getByRole("cell", { name: "Revoked", exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    table.getByRole("cell", { name: "Revoked", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: `${folder}/${prefix}-revoked-narrow.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page
    .getByRole("button", { name: "Invite a member", exact: true })
    .click();
  await emailInput.fill(email);
  await create.click();
  await expect(dialog).toBeHidden();
  const replacement = (await invitations()).find(
    (row) => row.id !== original.id,
  )!;
  expect(replacement.state).toBe("pending");
  expect(
    (
      await send({
        operation: "inviteRevoke",
        params: { ...params, id: original.id },
      })
    ).status,
  ).toBe(200);
  expect(
    (await invitations()).find((row) => row.id === replacement.id)?.state,
  ).toBe("pending");
  expect(await audits("invitations.created")).toBe(2);
  expect(await audits("invitations.revoked")).toBe(1);
  await expect(revoke).toBeVisible();
  await page.screenshot({ path: `${folder}/${prefix}-replacement.png` });
}
