import {
  effectiveModulePolicies,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import type { ModuleCatalog } from "@suite/module-sdk/catalog";
import type { Tx } from "../persistence/database";
import { AppError } from "../errors";
import { workspaceDependencyIds } from "../registry/module-releases";

export async function organizationPolicy(tx: Tx, workspaceId: string) {
  const stored = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", workspaceId)
    .where("key", "=", "organization")
    .executeTakeFirst();
  return stored?.value as unknown as OrganizationPolicy | undefined;
}

/** Request-local dependency resolution is shared across member explanations. */
export function policyModuleSourceResolver(
  tx: Tx,
  workspaceId: string,
  catalog: ModuleCatalog,
  policy?: OrganizationPolicy,
) {
  const resolved = new Map<string, Promise<string[]>>();
  return async (roleIds: string[]) => {
    const roots = effectiveModulePolicies(roleIds, policy);
    const sources: Record<string, string[]> = Object.create(null);
    for (const [root, names] of Object.entries(roots)) {
      let pending = resolved.get(root);
      if (!pending) {
        pending = workspaceDependencyIds(tx, workspaceId, root, catalog).catch(
          (error) => {
            if (
              !(error instanceof AppError) ||
              ![400, 404, 409].includes(error.status)
            )
              throw error;
            // Keep the declared source explainable while its release is unavailable.
            return [root];
          },
        );
        resolved.set(root, pending);
      }
      for (const id of await pending)
        sources[id] = [...new Set([...(sources[id] ?? []), ...names])];
    }
    return sources;
  };
}

/** Materialized policy rows alone are never sufficient authority after a release change. */
export async function currentPolicyModules(
  tx: Tx,
  workspaceId: string,
  membershipId: string,
  catalog: ModuleCatalog,
) {
  const policy = await organizationPolicy(tx, workspaceId);
  const roles = await tx
    .selectFrom("suite.role_assignments")
    .select("role_id")
    .where("workspace_id", "=", workspaceId)
    .where("membership_id", "=", membershipId)
    .execute();
  return Object.keys(
    await policyModuleSourceResolver(
      tx,
      workspaceId,
      catalog,
      policy,
    )(roles.map((r) => r.role_id)),
  );
}
