import "dotenv/config";
import { test, expect, request as apiRequest } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Pool } from "pg";
import { publishExecutableFixture } from "../executable-fixture";
import { selectValue } from "./controls.helpers";

test("an existing company configures, publishes and assigns a newly reviewed module through administration", async ({
  page,
}) => {
  test.setTimeout(120000);
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const employee = await apiRequest.newContext({
    baseURL: "http://localhost:4300",
  });
  const moduleId = `activation-${randomUUID().slice(0, 8)}`;
  const name = `Activation notes ${moduleId.slice(-8)}`;
  try {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await page
      .getByRole("button", { name: "Open workspace", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toBeVisible();
    const me = await (await page.request.get("/api/v1/me")).json();
    const workspace = randomUUID();
    const created = await page.request.post("/api/v1/workspaces", {
      headers: {
        origin: "http://localhost:4300",
        "x-csrf-token": me.csrfToken,
        "idempotency-key": randomUUID(),
      },
      data: {
        id: workspace,
        name: "New module administration",
        currency: "EUR",
      },
    });
    expect(created.ok(), await created.text()).toBe(true);
    // Identity and purchase are fixtures. Configuration, permissions and assignment use the real UI.
    const viewer = (
      await pool.query(
        "select id from suite.users where issuer='development' and subject='viewer'",
      )
    ).rows[0].id;
    const membership = randomUUID();
    await pool.query(
      "insert into suite.memberships(id,workspace_id,user_id) values($1,$2,$3)",
      [membership, workspace, viewer],
    );
    await pool.query(
      "insert into suite.role_assignments(workspace_id,membership_id,role_id) select $1,$2,id from suite.roles where workspace_id=$1 and name='Viewer'",
      [workspace, membership],
    );
    expect(
      (
        await employee.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "viewer@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    await page.reload();
    await selectValue(page, "Workspace", workspace);
    await publishExecutableFixture({
      id: moduleId,
      name,
      requiredPrefix: true,
    });
    expect(
      (
        await pool.query(
          "select count(*) from suite.module_activations where workspace_id=$1 and module_id=$2",
          [workspace, moduleId],
        )
      ).rows[0].count,
    ).toBe("0");
    await page.goto("/modules");
    const card = page
      .locator(".module-install-card")
      .filter({ has: page.getByRole("heading", { name, exact: true }) });
    await expect(card).toBeVisible();
    await expect(
      card.getByRole("button", { name: "Install", exact: true }),
    ).toBeDisabled();
    await card.getByRole("button", { name: "Configure", exact: true }).click();
    let dialog = page.getByRole("dialog", {
      name: `Configure ${name}`,
      exact: true,
    });
    await dialog.getByLabel("Prefix", { exact: true }).fill("Office: ");
    await dialog
      .getByRole("button", { name: "Validate and publish", exact: true })
      .click();
    await expect(
      dialog.getByText(
        "This module is not included in the workspace entitlement.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await pool.query(
      "insert into suite.entitlements(workspace_id,module_id,active) values($1,$2,true)",
      [workspace, moduleId],
    );
    const hidden = await (
      await employee.get(`/api/v1/workspaces/${workspace}/platform`)
    ).json();
    expect(hidden.modules.some((m: { id: string }) => m.id === moduleId)).toBe(
      false,
    );
    await page.reload();
    await card.getByRole("button", { name: "Configure", exact: true }).click();
    dialog = page.getByRole("dialog", {
      name: `Configure ${name}`,
      exact: true,
    });
    await expect(
      dialog.getByRole("button", { name: "Validate and publish", exact: true }),
    ).toBeDisabled();
    // UI validation cannot substitute for rejecting an invalid direct request.
    const invalidConfig = await page.request.patch(
      `/api/v1/workspaces/${workspace}/modules/${moduleId}`,
      {
        headers: {
          origin: "http://localhost:4300",
          "x-csrf-token": me.csrfToken,
        },
        data: { state: "enabled", accessPolicy: "admin", config: {} },
      },
    );
    expect(invalidConfig.status()).toBe(400);
    expect((await invalidConfig.json()).code).toBe("INVALID_INPUT");
    await dialog.getByLabel("Prefix", { exact: true }).fill("Office: ");
    await dialog
      .getByRole("button", { name: "Validate and publish", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      card.getByRole("button", { name: "Install", exact: true }),
    ).toBeDisabled();
    const visible = await (
      await employee.get(`/api/v1/workspaces/${workspace}/platform`)
    ).json();
    expect(visible.modules.some((m: { id: string }) => m.id === moduleId)).toBe(
      true,
    );

    for (const permission of ["members.manage", `${moduleId}.invented`]) {
      const invalid = await page.request.post(
        `/api/v1/workspaces/${workspace}/roles`,
        {
          headers: {
            origin: "http://localhost:4300",
            "x-csrf-token": me.csrfToken,
            "idempotency-key": randomUUID(),
          },
          data: { name: "Invalid permission", permissions: [permission] },
        },
      );
      expect(invalid.status()).toBe(400);
      expect((await invalid.json()).code).toBe("INVALID_PERMISSION");
    }

    await page
      .getByRole("link", { name: "People & access", exact: true })
      .click();
    await page.getByRole("tab", { name: "Roles", exact: true }).click();
    await page
      .getByRole("button", { name: "Create role", exact: true })
      .click();
    const role = page.getByRole("dialog");
    await role.getByLabel("Role name", { exact: true }).fill("Notes operator");
    for (const permission of ["notes.read", "notes.write", "capture"])
      await role
        .getByRole("checkbox", {
          name: `${moduleId}.${permission}`,
          exact: true,
        })
        .check();
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
    await member
      .getByRole("checkbox", { name: "Notes operator", exact: true })
      .check();
    await member.getByRole("checkbox", { name, exact: true }).check();
    await mkdir("docs/verification/module-activation", { recursive: true });
    await page.screenshot({
      path: "docs/verification/module-activation/member-assignment.png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const saveAccess = member.getByRole("button", {
      name: "Save access",
      exact: true,
    });
    await saveAccess.scrollIntoViewIfNeeded();
    await expect(saveAccess).toBeInViewport();
    await page.screenshot({
      path: "docs/verification/module-activation/member-assignment-narrow.png",
    });
    await saveAccess.click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(member).not.toBeVisible();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true })
      .click();
    const view = page.getByRole("region", {
      name: `${name} workspace`,
      exact: true,
    });
    await view
      .getByLabel("Note name", { exact: true })
      .fill("Ready for the team");
    await view.getByRole("button", { name: "Save note", exact: true }).click();
    await expect(
      view.getByText("Office: Ready for the team", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: "docs/verification/module-activation/activated-view.png",
    });
  } finally {
    await employee.dispose();
    await pool.end();
  }
});
