import { createHash } from "node:crypto";
import { sql } from "kysely";
import {
  assertSchema,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import {
  effectivePermissions,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import {
  BusinessCutoverSelectionSchema,
  BusinessCutoverCommandSchema,
  type BusinessCutoverSelection,
  type BusinessCutoverReview,
  type BusinessCutoverCommand,
} from "@suite/contracts";
import {
  authorize,
  lockWorkspace,
  type Context,
} from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { AppError, found, requireCondition } from "../errors";
import {
  resolveWorkspaceRelease,
  workspaceModule,
} from "../registry/module-releases";
import { stagedModuleServer } from "../registry/staged-module-server";
import {
  lockModuleStorage,
  moduleStorageVersions,
  invalidateStorageVersions,
} from "../persistence/module-storage";
import {
  migrateLegacyBusinessStorage,
  reconcileLegacyBusiness,
} from "./legacy-business-migration";
import type { InstalledModuleServer } from "../runtime/services";
import { audit } from "../persistence/transactions";
const ids = ["inventory", "orders"] as const;
const serviceNames = [
  "resolve-products",
  "reserve",
  "release",
  "consume",
] as const;

/** No pins, roles, records or executable migrations are changed by a review. */
export async function reviewBusinessCutover(
  tx: Tx,
  initial: Context,
  selection: BusinessCutoverSelection,
  servers: readonly InstalledModuleServer[],
): Promise<BusinessCutoverReview> {
  assertSchema(BusinessCutoverSelectionSchema, selection);
  const ctx = await authorize(
    tx,
    initial.actor,
    initial.workspaceId,
    initial.requestId,
    initial.runtime,
    "modules.manage",
  );
  const ws = ctx.workspaceId,
    storage = await moduleStorageVersions(tx, ws);
  const roles = await tx
    .selectFrom("suite.roles")
    .where("retired_at", "is", null)
    .select(["id", "name", "permissions"])
    .where("workspace_id", "=", ws)
    .orderBy("id")
    .execute();
  const settings = await tx
    .selectFrom("suite.platform_settings")
    .selectAll()
    .where("workspace_id", "=", ws)
    .orderBy("key")
    .execute();
  const policy = settings.find((r) => r.key === "organization")
    ?.value as unknown as OrganizationPolicy | undefined;
  const marker = settings.find(
    (r) => r.key === "business-storage-import",
  )?.value;
  const revision = await tx
    .selectFrom("suite.workspace_policy")
    .select("revision")
    .where("workspace_id", "=", ws)
    .executeTakeFirst();
  const issues: BusinessCutoverReview["issues"] = [];
  const add = (code: string, message: string) => issues.push({ code, message });
  const completed =
    marker?.state === "completed" && ids.every((id) => storage.get(id) === 2);
  if (completed)
    add(
      "BUSINESS_ALREADY_MIGRATED",
      "Orders and Inventory have already completed their coordinated upgrade.",
    );
  else if (marker || ids.some((id) => (storage.get(id) ?? 1) !== 1))
    add(
      "BUSINESS_MIGRATION_STATE",
      "Both modules must use their original storage before coordinated upgrade.",
    );
  if (!completed) {
    const privateData = await tx
      .selectFrom("suite.module_records")
      .select("id")
      .where("workspace_id", "=", ws)
      .where("module_id", "in", [...ids])
      .limit(1)
      .executeTakeFirst();
    if (privateData)
      add(
        "BUSINESS_IMPORT_NOT_EMPTY",
        "Existing private business records must be reconciled before upgrade.",
      );
  }
  const activations = await tx
    .selectFrom("suite.module_activations")
    .selectAll()
    .where("workspace_id", "=", ws)
    .where("module_id", "in", [...ids])
    .orderBy("module_id")
    .execute();
  const entitlements = await tx
    .selectFrom("suite.entitlements")
    .selectAll()
    .where("workspace_id", "=", ws)
    .where("module_id", "in", [...ids])
    .orderBy("module_id")
    .execute();
  const definitions = new Map<string, ModuleDefinition>();
  const releases: BusinessCutoverReview["releases"] = [];
  for (const id of ids) {
    try {
      const packages = await resolveWorkspaceRelease(
        tx,
        ws,
        id,
        false,
        selection[id],
        { inventory: selection.inventory, orders: selection.orders },
      );
      const pkg = found(packages.find((p) => p.module_id === id));
      const definition = hydrateModule(
        pkg.artifact as unknown as ModuleDefinition,
      );
      requireCondition(
        definition.storage?.version === 2 &&
          definition.storage.migrations["import-v1"]?.from === 1 &&
          definition.storage.migrations["import-v1"]?.to === 2,
        409,
        "BUSINESS_IMPORT_CONTRACT",
        "Choose business releases declaring the reviewed original-storage import.",
      );
      const backend = await stagedModuleServer(tx, definition, servers);
      requireCondition(
        backend?.kind === "scoped" &&
          canonical(backend.module) === canonical(definition),
        409,
        "BACKEND_UNAVAILABLE",
        "The exact reviewed scoped backend must be staged before upgrade.",
      );
      const source = await workspaceModule(tx, ws, id, ctx.runtime.catalog);
      definitions.set(id, definition);
      releases.push({
        moduleId: id,
        version: definition.version,
        digest: pkg.digest,
        permissions: [...definition.permissions],
        newPermissions: definition.permissions.filter(
          (p) => !source.permissions.includes(p),
        ),
      });
      const activation = activations.find((m) => m.module_id === id);
      requireCondition(
        activation?.state === "enabled" &&
          entitlements.some((e) => e.module_id === id && e.active),
        409,
        "MODULE_NOT_READY",
        `${definition.name} must be configured, published and entitled before upgrade.`,
      );
      assertSchema(definition.configuration, activation.config);
    } catch (error) {
      if (error instanceof AppError) add(error.code, `${id}: ${error.message}`);
      else
        add(
          "RELEASE_REVIEW_FAILED",
          `${id}: verify the signed release, staged backend and required configuration.`,
        );
    }
  }
  const allowedAdditions = new Set(releases.flatMap((r) => r.newPermissions));
  requireCondition(
    new Set(selection.roleGrants.map((r) => r.roleId.toLowerCase())).size ===
      selection.roleGrants.length,
    400,
    "INVALID_ROLE_GRANTS",
    "Choose each role once.",
  );
  for (const grant of selection.roleGrants) {
    requireCondition(
      roles.some((r) => r.id === grant.roleId.toLowerCase()),
      400,
      "INVALID_ROLE_GRANTS",
      "Choose a role in this workspace.",
    );
    requireCondition(
      grant.permissions.every(
        (p) =>
          allowedAdditions.has(p) ||
          roles
            .find((r) => r.id === grant.roleId.toLowerCase())!
            .permissions.includes(p),
      ),
      400,
      "INVALID_ROLE_GRANTS",
      "Only permissions introduced by these releases may be added during cutover.",
    );
  }
  const reviewedRoles = roles.map((role) => ({
    ...role,
    additions: (
      selection.roleGrants.find((g) => g.roleId.toLowerCase() === role.id)
        ?.permissions ?? []
    ).filter((p) => !role.permissions.includes(p)),
  }));
  if (reviewedRoles.some((r) => r.additions.length))
    requireCondition(
      ctx.permissions.includes("roles.manage"),
      403,
      "FORBIDDEN",
      "Role administration permission is required to add role permissions.",
    );
  const currentGrant = settings.find(
    (r) => r.key === "grant:orders:inventory",
  )?.value;
  const currentServices = Array.isArray(currentGrant?.services)
    ? currentGrant.services.filter((s): s is string => typeof s === "string")
    : [];
  const services: BusinessCutoverReview["services"] = [];
  for (const name of serviceNames) {
    const provider = definitions.get("inventory")?.operations[name];
    const reference = Object.values(
      definitions.get("orders")?.services ?? {},
    ).find((s) => s.moduleId === "inventory" && s.operation === name);
    if (
      !provider?.public ||
      !reference ||
      canonical(reference.contract) !== canonical(provider)
    ) {
      add(
        "SERVICE_CONTRACT_MISMATCH",
        `The selected releases must declare the matching ${name} inventory service.`,
      );
      continue;
    }
    const granted = currentServices.includes(name) || selection.grantServices;
    services.push({
      operation: name,
      permission: provider.permission,
      granted,
    });
    if (!granted)
      add(
        "GRANT_REQUIRED",
        `Explicitly grant Orders the ${name} service before cutover.`,
      );
  }
  const grants = Object.fromEntries(
    reviewedRoles.map((r) => [
      r.id,
      [...new Set([...r.permissions, ...r.additions])],
    ]),
  );
  const assignedRoles = await tx
    .selectFrom("suite.role_assignments")
    .select(["membership_id", "role_id"])
    .where("workspace_id", "=", ws)
    .execute();
  const assignments = await tx
    .selectFrom("suite.module_assignments")
    .select(["membership_id", "module_id"])
    .where("workspace_id", "=", ws)
    .where("module_id", "in", [...ids])
    .orderBy("module_id")
    .execute();
  const members = await tx
    .selectFrom("suite.memberships as m")
    .innerJoin("suite.users as u", "u.id", "m.user_id")
    .select(["m.id", "u.name"])
    .where("m.workspace_id", "=", ws)
    .where("m.active", "=", true)
    .where("u.active", "=", true)
    .orderBy("m.id")
    .execute();
  const restricted: BusinessCutoverReview["restrictedMembers"] = [];
  for (const member of members) {
    const assigned = assignedRoles
      .filter((r) => r.membership_id === member.id)
      .map((r) => r.role_id);
    const before = effectivePermissions(
      assigned,
      Object.fromEntries(roles.map((r) => [r.id, r.permissions])),
      policy,
    ).permissions;
    const after = effectivePermissions(assigned, grants, policy).permissions;
    const enabled = (id: string) =>
      assignments.some(
        (a) => a.membership_id === member.id && a.module_id === id,
      );
    const required = new Set<string>();
    if (enabled("inventory") && before.includes("inventory.read"))
      required.add("inventory.availability.read");
    if (enabled("inventory") && enabled("orders"))
      for (const [permission, operation] of [
        ["orders.create", "resolve-products"],
        ["orders.edit", "resolve-products"],
        ["orders.confirm", "reserve"],
        ["orders.cancel", "release"],
        ["orders.fulfill", "consume"],
      ])
        if (before.includes(permission)) {
          const service = services.find((s) => s.operation === operation);
          if (service) required.add(service.permission);
        }
    const missing = [...required].filter((p) => !after.includes(p));
    if (missing.length)
      restricted.push({ id: member.id, name: member.name, missing });
  }
  if (restricted.length)
    add(
      "PERMISSIONS_REQUIRED",
      `${restricted.length} assigned members would lose existing business actions. Review role additions and explicit denials before upgrade.`,
    );
  if (!completed) {
    try {
      await reconcileLegacyBusiness(tx, ws);
    } catch (error) {
      if (error instanceof AppError) add(error.code, error.message);
      else throw error;
    }
  }
  const count = (
    table: "suite.products" | "suite.orders" | "suite.stock_movements",
  ) =>
    tx
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("workspace_id", "=", ws)
      .executeTakeFirstOrThrow();
  const counts = {
    products: Number((await count("suite.products")).count),
    orders: Number((await count("suite.orders")).count),
    movements: Number((await count("suite.stock_movements")).count),
  };
  // This fingerprint detects stale reviewed choices; it never supplies authority.
  const token = createHash("sha256")
    .update(
      canonical({
        workspaceId: ws,
        actorId: ctx.actor.id,
        revision: revision?.revision ?? "0",
        storage: [...storage].sort(([a], [b]) => a.localeCompare(b)),
        releases,
        selection,
        roles: reviewedRoles,
        services,
        activations,
        entitlements,
        restricted,
      }),
    )
    .digest("hex");
  return {
    token,
    ready: issues.length === 0,
    completed,
    issues,
    releases,
    roles: reviewedRoles,
    services,
    restrictedMembers: restricted.slice(0, 100),
    restrictedCount: restricted.length,
    counts,
  };
}

/** Authority, reviewed grants and both migrations commit atomically, including on caught failures. */
export async function applyBusinessCutover(
  tx: Tx,
  initial: Context,
  input: BusinessCutoverCommand,
  servers: readonly InstalledModuleServer[],
) {
  assertSchema(BusinessCutoverCommandSchema, input);
  await lockModuleStorage(tx, initial.workspaceId, true);
  await lockWorkspace(tx, initial.workspaceId);
  const ctx = await authorize(
    tx,
    initial.actor,
    initial.workspaceId,
    initial.requestId,
    initial.runtime,
    "modules.manage",
  );
  const { reviewToken, ...selection } = input;
  const review = await reviewBusinessCutover(tx, ctx, selection, servers);
  requireCondition(
    review.token === reviewToken,
    409,
    "BUSINESS_REVIEW_STALE",
    "Workspace policy or release choices changed. Review the upgrade again.",
  );
  requireCondition(
    review.ready,
    409,
    "BUSINESS_NOT_READY",
    review.issues[0]?.message ??
      "Resolve the upgrade review before continuing.",
  );
  await sql`savepoint suite_business_cutover`.execute(tx);
  try {
    for (const role of review.roles) {
      if (!role.additions.length) continue;
      await tx
        .updateTable("suite.roles")
        .set({
          permissions: [...new Set([...role.permissions, ...role.additions])],
        })
        .where("workspace_id", "=", ctx.workspaceId)
        .where("id", "=", role.id)
        .execute();
      await audit(tx, ctx, "roles.business-upgrade.granted", role.id);
    }
    const current = await tx
      .selectFrom("suite.platform_settings")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("key", "=", "grant:orders:inventory")
      .executeTakeFirst();
    const services = Array.isArray(current?.value.services)
      ? current.value.services.filter((s): s is string => typeof s === "string")
      : [];
    if (
      selection.grantServices &&
      serviceNames.some((s) => !services.includes(s))
    ) {
      const value = {
        ...current?.value,
        source: "orders",
        target: "inventory",
        services: [...new Set([...services, ...serviceNames])],
      };
      await tx
        .insertInto("suite.platform_settings")
        .values({
          workspace_id: ctx.workspaceId,
          key: "grant:orders:inventory",
          value,
          version: 1,
        })
        .onConflict((oc) =>
          oc.columns(["workspace_id", "key"]).doUpdateSet((eb) => ({
            value,
            version: eb("suite.platform_settings.version", "+", 1),
          })),
        )
        .execute();
      await audit(
        tx,
        ctx,
        "modules.business-upgrade.services-granted",
        ctx.workspaceId,
      );
    }
    const result = await migrateLegacyBusinessStorage(
      tx,
      ctx,
      { inventory: selection.inventory, orders: selection.orders },
      servers,
    );
    await tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: ctx.workspaceId,
        key: "business-upgrade-review",
        value: {
          actorId: ctx.actor.id,
          selection,
          reviewToken,
          releases: review.releases,
          reviewedAt: new Date().toISOString(),
        },
        version: 1,
      })
      .execute();
    await sql`release savepoint suite_business_cutover`.execute(tx);
    return result;
  } catch (error) {
    try {
      await sql`rollback to savepoint suite_business_cutover`.execute(tx);
      await sql`release savepoint suite_business_cutover`.execute(tx);
    } catch {
      /* A disconnected transaction rolls back. */
    }
    invalidateStorageVersions(tx, ctx.workspaceId);
    throw error;
  }
}
