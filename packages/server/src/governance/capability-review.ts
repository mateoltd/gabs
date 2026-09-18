import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import {
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import type { CapabilityReview } from "@suite/module-sdk/capability-review";
import { found, requireCondition } from "../errors";
import type { Context } from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { resolveWorkspaceRelease } from "../registry/module-releases";

/** Review a verified release against the same saved policy used by execution. Never grants authority. */
export async function reviewModuleCapabilities(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  version?: string,
): Promise<CapabilityReview> {
  requireCondition(
    ctx.permissions.includes("modules.manage") ||
      ctx.permissions.includes("roles.manage"),
    403,
    "FORBIDDEN",
    "Your role does not allow module capability review.",
  );
  const pkg = found(
    (
      await resolveWorkspaceRelease(
        tx,
        ctx.workspaceId,
        moduleId,
        false,
        version,
      )
    ).find((p) => p.module_id === moduleId),
  );
  const module = hydrateModule(pkg.artifact as unknown as ModuleDefinition);
  const workspace = found(
    await tx
      .selectFrom("suite.workspaces")
      .select("offline_hours")
      .where("id", "=", ctx.workspaceId)
      .executeTakeFirst(),
  );
  const canReviewRoles = ctx.permissions.includes("roles.manage");
  const capabilities = Object.entries(module.capabilities ?? {}).map(
    ([name, declaration]) => ({
      name,
      kind: declaration.kind,
      permission: declaration.permission,
      offline: declaration.offline === "lease",
    }),
  );
  const result: CapabilityReview = {
    moduleId,
    version: module.version,
    digest: pkg.digest,
    reviewedAt: new Date().toISOString(),
    offlineHours: Math.min(workspace.offline_hours, 24),
    canReviewRoles,
    capabilities,
    roles: [],
  };
  if (!canReviewRoles) return result;
  const roles = await tx
    .selectFrom("suite.roles")
    .select(["id", "name", "permissions", "protected"])
    .where("workspace_id", "=", ctx.workspaceId)
    .orderBy("name")
    .execute();
  const stored = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("key", "=", "organization")
    .executeTakeFirst();
  const policy = stored?.value as unknown as OrganizationPolicy | undefined;
  const grants = Object.fromEntries(
    roles.map((role) => [role.id, role.permissions]),
  );
  const labels = new Map(
    roles.map((role) => [
      role.id,
      role.name === "Owner" ? "Administrador" : role.name,
    ]),
  );
  for (const rank of policy?.ranks ?? []) labels.set(rank.id, rank.name);
  const label = (source: string) => labels.get(source) ?? source;
  const permissions = [
    ...new Set(capabilities.map((capability) => capability.permission)),
  ];
  result.roles = roles.map((role) => {
    const effective = effectivePermissions([role.id], grants, policy);
    return {
      id: role.id,
      name: role.name,
      protected: role.protected,
      decisions: Object.fromEntries(
        permissions.map((permission) => [
          permission,
          {
            allowed: effective.permissions.includes(permission),
            grants: (effective.sources[permission]?.grants ?? []).map(label),
            denies: (effective.sources[permission]?.denies ?? []).map(label),
          },
        ]),
      ),
    };
  });
  return result;
}
