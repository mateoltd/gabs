import { assertClientModuleVersion } from "../../../packages/server-core/src/client-module-version";
import { changeDeviceInstallation } from "../../../packages/server-core/src/module-installations";
import { migrateModuleStorage } from "../../../packages/server-core/src/module-migrations";
import {
  assertModuleStorage,
  lockModuleStorage,
} from "../../../packages/server-core/src/module-storage";
import { executeModuleOperation } from "../../../packages/server-core/src/module-services";
import { moduleServers } from "@suite/module-catalog/server";
import {
  resolveWorkspaceRelease,
  workspaceModule,
  workspaceBusinessPermissions,
  registeredModuleIds,
} from "../../../packages/server-core/src/module-releases";
import { readFile } from "node:fs/promises";
import { verifyPackage } from "../../../packages/module-sdk/node/signing";
import type { FastifyInstance } from "fastify";
import { Type as T, refreshModuleCatalog } from "@suite/contracts";
import { moduleDefinition, registerModule } from "@suite/module-catalog";
import {
  assertSchema,
  ValidationError,
  hydrateModule,
} from "@suite/module-sdk";
import {
  effectivePermissions,
  validateOrganization,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import {
  inWorkspace,
  authorize,
  idempotent,
  audit,
  found,
  requireCondition,
  lockWorkspace,
  type DB,
} from "@suite/server-core";
import {
  executeResource,
  type ResourceCommand,
} from "../../../packages/server-core/src/module-runtime";
const id = T.String({ format: "uuid" });
const slug = T.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
const params = T.Object({ workspaceId: id, moduleId: T.Optional(slug) });
const input = T.Object(
  {
    id: T.Optional(id),
    data: T.Optional(T.Record(T.String(), T.Unknown())),
    baseVersion: T.Optional(T.Integer({ minimum: 1 })),
    baseData: T.Optional(T.Record(T.String(), T.Unknown())),
    search: T.Optional(T.String({ maxLength: 100 })),
    cursor: T.Optional(id),
    limit: T.Optional(T.Integer({ minimum: 1, maximum: 100 })),
    archived: T.Optional(T.Boolean()),
  },
  { additionalProperties: false },
);
const moduleHeaders = T.Object(
  {
    "x-module-version": T.Optional(
      T.String({
        minLength: 1,
        maxLength: 40,
        pattern: "^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$",
      }),
    ),
  },
  { additionalProperties: true },
);
const strings = T.Array(T.String({ maxLength: 200 }), {
  maxItems: 500,
  uniqueItems: true,
});
const OrganizationSchema = T.Object(
  {
    rootId: id,
    ranks: T.Array(
      T.Object(
        {
          id,
          name: T.String({ minLength: 1, maxLength: 100 }),
          parents: T.Array(id, { maxItems: 100, uniqueItems: true }),
          inherit: T.Boolean(),
          denies: strings,
          x: T.Number(),
          y: T.Number(),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
    groups: T.Array(
      T.Object(
        {
          id,
          name: T.String({ minLength: 1, maxLength: 100 }),
          rankIds: T.Array(id, { maxItems: 500, uniqueItems: true }),
          tags: strings,
          grants: strings,
          denies: strings,
        },
        { additionalProperties: false },
      ),
      { maxItems: 100 },
    ),
  },
  { additionalProperties: false },
);
export async function registerPlatform(app: FastifyInstance, db: DB) {
  const publicKey = async () =>
    process.env.MODULE_SIGNING_PUBLIC_KEY ??
    (await readFile(
      `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
      "utf8",
    ));
  const releasesAtStartup = await db
    .selectFrom("suite.module_releases")
    .selectAll()
    .execute();
  for (const release of releasesAtStartup) {
    if (moduleDefinition(release.module_id)) continue;
    verifyPackage(release, await publicKey());
    registerModule(
      hydrateModule(
        release.artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
      ),
    );
  }
  refreshModuleCatalog();
  app.post<{
    Params: { workspaceId: string; moduleId: string; operationName: string };
    Body: unknown;
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/operations/:operationName",
    {
      schema: {
        operationId: "moduleOperation",
        headers: moduleHeaders,
        params: T.Object({
          workspaceId: id,
          moduleId: slug,
          operationName: slug,
        }),
        body: T.Unknown(),
      },
    },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const definition = await workspaceModule(
          tx,
          req.params.workspaceId,
          req.params.moduleId,
        );
        const operation = found(
          definition.operations[req.params.operationName],
        );
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          operation.permission,
          definition.id,
        );
        assertClientModuleVersion(definition, req.headers["x-module-version"]);
        requireCondition(
          operation.policy !== "local",
          400,
          "LOCAL_ONLY",
          "This operation belongs to a local workspace.",
        );
        assertSchema(operation.input, req.body);
        return idempotent(
          tx,
          ctx,
          req.headers["idempotency-key"] as string | undefined,
          `${definition.id}.${req.params.operationName}`,
          req.headers["x-module-version"] === undefined
            ? req.body
            : {
                moduleVersion: req.headers["x-module-version"],
                input: req.body,
              },
          () =>
            executeModuleOperation(
              tx,
              ctx,
              definition,
              req.params.operationName,
              req.body,
              moduleServers,
            ),
        );
      }),
  );
  app.get<{
    Params: {
      workspaceId: string;
      moduleId: string;
      resource: string;
      field: string;
    };
    Querystring: { cursor?: string; search?: string };
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/members/:resource/:field",
    {
      schema: {
        operationId: "moduleMembers",
        headers: moduleHeaders,
        params: T.Object({
          workspaceId: id,
          moduleId: slug,
          resource: slug,
          field: T.String({ maxLength: 100 }),
        }),
        querystring: T.Object({
          cursor: T.Optional(id),
          search: T.Optional(T.String({ maxLength: 100 })),
        }),
      },
    },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          `${req.params.moduleId}.${req.params.resource}.read`,
          req.params.moduleId,
        );
        const module = await workspaceModule(
          tx,
          ctx.workspaceId,
          req.params.moduleId,
        );
        assertClientModuleVersion(module, req.headers["x-module-version"]);
        const resource = found(module.resources[req.params.resource]);
        requireCondition(
          resource.schema.properties?.[req.params.field]?.["x-membership"],
          400,
          "INVALID_MEMBER_FIELD",
          "The module must declare a workspace-member field.",
        );
        let query = tx
          .selectFrom("suite.memberships as m")
          .innerJoin("suite.users as u", "u.id", "m.user_id")
          .select(["m.id", "u.name"])
          .where("m.workspace_id", "=", ctx.workspaceId)
          .where("m.active", "=", true)
          .where("u.active", "=", true)
          .orderBy("m.id");
        if (req.query.cursor)
          query = query.where("m.id", ">", req.query.cursor);
        if (req.query.search)
          query = query.where(
            "u.name",
            "ilike",
            `%${req.query.search.replace(/[\\%_]/g, "\\$&")}%`,
          );
        const rows = await query.limit(101).execute();
        return {
          items: rows.slice(0, 100),
          nextCursor: rows.length > 100 ? rows[99].id : null,
        };
      }),
  );
  app.get(
    "/api/v1/module-trust",
    { schema: { operationId: "moduleTrust" } },
    async () => ({ publicKey: await publicKey() }),
  );
  app.get<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId/platform",
    { schema: { operationId: "platformState", params } },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
        );
        const settings = await tx
          .selectFrom("suite.platform_settings")
          .selectAll()
          .where("workspace_id", "=", ctx.workspaceId)
          .execute();
        const roles = await tx
          .selectFrom("suite.roles")
          .select(["id", "name", "permissions", "protected"])
          .where("workspace_id", "=", ctx.workspaceId)
          .execute();
        const owner = found(roles.find((r) => r.name === "Owner"));
        const org = settings.find((s) => s.key === "organization");
        const policy: OrganizationPolicy = org
          ? (org.value as unknown as OrganizationPolicy)
          : {
              rootId: owner.id,
              ranks: roles.map((r, i) => ({
                id: r.id,
                name: r.id === owner.id ? "Administrador" : r.name,
                parents: r.id === owner.id ? [] : [owner.id],
                inherit: false,
                denies: [],
                x: 80 + i * 180,
                y: r.id === owner.id ? 50 : 190,
              })),
              groups: [],
            };
        for (const role of roles)
          if (!policy.ranks.some((r) => r.id === role.id))
            policy.ranks.push({
              id: role.id,
              name: role.name,
              parents: [owner.id],
              inherit: false,
              denies: [],
              x: 80,
              y: 190,
            });
        const installs = await tx
          .selectFrom("suite.module_installations")
          .selectAll()
          .where("workspace_id", "=", ctx.workspaceId)
          .where("user_id", "=", ctx.actor.id)
          .execute();
        const activations = await tx
          .selectFrom("suite.module_activations")
          .selectAll()
          .where("workspace_id", "=", ctx.workspaceId)
          .execute();
        const admin = ctx.permissions.includes("modules.manage");
        // Include releases published after server startup; executable client-only
        // modules require neither a host rebuild nor a server restart.
        const candidates = await registeredModuleIds(tx);
        const definitions = await Promise.all(
          candidates
            .filter(
              (m) =>
                admin ||
                ctx.permissions.includes("roles.manage") ||
                activations.some(
                  (a) => a.module_id === m && a.state === "enabled",
                ),
            )
            .map((m) => workspaceModule(tx, ctx.workspaceId, m)),
        );
        for (const definition of definitions)
          if (!moduleDefinition(definition.id)) registerModule(definition);
        refreshModuleCatalog();
        const releases = await tx
          .selectFrom("suite.module_releases")
          .select([
            "module_id",
            "version",
            "manifest",
            "digest",
            "signature",
            "key_id",
          ])
          .execute();
        return {
          modules: definitions,
          storage: await tx
            .selectFrom("suite.module_storage")
            .select(["module_id", "schema_version", "release_version"])
            .where("workspace_id", "=", ctx.workspaceId)
            .execute(),
          installations: installs,
          releases: releases.filter((r) =>
            definitions.some((m) => m.id === r.module_id),
          ),
          organization: ctx.permissions.includes("roles.manage")
            ? { ...policy, version: org?.version ?? 0 }
            : null,
          roles: ctx.permissions.includes("roles.manage") ? roles : [],
          settings: settings.filter(
            (s) =>
              !s.key.startsWith("secret:") &&
              (admin ||
                ["appearance", "store-policy"].includes(s.key) ||
                s.key.startsWith("pin:")),
          ),
          config: admin
            ? activations.map((a) => ({
                moduleId: a.module_id,
                config: a.config,
              }))
            : [],
          permissionSources: effectivePermissions(
            roles
              .filter((r) => ctx.roleNames.includes(r.name))
              .map((r) => r.id),
            Object.fromEntries(roles.map((r) => [r.id, r.permissions])),
            policy,
          ).sources,
        };
      }),
  );
  app.post<{
    Params: { workspaceId: string; moduleId: string };
    Body: ResourceCommand;
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/records",
    {
      schema: {
        operationId: "moduleRequest",
        headers: moduleHeaders,
        params,
        body: T.Object(
          {
            action: T.Union(
              ["list", "get", "create", "update", "archive"].map((v) =>
                T.Literal(v),
              ),
            ),
            resource: slug,
            input,
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          `${req.params.moduleId}.${req.body.resource}.${["list", "get"].includes(req.body.action) ? "read" : "write"}`,
          req.params.moduleId,
        );
        const clientVersion = req.headers["x-module-version"];
        const definition =
          clientVersion === undefined
            ? undefined
            : await workspaceModule(tx, ctx.workspaceId, req.params.moduleId);
        if (definition) assertClientModuleVersion(definition, clientVersion);
        const execute = async () => {
          try {
            return await executeResource(
              tx,
              ctx,
              req.params.moduleId,
              req.body,
              definition,
            );
          } catch (e) {
            if (e instanceof ValidationError) {
              requireCondition(false, 400, "INVALID_INPUT", e.message);
            }
            throw e;
          }
        };
        if (["list", "get"].includes(req.body.action)) return execute();
        return idempotent(
          tx,
          ctx,
          req.headers["idempotency-key"] as string | undefined,
          `${req.params.moduleId}.${req.body.resource}.${req.body.action}`,
          clientVersion === undefined
            ? req.body
            : { moduleVersion: clientVersion, input: req.body },
          execute,
        );
      }),
  );
  app.post<{
    Params: { workspaceId: string };
    Body: { action: string; value: Record<string, unknown>; version?: number };
  }>(
    "/api/v1/workspaces/:workspaceId/platform",
    {
      schema: {
        operationId: "platformCommand",
        params,
        body: T.Object(
          {
            action: T.Union(
              [
                "organization",
                "store-policy",
                "grant",
                "appearance",
                "install",
                "uninstall",
                "migrate",
                "pin",
              ].map((v) => T.Literal(v)),
            ),
            value: T.Record(T.String(), T.Unknown()),
            version: T.Optional(T.Integer({ minimum: 0 })),
          },
          { additionalProperties: false },
        ),
      },
    },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const permission =
          req.body.action === "organization"
            ? "roles.manage"
            : req.body.action === "install" || req.body.action === "uninstall"
              ? undefined
              : req.body.action === "appearance"
                ? "workspace.manage"
                : "modules.manage";
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          permission,
        );
        await lockModuleStorage(
          tx,
          ctx.workspaceId,
          req.body.action === "migrate",
        );
        if (req.body.action === "install" || req.body.action === "uninstall")
          return changeDeviceInstallation(
            tx,
            ctx,
            req.body.action,
            req.body.value,
            req.headers["idempotency-key"] as string | undefined,
            moduleServers,
          );
        return idempotent(
          tx,
          ctx,
          req.headers["idempotency-key"] as string | undefined,
          `platform.${req.body.action}`,
          req.body,
          async () => {
            await lockWorkspace(tx, ctx.workspaceId);
            const value = req.body.value;
            if (req.body.action === "migrate") {
              assertSchema(
                T.Object(
                  {
                    moduleId: slug,
                    version: T.String({ minLength: 1, maxLength: 40 }),
                  },
                  { additionalProperties: false },
                ),
                value,
              );
              return migrateModuleStorage(
                tx,
                ctx,
                value.moduleId,
                value.version,
                moduleServers,
              );
            }
            let key = "";
            if (req.body.action === "organization") {
              assertSchema(OrganizationSchema, value);
              const policy = value as unknown as OrganizationPolicy;
              try {
                validateOrganization(policy);
              } catch (e) {
                requireCondition(
                  false,
                  400,
                  "INVALID_ORGANIZATION",
                  (e as Error).message,
                );
              }
              const roles = await tx
                .selectFrom("suite.roles")
                .select(["id", "name"])
                .where("workspace_id", "=", ctx.workspaceId)
                .execute();
              const owner = found(roles.find((r) => r.name === "Owner"));
              requireCondition(
                policy.rootId === owner.id &&
                  policy.ranks.length === roles.length &&
                  policy.ranks.every((r) =>
                    roles.some((role) => role.id === r.id),
                  ),
                400,
                "INVALID_RANKS",
                "The chart must include every workspace role and preserve the administrator root.",
              );
              const requested = [
                ...policy.ranks.flatMap((r) => r.denies),
                ...policy.groups.flatMap((g) => [...g.grants, ...g.denies]),
              ];
              const businessPermissions = await workspaceBusinessPermissions(
                tx,
                ctx.workspaceId,
              );
              requireCondition(
                requested.every(
                  (p) =>
                    ctx.permissions.includes(p) ||
                    businessPermissions.includes(p),
                ),
                403,
                "DELEGATION_FORBIDDEN",
                "You may administer registered business permissions and platform permissions you hold.",
              );
              key = "organization";
            } else if (req.body.action === "grant") {
              assertSchema(
                T.Object(
                  {
                    source: slug,
                    target: slug,
                    read: T.Boolean(),
                    services: T.Optional(
                      T.Array(slug, { maxItems: 100, uniqueItems: true }),
                    ),
                  },
                  { additionalProperties: false },
                ),
                value,
              );
              const source = await workspaceModule(
                tx,
                ctx.workspaceId,
                value.source,
              );
              requireCondition(
                value.target in source.dependencies,
                400,
                "UNDECLARED_DEPENDENCY",
                "The module must declare this dependency.",
              );
              const target = await workspaceModule(
                tx,
                ctx.workspaceId,
                value.target,
              );
              requireCondition(
                (value.services ?? []).every(
                  (name) => target.operations[name]?.public,
                ),
                400,
                "INVALID_SERVICE_GRANT",
                "Only declared public services may be granted.",
              );
              key = `grant:${value.source}:${value.target}`;
            } else if (req.body.action === "store-policy") {
              assertSchema(
                T.Object(
                  {
                    mode: T.Union([
                      T.Literal("free"),
                      T.Literal("approval"),
                      T.Literal("blocked"),
                    ]),
                  },
                  { additionalProperties: false },
                ),
                value,
              );
              key = "store-policy";
            } else if (req.body.action === "pin") {
              assertSchema(
                T.Object(
                  {
                    moduleId: slug,
                    version: T.String({ maxLength: 40 }),
                    mandatory: T.Boolean(),
                  },
                  { additionalProperties: false },
                ),
                value,
              );
              requireCondition(
                (await registeredModuleIds(tx)).includes(value.moduleId),
                404,
                "NOT_FOUND",
                "This module is not registered.",
              );
              if (value.version) {
                const release = await tx
                  .selectFrom("suite.module_releases")
                  .select("version")
                  .where("module_id", "=", value.moduleId)
                  .where("version", "=", value.version)
                  .executeTakeFirst();
                requireCondition(
                  release,
                  400,
                  "RELEASE_UNAVAILABLE",
                  "Publish this signed version before pinning it.",
                );
              }
              key = `pin:${value.moduleId}`;
            } else {
              assertSchema(
                T.Object(
                  {
                    archetype: T.Union(
                      [
                        "modern-dark",
                        "chromatic-playful",
                        "executive-serious",
                        "classic-retro",
                        "neumorphic-soft",
                        "minimal-clean",
                        "industrial-technical",
                        "glassmorphic-luxe",
                        "editorial-paper",
                        "material-expressive",
                      ].map((v) => T.Literal(v)),
                    ),
                  },
                  { additionalProperties: false },
                ),
                value,
              );
              key = "appearance";
            }
            const old = await tx
              .selectFrom("suite.platform_settings")
              .select("version")
              .where("workspace_id", "=", ctx.workspaceId)
              .where("key", "=", key)
              .executeTakeFirst();
            requireCondition(
              (old?.version ?? 0) === (req.body.version ?? 0),
              412,
              "VERSION_CONFLICT",
              "Settings changed. Reload before saving.",
            );
            await tx
              .insertInto("suite.platform_settings")
              .values({
                workspace_id: ctx.workspaceId,
                key,
                value,
                version: (old?.version ?? 0) + 1,
              })
              .onConflict((oc) =>
                oc
                  .columns(["workspace_id", "key"])
                  .doUpdateSet({ value, version: (old?.version ?? 0) + 1 }),
              )
              .execute();
            if (req.body.action === "pin") {
              const active = await tx
                .selectFrom("suite.module_activations")
                .select("module_id")
                .where("workspace_id", "=", ctx.workspaceId)
                .where("state", "=", "enabled")
                .execute();
              const pinnedModuleId = String(
                (value as Record<string, unknown>).moduleId,
              );
              const modules = new Set([
                pinnedModuleId,
                ...active.map((m) => m.module_id),
              ]);
              for (const moduleId of modules) {
                const plan = await resolveWorkspaceRelease(
                  tx,
                  ctx.workspaceId,
                  moduleId,
                );
                if (
                  !plan.some((release) => release.module_id === pinnedModuleId)
                )
                  continue;
                for (const release of plan) {
                  await assertModuleStorage(
                    tx,
                    ctx.workspaceId,
                    hydrateModule(
                      release.artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
                    ),
                  );
                  const selected = await workspaceModule(
                    tx,
                    ctx.workspaceId,
                    release.module_id,
                  );
                  requireCondition(
                    selected.version === release.version,
                    409,
                    "DEPENDENCY_POLICY_CONFLICT",
                    `${moduleId} requires ${release.module_id}@${release.version}, but the workspace selects ${selected.version}. Choose compatible version pins.`,
                  );
                }
              }
            }
            await audit(tx, ctx, `platform.${req.body.action}`, key);
            return { ok: true };
          },
        );
      }),
  );
  app.get<{ Params: { workspaceId: string; moduleId: string } }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/artifact",
    { schema: { operationId: "moduleArtifact", params } },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          undefined,
          req.params.moduleId,
        );
        const module = await workspaceModule(
          tx,
          ctx.workspaceId,
          req.params.moduleId,
        );
        const release = found(
          (await resolveWorkspaceRelease(tx, ctx.workspaceId, module.id)).find(
            (p) => p.module_id === module.id,
          ),
        );
        verifyPackage(release, await publicKey());
        await audit(tx, ctx, "modules.downloaded", module.id);
        return release;
      }),
  );
}
