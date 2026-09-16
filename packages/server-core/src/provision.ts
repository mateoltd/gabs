import { storageContract, type ModuleDefinition } from "@suite/module-sdk";
import { found, requireCondition } from "./errors";
import { canonical, satisfies } from "@suite/module-sdk/registry";
import { bundledModuleIds, moduleDefinition } from "@suite/module-catalog";
import { randomUUID } from "node:crypto";
import { ROLE_PRESETS, DEFAULT_SERVICE_GRANTS } from "@suite/contracts";
import type { DB, Tx } from "./database";
import { inWorkspace } from "./database";
import { lockKey } from "./authorization";
import { sql } from "kysely";
export async function provisionWorkspace(
  tx: Tx,
  input: {
    id: string;
    userId: string;
    name: string;
    kind: "personal" | "company";
    currency?: string;
    requestId?: string;
    /** Trusted onboarding template; registry discovery never assigns modules. */
    modules?: readonly string[];
    /** Trusted host template override, never accepted from a client request. */
    moduleDefaults?: readonly ModuleDefinition[];
    serviceGrants?: readonly {
      source: string;
      target: string;
      services: readonly string[];
    }[];
  },
) {
  const selected = new Map(
    [...new Set(input.modules ?? bundledModuleIds)].map((id) => [
      id,
      found(
        input.moduleDefaults?.find((m) => m.id === id) ?? moduleDefinition(id),
      ),
    ]),
  );
  await tx
    .insertInto("suite.workspaces")
    .values({
      id: input.id,
      owner_user_id: input.userId,
      name: input.name,
      kind: input.kind,
      currency: input.currency ?? "EUR",
      offline_hours: 24,
    })
    .execute();
  const membershipId = randomUUID();
  await tx
    .insertInto("suite.memberships")
    .values({ id: membershipId, workspace_id: input.id, user_id: input.userId })
    .execute();
  for (const [name, permissions] of Object.entries(ROLE_PRESETS)) {
    const id = randomUUID();
    await tx
      .insertInto("suite.roles")
      .values({
        id,
        workspace_id: input.id,
        name,
        permissions: permissions.filter((permission) => {
          const module = [...selected.values()].find((m) =>
            permission.startsWith(m.id + "."),
          );
          return !module || module.permissions.includes(permission);
        }),
        protected: ["Owner", "Administrator"].includes(name),
      })
      .execute();
    if (name === "Owner")
      await tx
        .insertInto("suite.role_assignments")
        .values({
          workspace_id: input.id,
          membership_id: membershipId,
          role_id: id,
        })
        .execute();
  }
  for (const [moduleId, definition] of selected) {
    const schema = storageContract(definition);
    if (schema.version > 1) {
      await tx
        .insertInto("suite.module_storage")
        .values({
          workspace_id: input.id,
          module_id: moduleId,
          schema_version: schema.version,
          release_version: definition.version,
        })
        .execute();
      await tx
        .insertInto("suite.audit")
        .values({
          id: randomUUID(),
          workspace_id: input.id,
          actor_id: input.userId,
          action: "modules.storage.initialized",
          target_id: moduleId,
          request_id: input.requestId ?? input.id,
        })
        .execute();
    }
    await tx
      .insertInto("suite.entitlements")
      .values({
        workspace_id: input.id,
        module_id: moduleId,
        active: process.env.NODE_ENV !== "production",
      })
      .execute();
    await tx
      .insertInto("suite.module_activations")
      .values({
        workspace_id: input.id,
        module_id: moduleId,
        state: process.env.NODE_ENV === "production" ? "draft" : "enabled",
        access_policy: "admin",
        config: {},
      })
      .execute();
    await tx
      .insertInto("suite.module_assignments")
      .values({
        workspace_id: input.id,
        membership_id: membershipId,
        module_id: moduleId,
      })
      .execute();
  }
  for (const grant of input.serviceGrants ?? DEFAULT_SERVICE_GRANTS) {
    const source = selected.get(grant.source),
      target = selected.get(grant.target);
    if (!source || !target) continue;
    requireCondition(
      grant.services.length > 0 &&
        grant.services.every((name) => {
          const provider = target.operations[name];
          return (
            provider?.public &&
            Object.values(source.services ?? {}).some(
              (service) =>
                service.moduleId === target.id &&
                service.operation === name &&
                satisfies(target.version, service.version) &&
                canonical(service.contract) === canonical(provider),
            )
          );
        }),
      400,
      "INVALID_ONBOARDING_GRANT",
      "The trusted workspace template must grant matching declared public services.",
    );
    await tx
      .insertInto("suite.platform_settings")
      .values({
        workspace_id: input.id,
        key: `grant:${source.id}:${target.id}`,
        value: { services: [...grant.services] },
        version: 1,
      })
      .execute();
  }
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    currency: input.currency ?? "EUR",
  };
}
export async function identify(
  db: DB,
  input: {
    issuer: string;
    subject: string;
    email: string;
    name: string;
    emailVerified: boolean;
  },
) {
  return db.transaction().execute(async (tx) => {
    await lockKey(tx, `identity:${input.issuer}:${input.subject}`);
    let user = await tx
      .selectFrom("suite.users")
      .selectAll()
      .where("issuer", "=", input.issuer)
      .where("subject", "=", input.subject)
      .executeTakeFirst();
    if (!user) {
      user = await tx
        .insertInto("suite.users")
        .values({
          id: randomUUID(),
          issuer: input.issuer,
          subject: input.subject,
          email: input.email.toLowerCase(),
          name: input.name,
          email_verified: input.emailVerified,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const id = randomUUID();
      await sql`select set_config('app.workspace_id',${id},true)`.execute(tx);
      await provisionWorkspace(tx, {
        id,
        userId: user.id,
        name: "Personal workspace",
        kind: "personal",
      });
    } else {
      user = await tx
        .updateTable("suite.users")
        .set({
          name: input.name,
          email: input.email.toLowerCase(),
          email_verified: input.emailVerified,
        })
        .where("id", "=", user.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return user;
  });
}
