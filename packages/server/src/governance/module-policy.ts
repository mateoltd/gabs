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

export interface ModulePolicyIntents {
  byMember: Map<string, Set<string>>;
  roots: Set<string>;
}
/** Capture accepted intent before changing the policy or role membership. */
export async function modulePolicyIntents(
  tx: Tx,
  workspaceId: string,
): Promise<ModulePolicyIntents> {
  const policy = await organizationPolicy(tx, workspaceId);
  const rows = await tx
    .selectFrom("suite.role_assignments as r")
    .innerJoin("suite.memberships as m", (j) =>
      j
        .onRef("m.id", "=", "r.membership_id")
        .onRef("m.workspace_id", "=", "r.workspace_id"),
    )
    .select(["r.membership_id", "r.role_id"])
    .where("r.workspace_id", "=", workspaceId)
    .where("m.active", "=", true)
    .execute();
  const roles = new Map<string, string[]>();
  for (const row of rows)
    roles.set(row.membership_id, [
      ...(roles.get(row.membership_id) ?? []),
      row.role_id,
    ]);
  return {
    byMember: new Map(
      [...roles].map(([id, ids]) => [
        id,
        new Set(Object.keys(effectiveModulePolicies(ids, policy))),
      ]),
    ),
    roots: new Set(
      [...(policy?.groups ?? []), ...(policy?.tags ?? [])].flatMap(
        (source) => source.modules ?? [],
      ),
    ),
  };
}
