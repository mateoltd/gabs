import { expect, type APIResponse } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { CommandCorrectionOptions } from "./command-correction-journey";
import { selectValue } from "../e2e/controls.helpers";
export async function historicalPermissionJourney(
  options: CommandCorrectionOptions,
  context: {
    id: string;
    scope: { userId: string; workspaceId: string };
    headers: Record<string, string>;
    version: string;
    denied(): Promise<APIResponse>;
  },
) {
  const { page, api, kind, mode } = options;
  const { id, scope, headers, version } = context;
  const permission = `${id}.capture`,
    roleName = `Recovery ${id}`;
  const endpoint = `/api/v1/workspaces/${scope.workspaceId}`;
  const state = await (await api.get(`${endpoint}/platform`)).json();
  expect(
    state.permissionCatalog.find(
      (p: { permission: string }) => p.permission === permission,
    ),
  ).toMatchObject({ moduleId: id, current: false, versions: [version] });
  for (const invalid of ["members.manage", `${id}.invented`]) {
    const reply = await api.post(`${endpoint}/roles`, {
      headers: { ...headers, "idempotency-key": randomUUID() },
      data: { name: "Invalid recovery grant", permissions: [invalid] },
    });
    expect(reply.status()).toBe(400);
    expect((await reply.json()).code).toBe("INVALID_PERMISSION");
  }
  await page
    .getByRole("link", { name: "People & access", exact: true })
    .click();
  await page.getByRole("tab", { name: "Roles", exact: true }).click();
  await page.getByRole("button", { name: "Create role", exact: true }).click();
  const role = page.getByRole("dialog", {
    name: "Create business role",
    exact: true,
  });
  await role.getByLabel("Role name", { exact: true }).fill(roleName);
  const checkbox = role.getByRole("checkbox", {
    name: permission,
    exact: true,
  });
  await checkbox.check();
  const row = checkbox.locator("xpath=ancestor::label/..");
  await expect(row).toContainText(`Other releases: ${version}`);
  await row.scrollIntoViewIfNeeded();
  await mkdir("docs/verification/historical-permissions", { recursive: true });
  await options.narrow();
  await row.scrollIntoViewIfNeeded();
  expect(await role.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .setLegacyMode(kind === "native")
        .include('[role="dialog"]')
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({
    path: `docs/verification/historical-permissions/${kind}-${mode}-role-narrow.png`,
  });
  await options.wide();
  await role.getByRole("button", { name: "Save role", exact: true }).click();
  await expect(role).not.toBeVisible();
  await page.getByRole("tab", { name: "Members", exact: true }).click();
  await page
    .getByRole("button", { name: "Manage Alex Morgan", exact: true })
    .click();
  const member = page.getByRole("dialog", {
    name: "Manage Alex Morgan",
    exact: true,
  });
  await member.getByRole("checkbox", { name: roleName, exact: true }).check();
  await member
    .getByRole("button", { name: "Save access", exact: true })
    .click();
  await expect(member).not.toBeVisible();
  const effective = async () =>
    (await (await api.get(`${endpoint}/bootstrap`)).json())
      .permissions as string[];
  await expect
    .poll(async () => (await effective()).includes(permission))
    .toBe(true);
  await page.getByRole("link", { name: "Organization", exact: true }).click();
  await selectValue(page, "Module", id);
  const matrix = page.getByRole("region", {
    name: "Permission matrix",
    exact: true,
  });
  await expect(
    matrix.getByRole("checkbox", {
      name: `${roleName}: contacts.contacts.read`,
      exact: true,
    }),
  ).toBeVisible();
  const grant = matrix.getByRole("checkbox", {
    name: `${roleName}: ${permission}`,
    exact: true,
  });
  await expect(grant).toBeChecked();
  await expect(grant.locator("xpath=ancestor::tr")).toContainText(
    `Other releases: ${version}`,
  );
  await grant.press("Space");
  await expect(grant).not.toBeChecked();
  await expect
    .poll(async () => (await effective()).includes(permission))
    .toBe(false);
  const denied = await context.denied();
  expect(denied.status(), await denied.text()).toBe(403);
  await expect(grant).toBeEnabled();
  await grant.press("Space");
  await expect(grant).toBeChecked();
  await expect
    .poll(async () => (await effective()).includes(permission))
    .toBe(true);
  await expect(grant).toBeEnabled();
  await grant.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `docs/verification/historical-permissions/${kind}-${mode}-matrix.png`,
  });
  const roles = (await (await api.get(`${endpoint}/platform`)).json()).roles;
  const savedRole = roles.find((r: { name: string }) => r.name === roleName);
  expect(savedRole.permissions).toEqual([permission]);
  const audits = await options.pool.query(
    "select count(*)::int as count from suite.audit where workspace_id=$1 and target_id=$2 and action='roles.saved'",
    [scope.workspaceId, savedRole.id],
  );
  expect(audits.rows[0].count).toBe(3);
}
