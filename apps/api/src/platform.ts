import { CapabilityReviewSchema } from "@suite/module-sdk/capability-review";
import { reviewModuleCapabilities } from "@suite/server-core/governance/capability-review";
import { HostAuthorizationSchema } from "@suite/module-sdk/host-capabilities";
import {
  CapabilityLeaseSchema,
  CapabilityLeaseAuthoritySchema,
} from "@suite/module-sdk/capability-leases";
import {
  issueCapabilityLease,
  prepareCapabilityLease,
  capabilityLeaseKey,
} from "@suite/server-core/identity/capability-leases";
import AjvCompiler from "@fastify/ajv-compiler";
import { resourceListSchema } from "@suite/module-sdk/queries";
import { listModuleReferences } from "@suite/server-core/runtime/references";
import {
  ReferenceQuerySchema,
  type ReferenceQuery,
} from "@suite/module-sdk/references";
import {
  reviewBusinessCutover,
  applyBusinessCutover,
} from "@suite/server-core/governance/business-cutover";
import {
  BusinessCutoverSelectionSchema,
  BusinessCutoverReviewSchema,
  BusinessCutoverCommandSchema,
  type BusinessCutoverSelection,
} from "@suite/contracts";
import {
  recordInstallationReport,
  moduleFleet,
} from "@suite/server-core/registry/installation-reports";
import {
  InstallationReportSchema,
  type InstallationReport,
  ModuleRolloutSchema,
} from "@suite/module-sdk/platform";
import {
  clientModule,
  receiptContract,
  compatibleClientRelease,
  validateConfiguredRollouts,
} from "@suite/server-core/registry/module-rollout";
import { changeDeviceInstallation } from "@suite/server-core/registry/module-installations";
import { migrateModuleStorage } from "@suite/server-core/persistence/module-migrations";
import {
  assertModuleStorage,
  lockModuleStorage,
} from "@suite/server-core/persistence/module-storage";
import { executeModuleOperation } from "@suite/server-core/runtime/services";
import { moduleServers } from "@suite/module-catalog/server";
import {
  resolveWorkspaceRelease,
  workspaceModule,
  workspaceBusinessPermissions,
  registeredModuleIds,
} from "@suite/server-core/registry/module-releases";
import { readFile } from "node:fs/promises";
import { verifyPackage } from "@suite/module-sdk/node/signing";
import type { FastifyInstance } from "fastify";
import { Type as T, type Permission, type ModuleId } from "@suite/contracts";
import { refreshProductPreset } from "@suite/module-catalog/presets";
import {
  assertSchema,
  ValidationError,
  hydrateModule,
} from "@suite/module-sdk";
import type { MutableModuleCatalog } from "@suite/module-sdk/catalog";
import {
  effectivePermissions,
  validateOrganization,
  type OrganizationPolicy,
} from "@suite/module-sdk/governance";
import {
  inWorkspace,
  authorize as authorizeWithRuntime,
  idempotent,
  audit,
  found,
  requireCondition,
  lockWorkspace,
  type DB,
  type Tx,
  type Actor,
  type ServerRuntime,
} from "@suite/server-core";
import {
  executeResource,
  type ResourceCommand,
} from "@suite/server-core/runtime/resources";
// Resource envelopes carry typed module values. Never coerce numeric/text unions
// or silently remove unknown fields before the SDK validates the signed contract.
const resourceValidator = AjvCompiler()(
  {},
  {
    customOptions: {
      coerceTypes: false,
      removeAdditional: false,
      useDefaults: false,
    },
  },
);
const id = T.String({ format: "uuid" });
const slug = T.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
const params = T.Object({ workspaceId: id, moduleId: T.Optional(slug) });
const input = T.Object(
  {
    id: T.Optional(id),
    data: T.Optional(T.Record(T.String(), T.Unknown())),
    baseVersion: T.Optional(T.Integer({ minimum: 1 })),
    baseData: T.Optional(T.Record(T.String(), T.Unknown())),
    ...resourceListSchema.properties,
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
// This schema is validated by both AJV and the portable SDK validator.
// Use an explicit UUID pattern because the latter has no implicit format registry.
const policyId = T.String({
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
});
const OrganizationSchema = T.Object(
  {
    rootId: policyId,
    ranks: T.Array(
      T.Object(
        {
          id: policyId,
          name: T.String({ minLength: 1, maxLength: 100 }),
          parents: T.Array(policyId, { maxItems: 100, uniqueItems: true }),
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
          id: policyId,
          name: T.String({ minLength: 1, maxLength: 100 }),
          rankIds: T.Array(policyId, { maxItems: 500, uniqueItems: true }),
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
export async function registerPlatform(
  app: FastifyInstance,
  db: DB,
  runtime: ServerRuntime & { catalog: MutableModuleCatalog },
  issuer: string,
) {
  const authorize = (
    tx: Tx,
    actor: Actor,
    workspaceId: string,
    requestId: string,
    permission?: Permission,
    moduleId?: ModuleId,
  ) =>
    authorizeWithRuntime(
      tx,
      actor,
      workspaceId,
      requestId,
      runtime,
      permission,
      moduleId,
    );
  app.post<{ Params: { workspaceId: string }; Body: BusinessCutoverSelection }>(
    "/api/v1/workspaces/:workspaceId/business-upgrade/review",
    {
      schema: {
        operationId: "businessCutoverReview",
        params: T.Object({ workspaceId: id }),
        body: BusinessCutoverSelectionSchema,
        response: { 200: BusinessCutoverReviewSchema },
      },
    },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      return inWorkspace(
        db,
        req.params.workspaceId,
        async (tx) => {
          const ctx = await authorize(
            tx,
            req.actor,
            req.params.workspaceId,
            req.id,
            "modules.manage",
          );
          return reviewBusinessCutover(tx, ctx, req.body, moduleServers);
        },
        { readOnly: true },
      );
    },
  );

  app.post<{ Params: { workspaceId: string }; Body: InstallationReport }>(
    "/api/v1/workspaces/:workspaceId/installation-reports",
    {
      preValidation: async (req) => {
        assertSchema(InstallationReportSchema, req.body);
      },
      schema: {
        operationId: "installationReport",
        params: T.Object({ workspaceId: id }),
        body: InstallationReportSchema,
      },
    },
    async (req) =>
      inWorkspace(db, req.params.workspaceId, async (tx) => {
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
        );
        return recordInstallationReport(tx, ctx, req.body);
      }),
  );
  app.get<{
    Params: { workspaceId: string; moduleId: string };
    Querystring: { offset?: number };
  }>(
    "/api/v1/workspaces/:workspaceId/modules/:moduleId/devices",
    {
      schema: {
        operationId: "moduleFleet",
        params: T.Object({ workspaceId: id, moduleId: slug }),
        querystring: T.Object(
          { offset: T.Optional(T.Integer({ minimum: 0, maximum: 1000000 })) },
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
          "modules.manage",
        );
        return moduleFleet(tx, ctx, req.params.moduleId, req.query.offset ?? 0);
      }),
  );

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
    if (runtime.catalog.definition(release.module_id)) continue;
    verifyPackage(release, await publicKey());
    runtime.catalog.register(
      hydrateModule(
        release.artifact as unknown as import("@suite/module-sdk").ModuleDefinition,
      ),
    );
  }
  refreshProductPreset();
  app.post<{
    Params: { workspaceId: string; moduleId: string; operationName: string };
    Body: unknown;
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/queries/:operationName",
    {
      schema: {
        operationId: "moduleQuery",
        headers: moduleHeaders,
        params: T.Object({
          workspaceId: id,
          moduleId: slug,
          operationName: slug,
        }),
        body: T.Unknown(),
      },
    },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      return inWorkspace(
        db,
        req.params.workspaceId,
        async (tx) => {
          const ctx = await authorize(
            tx,
            req.actor,
            req.params.workspaceId,
            req.id,
            undefined,
            req.params.moduleId,
          );
          const definition = await clientModule(
            tx,
            ctx.workspaceId,
            ctx.runtime.catalog,
            req.params.moduleId,
            req.headers["x-module-version"],
            moduleServers,
          );
          const operation = found(
            definition.operations[req.params.operationName],
          );
          requireCondition(
            operation.kind === "query",
            400,
            "NOT_A_QUERY",
            "Use the command endpoint for business effects.",
          );
          const current = await workspaceModule(
            tx,
            ctx.workspaceId,
            definition.id,
            runtime.catalog,
          );
          const currentOperation = found(
            current.operations[req.params.operationName],
          );
          requireCondition(
            currentOperation.kind === "query",
            409,
            "QUERY_CONTRACT_CHANGED",
            "Update this module before reading this operation.",
          );
          requireCondition(
            !operation.serviceOnly && !currentOperation.serviceOnly,
            403,
            "SERVICE_ONLY",
            "This operation requires a declared and granted module service call.",
          );
          requireCondition(
            ctx.permissions.includes(operation.permission) &&
              ctx.permissions.includes(currentOperation.permission),
            403,
            "FORBIDDEN",
            "Your role does not allow this action.",
          );
          return executeModuleOperation(
            tx,
            ctx,
            definition,
            req.params.operationName,
            req.body,
            moduleServers,
          );
        },
        { readOnly: true },
      );
    },
  );
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
        const ctx = await authorize(
          tx,
          req.actor,
          req.params.workspaceId,
          req.id,
          undefined,
          req.params.moduleId,
        );
        const { current, original: definition } = await receiptContract(
          tx,
          ctx.workspaceId,
          ctx.runtime.catalog,
          req.params.moduleId,
          req.headers["x-module-version"],
        );
        const operation = found(
          definition.operations[req.params.operationName],
        );
        requireCondition(
          operation.kind !== "query",
          400,
          "QUERY_ENDPOINT_REQUIRED",
          "Use the read-only query endpoint for this operation.",
        );
        requireCondition(
          !operation.serviceOnly &&
            !current.operations[req.params.operationName]?.serviceOnly,
          403,
          "SERVICE_ONLY",
          "This operation requires a declared and granted module service call.",
        );
        requireCondition(
          ctx.permissions.includes(operation.permission) &&
            (!current.operations[req.params.operationName] ||
              ctx.permissions.includes(
                current.operations[req.params.operationName].permission,
              )),
          403,
          "FORBIDDEN",
          "Your role does not allow this action.",
        );
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
          async () => {
            // A saved receipt settles an earlier effect. Only a new execution
            // must satisfy today's rollout, storage and backend policy.
            const executable = await clientModule(
              tx,
              ctx.workspaceId,
              ctx.runtime.catalog,
              definition.id,
              req.headers["x-module-version"],
              moduleServers,
            );
            return executeModuleOperation(
              tx,
              ctx,
              executable,
              req.params.operationName,
              req.body,
              moduleServers,
            );
          },
        );
      }),
  );
  app.get<{
    Params: { workspaceId: string; moduleId: string; resource: string };
    Querystring: ReferenceQuery;
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/references/:resource",
    {
      schema: {
        operationId: "moduleReferences",
        headers: moduleHeaders,
        params: T.Object({ workspaceId: id, moduleId: slug, resource: slug }),
        querystring: ReferenceQuerySchema,
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
        const module = await clientModule(
          tx,
          ctx.workspaceId,
          ctx.runtime.catalog,
          req.params.moduleId,
          req.headers["x-module-version"],
          moduleServers,
        );
        return listModuleReferences(
          tx,
          ctx,
          module,
          req.params.resource,
          req.query,
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
        const module = await clientModule(
          tx,
          ctx.workspaceId,
          ctx.runtime.catalog,
          req.params.moduleId,
          req.headers["x-module-version"],
          moduleServers,
        );
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
  app.get<{
    Params: { workspaceId: string; moduleId: string };
    Querystring: { version?: string };
  }>(
    "/api/v1/workspaces/:workspaceId/modules/:moduleId/capabilities",
    {
      schema: {
        operationId: "moduleCapabilityReview",
        params: T.Object({ workspaceId: id, moduleId: slug }),
        querystring: T.Object({
          version: T.Optional(
            T.String({ pattern: "^[0-9A-Za-z][0-9A-Za-z.+-]{0,39}$" }),
          ),
        }),
        response: { 200: CapabilityReviewSchema },
      },
    },
    async (req, reply) => {
      reply.header("cache-control", "no-store");
      return inWorkspace(
        db,
        req.params.workspaceId,
        async (tx) => {
          const ctx = await authorize(
            tx,
            req.actor,
            req.params.workspaceId,
            req.id,
          );
          return reviewModuleCapabilities(
            tx,
            ctx,
            req.params.moduleId,
            req.query.version,
          );
        },
        { readOnly: true },
      );
    },
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
        const candidates = await registeredModuleIds(tx, runtime.catalog);
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
            .map((m) =>
              workspaceModule(tx, ctx.workspaceId, m, runtime.catalog),
            ),
        );
        for (const definition of definitions)
          if (!runtime.catalog.definition(definition.id))
            runtime.catalog.register(definition);
        refreshProductPreset();
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
    Body: { capability: string };
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/capabilities/authorize",
    {
      schema: {
        operationId: "moduleCapabilityAuthorize",
        headers: moduleHeaders,
        params,
        body: T.Object({ capability: slug }, { additionalProperties: false }),
        response: { 200: HostAuthorizationSchema },
      },
    },
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
        requireCondition(
          typeof req.headers["x-module-version"] === "string",
          400,
          "MODULE_VERSION_REQUIRED",
          "Host actions require an identified module release.",
        );
        const module = await clientModule(
          tx,
          ctx.workspaceId,
          ctx.runtime.catalog,
          req.params.moduleId,
          req.headers["x-module-version"],
          moduleServers,
        );
        const declaration =
          module.capabilities &&
          Object.hasOwn(module.capabilities, req.body.capability)
            ? module.capabilities[req.body.capability]
            : undefined;
        requireCondition(
          declaration,
          403,
          "CAPABILITY_UNDECLARED",
          "This module did not declare the requested host capability.",
        );
        requireCondition(
          ctx.permissions.includes(declaration.permission),
          403,
          "FORBIDDEN",
          "Your current permissions do not allow this host action.",
        );
        return {
          moduleId: module.id,
          moduleVersion: module.version,
          capability: req.body.capability,
          kind: declaration.kind,
          userId: ctx.actor.id,
          workspaceId: ctx.workspaceId,
        };
      }),
  );
  app.get(
    "/api/v1/capabilities/key",
    {
      schema: {
        operationId: "capabilityLeaseKey",
        response: { 200: CapabilityLeaseAuthoritySchema },
      },
    },
    async () => ({ ...capabilityLeaseKey(), issuer }),
  );
  app.post<{
    Params: { workspaceId: string; moduleId: string };
    Body: { capability: string };
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/capabilities/lease",
    {
      schema: {
        operationId: "moduleCapabilityLease",
        headers: moduleHeaders,
        params: T.Object({ workspaceId: id, moduleId: slug }),
        body: T.Object({ capability: slug }, { additionalProperties: false }),
        response: { 200: CapabilityLeaseSchema },
      },
    },
    async (req) =>
      inWorkspace(
        db,
        req.params.workspaceId,
        async (tx) => {
          const ctx = await authorize(
            tx,
            req.actor,
            req.params.workspaceId,
            req.id,
            undefined,
            req.params.moduleId,
          );
          requireCondition(
            typeof req.headers["x-module-version"] === "string",
            400,
            "MODULE_VERSION_REQUIRED",
            "Offline host actions require an identified module release.",
          );
          const module = await clientModule(
            tx,
            ctx.workspaceId,
            ctx.runtime.catalog,
            req.params.moduleId,
            req.headers["x-module-version"],
            moduleServers,
          );
          const payload = await prepareCapabilityLease(
            tx,
            ctx,
            module,
            req.body.capability,
            issuer,
          );
          const lease = await idempotent(
            tx,
            ctx,
            req.headers["idempotency-key"] as string | undefined,
            "module.capability.lease",
            {
              moduleId: module.id,
              version: module.version,
              capability: req.body.capability,
            },
            () => issueCapabilityLease(tx, ctx, payload),
          );
          requireCondition(
            lease.payload.policyRevision === payload.policyRevision &&
              lease.payload.issuer === issuer &&
              lease.payload.expiresAt > Date.now() &&
              lease.payload.expiresAt <= payload.expiresAt &&
              lease.keyId === capabilityLeaseKey().keyId,
            409,
            "CAPABILITY_LEASE_RENEWAL_REQUIRED",
            "This lease request belongs to an older policy, time window or signing key. Request a new offline lease with a new request identifier.",
          );
          return lease;
        },
        { snapshot: true },
      ),
  );
  app.post<{
    Params: { workspaceId: string; moduleId: string };
    Body: ResourceCommand;
  }>(
    "/api/v1/module/:moduleId/workspaces/:workspaceId/records",
    {
      validatorCompiler: resourceValidator,
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
        const execute = async () => {
          const definition = await clientModule(
            tx,
            ctx.workspaceId,
            ctx.runtime.catalog,
            req.params.moduleId,
            clientVersion,
            moduleServers,
          );
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
                "business-cutover",
                "pin",
                "rollout",
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
          req.body.action === "migrate" ||
            req.body.action === "business-cutover",
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
            if (req.body.action === "business-cutover") {
              assertSchema(BusinessCutoverCommandSchema, value);
              return applyBusinessCutover(tx, ctx, value, moduleServers);
            }
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
                runtime.catalog,
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
                runtime.catalog,
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
                runtime.catalog,
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
            } else if (
              req.body.action === "pin" ||
              req.body.action === "rollout"
            ) {
              assertSchema(
                T.Object(
                  {
                    moduleId: slug,
                    version: T.String({ maxLength: 40 }),
                    mandatory: T.Boolean(),
                    ...(req.body.action === "rollout"
                      ? {
                          acceptedVersions: T.Array(
                            T.String({ minLength: 1, maxLength: 40 }),
                            { maxItems: 10, uniqueItems: true },
                          ),
                        }
                      : {}),
                  },
                  { additionalProperties: false },
                ),
                value,
              );
              requireCondition(
                (await registeredModuleIds(tx, runtime.catalog)).includes(
                  value.moduleId,
                ),
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
              requireCondition(
                req.body.action !== "rollout" ||
                  !value.mandatory ||
                  (value.acceptedVersions as string[]).length === 0,
                400,
                "INVALID_ROLLOUT",
                "A mandatory update cannot also accept older releases.",
              );
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
            if (req.body.action === "pin" || req.body.action === "rollout") {
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
                    runtime.catalog,
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
            if (req.body.action === "rollout") {
              assertSchema(ModuleRolloutSchema, value);
              const moduleId = String(value.moduleId);
              const current = await workspaceModule(
                tx,
                ctx.workspaceId,
                moduleId,
                runtime.catalog,
              );
              for (const version of new Set([
                current.version,
                ...(value.acceptedVersions as string[]),
              ]))
                await compatibleClientRelease(
                  tx,
                  ctx.workspaceId,
                  ctx.runtime.catalog,
                  moduleId,
                  version,
                  moduleServers,
                );
            }
            if (req.body.action === "pin" || req.body.action === "rollout")
              await validateConfiguredRollouts(
                tx,
                ctx.workspaceId,
                ctx.runtime.catalog,
                moduleServers,
              );
            await audit(tx, ctx, `platform.${req.body.action}`, key);
            return { ok: true };
          },
        );
      }),
  );
  for (const metadataOnly of [false, true])
    app.get<{ Params: { workspaceId: string; moduleId: string } }>(
      `/api/v1/module/:moduleId/workspaces/:workspaceId/artifact${metadataOnly ? "/metadata" : ""}`,
      {
        schema: {
          operationId: metadataOnly
            ? "moduleArtifactMetadata"
            : "moduleArtifact",
          params,
        },
      },
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
            runtime.catalog,
          );
          const release = found(
            (
              await resolveWorkspaceRelease(tx, ctx.workspaceId, module.id)
            ).find((p) => p.module_id === module.id),
          );
          verifyPackage(release, await publicKey());
          if (metadataOnly) {
            const { artifact: _artifact, ...metadata } = release;
            return metadata;
          }
          await audit(tx, ctx, "modules.downloaded", module.id);
          return release;
        }),
    );
}
