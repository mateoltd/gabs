import { workspaceModule } from "./module-releases";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import {
  assertSchema,
  mergeFields,
  type ModuleDefinition,
  type JsonRecord,
} from "@suite/module-sdk";
import { moduleDefinition } from "@suite/module-catalog";
import { type Tx } from "./database";
import { type Context, checkModule, lockKey } from "./authorization";
import { requireCondition, found } from "./errors";
import { audit, publish, iso } from "./transactions";
export interface ResourceCommand {
  action: "list" | "get" | "create" | "update" | "archive";
  resource: string;
  input: {
    id?: string;
    data?: JsonRecord;
    baseVersion?: number;
    search?: string;
    cursor?: string;
    limit?: number;
    archived?: boolean;
  };
}
export async function validateReferences(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  resource: string,
  data: JsonRecord,
) {
  for (const [key, schema] of Object.entries(
    module.resources[resource].schema.properties as Record<
      string,
      import("@suite/module-sdk").TSchema
    >,
  )) {
    if (schema["x-membership"] && data[key]) {
      const member = await tx
        .selectFrom("suite.memberships as m")
        .innerJoin("suite.users as u", "u.id", "m.user_id")
        .select("m.id")
        .where("m.workspace_id", "=", ctx.workspaceId)
        .where("m.id", "=", String(data[key]))
        .where("m.active", "=", true)
        .where("u.active", "=", true)
        .executeTakeFirst();
      requireCondition(
        member,
        400,
        "INVALID_MEMBER",
        "Choose an active member of this workspace.",
      );
    }
    const reference = schema["x-reference"] as
      { module: string; resource: string } | undefined;
    if (!reference || !data[key]) continue;
    requireCondition(
      typeof data[key] === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          String(data[key]),
        ),
      400,
      "INVALID_REFERENCE",
      "A reference must be a valid record identifier.",
    );
    if (reference.module !== module.id) {
      requireCondition(
        reference.module in module.dependencies,
        400,
        "UNDECLARED_DEPENDENCY",
        "This reference requires a declared dependency.",
      );
      requireCondition(
        ctx.permissions.includes(
          `${reference.module}.${reference.resource}.read`,
        ),
        403,
        "FORBIDDEN",
        "Your role cannot read the referenced resource.",
      );
      await checkModule(
        tx,
        ctx.workspaceId,
        ctx.membershipId,
        reference.module,
      );
      const grant = await tx
        .selectFrom("suite.platform_settings")
        .select("value")
        .where("workspace_id", "=", ctx.workspaceId)
        .where("key", "=", `grant:${module.id}:${reference.module}`)
        .executeTakeFirst();
      requireCondition(
        (grant?.value as { read?: boolean } | undefined)?.read,
        403,
        "GRANT_REQUIRED",
        `An administrator must grant ${module.name} access to ${reference.module}.`,
      );
    }
    found(
      await tx
        .selectFrom("suite.module_records")
        .select("id")
        .where("workspace_id", "=", ctx.workspaceId)
        .where("module_id", "=", reference.module)
        .where("resource", "=", reference.resource)
        .where("id", "=", String(data[key]))
        .where("archived", "=", false)
        .executeTakeFirst(),
    );
  }
}
export async function executeResource(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  command: ResourceCommand,
) {
  const module = await workspaceModule(tx, ctx.workspaceId, moduleId);
  const resource = found(module.resources[command.resource]);
  const permission = `${moduleId}.${command.resource}.${["list", "get"].includes(command.action) ? "read" : "write"}`;
  requireCondition(
    ctx.permissions.includes(permission),
    403,
    "FORBIDDEN",
    "Your role does not allow this operation.",
  );
  await checkModule(tx, ctx.workspaceId, ctx.membershipId, moduleId);
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
    const limit = Math.max(1, Math.min(command.input.limit ?? 50, 100));
    let q = select()
      .where("archived", "=", command.input.archived ?? false)
      .orderBy("id");
    if (command.input.cursor) q = q.where("id", ">", command.input.cursor);
    if (command.input.search)
      q = q.where(
        sql<boolean>`data::text ilike ${"%" + command.input.search.replace(/[\\%_]/g, "\\$&") + "%"}`,
      );
    const rows = await q.limit(limit + 1).execute();
    return {
      items: rows.slice(0, limit).map(view),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
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
