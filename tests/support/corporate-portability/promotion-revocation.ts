import {
  expect,
  request,
  type APIRequestContext,
  type ElectronApplication,
} from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { operations } from "../../../packages/client/src/api";
import type { RestorationContext } from "./journey";
import { portabilityStorage } from "./devices";
import { holdServerReply } from "./server-reply";
import { captureArchive } from "./archives";
import { selectValue } from "../../e2e/controls.helpers";

type Members =
  operations["members"]["responses"][200]["content"]["application/json"];
type Roles =
  operations["roles"]["responses"][200]["content"]["application/json"];

/** Revoke a normal role through public administration while a real settlement reply waits. */
export async function promotionRevocation(
  context: RestorationContext,
  options: {
    api: APIRequestContext;
    surface: string;
    app?: ElectronApplication;
  },
) {
  const { page, scope, input } = context;
  if (input.selection !== "request") throw Error("A request is required.");
  const dialog = () =>
    page.getByRole("dialog", { name: "Imported saved work", exact: true });
  await dialog()
    .getByRole("button", { name: "Back to imported copies", exact: true })
    .click();
  await dialog()
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  const base = `/api/v1/workspaces/${scope.workspaceId}`;
  const me = await (await options.api.get("/api/v1/me")).json();
  const headers = {
    origin: "http://localhost:4300",
    "x-csrf-token": me.csrfToken,
  };
  const members: Members = await (
    await options.api.get(`${base}/members`)
  ).json();
  const original = members.find((member) => member.userId === scope.userId)!;
  expect(original).toBeDefined();
  const owner = original.roles.find((role) => role.name === "Owner")!;
  expect(owner).toBeDefined();
  const invited = await options.api.post(`${base}/invitations`, {
    headers: { ...headers, "idempotency-key": randomUUID() },
    data: { email: "sales@demo.local", roleId: owner.id },
  });
  expect(invited.ok(), await invited.text()).toBe(true);
  const invitation = await invited.json();
  const admin = await request.newContext({ baseURL: "http://localhost:4310" });
  let assigned = false;
  let adminHeaders: Record<string, string> = {};
  const originalMember = {
    active: original.active,
    roleIds: original.roles.map((role) => role.id),
    modules: original.modules,
  };
  try {
    expect(
      (
        await admin.post("/auth/development", {
          headers: { origin: "http://localhost:4300" },
          data: { email: "sales@demo.local" },
        })
      ).ok(),
    ).toBe(true);
    const administrator = await (await admin.get("/api/v1/me")).json();
    adminHeaders = {
      origin: "http://localhost:4300",
      "x-csrf-token": administrator.csrfToken,
    };
    const accepted = await admin.post(
      `/api/v1/invitations/${invitation.id}/accept`,
      {
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        data: {},
      },
    );
    expect(accepted.ok(), await accepted.text()).toBe(true);
    const permissions = owner.permissions.filter((permission) =>
      ["contacts.", "projects.", "orders.", "inventory."].some((prefix) =>
        permission.startsWith(prefix),
      ),
    );
    expect(permissions).toContain("contacts.contacts.write");
    const roleName = "Recovery operator";
    const created = await admin.post(`${base}/roles`, {
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      data: { name: roleName, permissions },
    });
    expect(created.ok(), await created.text()).toBe(true);
    const role: Roles[number] = await created.json();

    // Preserve a real unrelated local draft before changing the recovering actor's role.
    await page.getByRole("link", { name: "Projects", exact: true }).click();
    await page
      .getByRole("button", { name: "New projects", exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Preserved during permission changes");
    await selectValue(page, "Status", "planned");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page
      .getByRole("navigation", { name: "Preferences", exact: true })
      .getByRole("link", { name: "Settings", exact: true })
      .click();
    await expect
      .poll(async () =>
        Object.values((await portabilityStorage(page, scope)).drafts),
      )
      .toContainEqual(
        expect.objectContaining({
          name: "Preserved during permission changes",
        }),
      );
    const changed = await admin.patch(`${base}/members/${original.id}`, {
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      data: {
        revision: original.revision,
        active: true,
        roleIds: [role.id],
        modules: ["contacts", "projects", "orders", "inventory"],
      },
    });
    expect(changed.ok(), await changed.text()).toBe(true);
    assigned = true;
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
    await section()
      .getByRole("button", { name: "Restore for review", exact: true })
      .click();
    const gate = await holdServerReply(
      page,
      `/api/v1/module/${input.entry.call.moduleId}/workspaces/${scope.workspaceId}/attempts/settle`,
      options.app,
    );
    try {
      await dialog()
        .getByRole("button", { name: "Confirm restoration", exact: true })
        .click();
      await gate.arrived();
      const denied = await admin.put(`${base}/roles/${role.id}`, {
        headers: { ...adminHeaders, "idempotency-key": randomUUID() },
        data: {
          name: roleName,
          permissions: permissions.filter(
            (permission) => permission !== "contacts.contacts.write",
          ),
        },
      });
      expect(denied.ok(), await denied.text()).toBe(true);
      await gate.release();
      await expect(refresh()).toBeEnabled();
      await expect(dialog().getByRole("alert").first()).toBeVisible();
      await expect(dialog()).not.toContainText(
        "Saved work restored for review.",
      );
      await expect(
        dialog().getByRole("button", {
          name: "Restore for review",
          exact: true,
        }),
      ).toHaveCount(0);
      const deniedState = await portabilityStorage(page, scope);
      expect(deniedState.recoveryImports).toEqual(before.recoveryImports);
      expect(deniedState.journal).toEqual(before.journal);
      expect(deniedState.drafts).toEqual(before.drafts);
      await captureArchive(
        page,
        `${options.surface}-promotion-permission-denied`,
        false,
      );
      // An explicit refresh under the same denial still cannot restore anything.
      await refresh().click();
      await expect(refresh()).toBeEnabled();
      await expect(
        dialog().getByRole("button", {
          name: "Restore for review",
          exact: true,
        }),
      ).toHaveCount(0);
      expect((await portabilityStorage(page, scope)).recoveryImports).toEqual(
        before.recoveryImports,
      );
    } finally {
      await gate.dispose();
    }
    const granted = await admin.put(`${base}/roles/${role.id}`, {
      headers: { ...adminHeaders, "idempotency-key": randomUUID() },
      data: { name: roleName, permissions },
    });
    expect(granted.ok(), await granted.text()).toBe(true);
    await refresh().click();
    await expect(
      section().getByRole("button", {
        name: "Restore for review",
        exact: true,
      }),
    ).toBeEnabled();
    expect(
      (await portabilityStorage(page, scope)).recoveryImports![digest]
        .promotion,
    ).toBeUndefined();
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
    const after = await portabilityStorage(page, scope);
    expect(after.recoveryImports![digest].input).toEqual(input);
    expect(after.recoveryImports![digest].promotion).toMatchObject({
      requestId: input.entry.id,
      outcome: "cancelled",
    });
    expect(after.drafts).toEqual(before.drafts);
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
    await captureArchive(
      page,
      `${options.surface}-promotion-permission-restored`,
      false,
    );
  } finally {
    try {
      if (assigned) {
        const restored = await admin.patch(`${base}/members/${original.id}`, {
          headers: { ...adminHeaders, "idempotency-key": randomUUID() },
          data: {
            ...originalMember,
            revision: (
              (await (await admin.get(`${base}/members`)).json()) as Members
            ).find((member) => member.id === original.id)!.revision,
          },
        });
        expect(restored.ok(), await restored.text()).toBe(true);
      }
    } finally {
      await admin.dispose();
    }
  }
  // Restoring the original role is another policy change; reopen its copies explicitly.
  await dialog()
    .getByRole("button", { name: "Refresh imported copies", exact: true })
    .click();
  await expect(
    dialog().getByRole("button", { name: "Restore for review", exact: true }),
  ).toHaveCount(1);
  await expect(
    dialog().getByRole("button", {
      name: "Refresh imported copies",
      exact: true,
    }),
  ).toBeEnabled();
  return page;
}
