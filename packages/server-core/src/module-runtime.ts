import {
  referenceValues,
  referenceTargetKey,
  type ReferenceValue,
} from "@suite/module-sdk/references";
import { authorizeReferenceTarget } from "./module-references";
import {
  validateResourceList,
  resourceRangeKind,
  resourceSortKind,
  resourceSortValues,
  validateResourceSortAnchor,
  resourceListScope,
  type ResourceRangeBounds,
} from "@suite/module-sdk/queries";
import { assertModuleStorage } from "./module-storage";
import { workspaceModule } from "./module-releases";
import { queryCursor } from "./module-query-cursor";
import { createHash, randomUUID } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import {
  assertSchema,
  mergeFields,
  type ModuleDefinition,
  type JsonRecord,
  type ResourceListOptions,
  type TSchema,
} from "@suite/module-sdk";
import { moduleDefinition } from "@suite/module-catalog";
import { type Tx } from "./database";
import { type Context, checkModule, lockKey } from "./authorization";
import { requireCondition, found } from "./errors";
import { audit, publish, iso } from "./transactions";
export interface ResourceCommand {
  action: "list" | "get" | "create" | "update" | "archive";
  resource: string;
  input: ResourceListOptions & {
    id?: string;
    data?: JsonRecord;
    baseVersion?: number;
  };
}
export async function validateReferences(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  resource: string,
  data: JsonRecord,
  schema: TSchema = module.resources[resource].schema,
) {
  return validateReferenceValues(
    tx,
    ctx,
    module,
    referenceValues(schema, data),
  );
}
/** Internal authority check for already schema-validated reference values. */
export async function validateReferenceValues(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  references: readonly ReferenceValue[],
) {
  const groups = new Map<
    string,
    {
      target: import("@suite/module-sdk/references").ReferenceTarget;
      ids: Set<string>;
    }
  >();
  for (const reference of references) {
    const key = referenceTargetKey(reference.target);
    let group = groups.get(key);
    if (!group) {
      group = { target: reference.target, ids: new Set() };
      groups.set(key, group);
    }
    group.ids.add(reference.value.toLowerCase());
  }
  for (const { target, ids } of groups.values()) {
    await authorizeReferenceTarget(tx, ctx, module, target);
    const values = [...ids];
    for (let offset = 0; offset < values.length; offset += 500) {
      const batch = values.slice(offset, offset + 500);
      if (target.kind === "member") {
        const members = await tx
          .selectFrom("suite.memberships as m")
          .innerJoin("suite.users as u", "u.id", "m.user_id")
          .select("m.id")
          .where("m.workspace_id", "=", ctx.workspaceId)
          .where("m.id", "in", batch)
          .where("m.active", "=", true)
          .where("u.active", "=", true)
          .execute();
        requireCondition(
          members.length === batch.length,
          400,
          "INVALID_MEMBER",
          "Choose an active member of this workspace.",
        );
      } else {
        const records = await tx
          .selectFrom("suite.module_records")
          .select("id")
          .where("workspace_id", "=", ctx.workspaceId)
          .where("module_id", "=", target.moduleId)
          .where("resource", "=", target.resource)
          .where("id", "in", batch)
          .where("archived", "=", false)
          .execute();
        requireCondition(
          records.length === batch.length,
          404,
          "NOT_FOUND",
          "A referenced record was not found in this workspace.",
        );
      }
    }
  }
}
export async function executeResource(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  command: ResourceCommand,
  definition?: ModuleDefinition,
) {
  const module =
    definition ?? (await workspaceModule(tx, ctx.workspaceId, moduleId));
  requireCondition(
    module.id === moduleId,
    403,
    "CAPABILITY_DENIED",
    "The resource contract belongs to another module.",
  );
  const resource = found(module.resources[command.resource]);
  const permission = `${moduleId}.${command.resource}.${["list", "get"].includes(command.action) ? "read" : "write"}`;
  requireCondition(
    ctx.permissions.includes(permission),
    403,
    "FORBIDDEN",
    "Your role does not allow this operation.",
  );
  await checkModule(tx, ctx.workspaceId, ctx.membershipId, moduleId);
  await assertModuleStorage(tx, ctx.workspaceId, module);
  requireCondition(
    resource.policy !== "local",
    400,
    "LOCAL_ONLY",
    "This resource belongs to a standalone local workspace.",
  );
  const select = () =>
    tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("module_id", "=", moduleId)
      .where("resource", "=", command.resource);
  const view = (r: {
    id: string;
    data: JsonRecord;
    version: number;
    archived: boolean;
    updated_at: Date | string;
  }) => ({
    id: r.id,
    data: r.data,
    version: r.version,
    archived: r.archived,
    updatedAt: iso(r.updated_at),
  });
  if (command.action === "get") {
    requireCondition(
      command.input.id,
      400,
      "INVALID_INPUT",
      "A record identifier is required.",
    );
    return view(
      found(
        await select().where("id", "=", command.input.id).executeTakeFirst(),
      ),
    );
  }
  if (command.action === "list") {
    validateResourceList(resource.schema, command.input);
    const limit = command.input.limit ?? 50;
    let q = select().where("archived", "=", command.input.archived ?? false);
    const order = command.input.orderBy ?? [];
    const expressionFor = (key: string, kind: string) =>
      kind === "number"
        ? sql`case when jsonb_typeof(data -> ${key}) = 'number' then (data ->> ${key})::numeric end`
        : kind === "boolean"
          ? sql`case when jsonb_typeof(data -> ${key}) = 'boolean' then (data ->> ${key})::boolean end`
          : sql`(case when jsonb_typeof(data -> ${key}) = 'string' then data ->> ${key} end) collate "C"`;
    const fields = order.map((item) => ({
      ...item,
      expression: expressionFor(
        item.field,
        resourceSortKind(resource.schema.properties[item.field])!,
      ),
    }));
    const codec = fields.length
      ? queryCursor(
          createHash("sha256")
            .update(
              resourceListScope(
                command.input,
                `${ctx.workspaceId}/${ctx.actor.id}/${moduleId}@${module.version}/${command.resource}`,
              ),
            )
            .digest("hex"),
          "resource",
        )
      : undefined;
    if (command.input.cursor) {
      if (!codec) q = q.where("id", ">", command.input.cursor);
      else {
        const cursor = codec.decode(command.input.cursor);
        validateResourceSortAnchor(resource.schema, order, cursor);
        const prefixes: RawBuilder<unknown>[] = [],
          alternatives: RawBuilder<unknown>[] = [];
        for (const [index, current] of fields.entries()) {
          const value = cursor.values[index];
          if (value !== null) {
            const beyond =
              current.direction === "asc"
                ? sql`${current.expression} > ${value}`
                : sql`${current.expression} < ${value}`;
            alternatives.push(
              sql`(${sql.join([...prefixes, sql`(${beyond} or ${current.expression} is null)`], sql` and `)})`,
            );
          }
          prefixes.push(
            sql`${current.expression} is not distinct from ${value}`,
          );
        }
        alternatives.push(
          sql`(${sql.join([...prefixes, sql`id > ${cursor.id}::uuid`], sql` and `)})`,
        );
        q = q.where(sql<boolean>`(${sql.join(alternatives, sql` or `)})`);
      }
    }
    for (const current of fields)
      q = q.orderBy(
        current.direction === "asc"
          ? sql`${current.expression} asc nulls last`
          : sql`${current.expression} desc nulls last`,
      );
    q = q.orderBy("id");
    for (const [key, value] of Object.entries(command.input.where ?? {}))
      q = q.where(
        sql<boolean>`data -> ${key} = ${JSON.stringify(value)}::jsonb`,
      );
    for (const [key, bounds] of Object.entries(command.input.ranges ?? {}) as [
      string,
      ResourceRangeBounds,
    ][]) {
      const kind = resourceRangeKind(resource.schema.properties[key]);
      // Guard retained legacy values before casting; field names remain parameters.
      const expression = expressionFor(key, kind!);
      for (const [operator, value] of Object.entries(bounds)) {
        if (operator === "gt")
          q = q.where(sql<boolean>`${expression} > ${value}`);
        if (operator === "gte")
          q = q.where(sql<boolean>`${expression} >= ${value}`);
        if (operator === "lt")
          q = q.where(sql<boolean>`${expression} < ${value}`);
        if (operator === "lte")
          q = q.where(sql<boolean>`${expression} <= ${value}`);
      }
    }
    if (command.input.search)
      q = q.where(
        sql<boolean>`data::text ilike ${"%" + command.input.search.replace(/[\\%_]/g, "\\$&") + "%"}`,
      );
    const rows = await q.limit(limit + 1).execute();
    let nextCursor: string | null = null;
    if (rows.length > limit) {
      const last = rows[limit - 1];
      nextCursor = codec
        ? codec.encode({
            id: last.id,
            values: resourceSortValues(resource.schema, last.data, order),
          })
        : last.id;
      requireCondition(
        nextCursor.length <= 24576,
        422,
        "QUERY_CURSOR_TOO_LARGE",
        "Sort by shorter fields to keep pagination within its size limit.",
      );
    }
    return { items: rows.slice(0, limit).map(view), nextCursor };
  }
  const id = command.input.id ?? randomUUID();
  await lockKey(tx, `${ctx.workspaceId}:${moduleId}:${command.resource}:${id}`);
  const old = await select()
    .where("id", "=", id)
    .forUpdate()
    .executeTakeFirst();
  if (command.action === "create")
    requireCondition(!old, 409, "RECORD_EXISTS", "This record already exists.");
  else {
    found(old);
    requireCondition(
      !resource.appendOnly,
      409,
      "APPEND_ONLY",
      "Entries in this resource cannot be edited or archived.",
    );
  }
  let data = command.input.data;
  if (command.action === "archive") {
    requireCondition(
      old?.version === command.input.baseVersion,
      412,
      "VERSION_CONFLICT",
      "Reload the record before archiving.",
    );
    data = found(old).data;
  } else {
    requireCondition(data, 400, "INVALID_INPUT", "Record data is required.");
    assertSchema(resource.schema, data);
    if (old && old.version !== command.input.baseVersion) {
      const revision = await tx
        .selectFrom("suite.module_revisions")
        .select("data")
        .where("workspace_id", "=", ctx.workspaceId)
        .where("module_id", "=", moduleId)
        .where("resource", "=", command.resource)
        .where("record_id", "=", id)
        .where("version", "=", command.input.baseVersion ?? -1)
        .executeTakeFirst();
      requireCondition(
        revision,
        412,
        "VERSION_CONFLICT",
        "The base version is unavailable. Reload and review your changes.",
      );
      const merged = mergeFields(revision.data, data, old.data);
      requireCondition(
        !merged.conflicts.length,
        412,
        "VERSION_CONFLICT",
        `Conflicting fields: ${merged.conflicts.join(", ")}. Reload and review before saving.`,
      );
      data = merged.data;
      requireCondition(data, 400, "INVALID_INPUT", "Record data is required.");
      assertSchema(resource.schema, data);
    }
    await validateReferences(tx, ctx, module, command.resource, data);
  }
  requireCondition(data, 400, "INVALID_INPUT", "Record data is required.");
  requireCondition(
    !old?.archived,
    409,
    "RECORD_ARCHIVED",
    "This record has been archived.",
  );
  const stored = await tx
    .selectFrom("suite.module_storage")
    .select(["schema_version", "release_version"])
    .where("workspace_id", "=", ctx.workspaceId)
    .where("module_id", "=", moduleId)
    .executeTakeFirst();
  if (stored && stored.schema_version !== (module.storage?.version ?? 1)) {
    const storageModule = await workspaceModule(
      tx,
      ctx.workspaceId,
      moduleId,
      stored.release_version,
    );
    assertSchema(found(storageModule.resources[command.resource]).schema, data);
  }
  const version = (old?.version ?? 0) + 1;
  const now = new Date();
  if (old)
    await tx
      .updateTable("suite.module_records")
      .set({
        data,
        version,
        archived: command.action === "archive",
        updated_at: now,
      })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("module_id", "=", moduleId)
      .where("resource", "=", command.resource)
      .where("id", "=", id)
      .execute();
  else
    await tx
      .insertInto("suite.module_records")
      .values({
        workspace_id: ctx.workspaceId,
        module_id: moduleId,
        resource: command.resource,
        id,
        data,
        created_by: ctx.actor.id,
        version,
        archived: false,
        updated_at: now,
      })
      .execute();
  await tx
    .insertInto("suite.module_revisions")
    .values({
      workspace_id: ctx.workspaceId,
      module_id: moduleId,
      resource: command.resource,
      record_id: id,
      version,
      data,
    })
    .execute();
  await audit(tx, ctx, `${moduleId}.${command.resource}.${command.action}`, id);
  await publish(tx, ctx, "module.record.changed", {
    moduleId,
    resource: command.resource,
    recordId: id,
    version,
  });
  return view({
    id,
    data,
    version,
    archived: command.action === "archive",
    updated_at: now,
  });
}
