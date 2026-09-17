import { storeCommandSchema } from "@suite/module-sdk/server";
import { queryStore } from "./queries";
import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { Type, assertSchema, type ModuleDefinition } from "@suite/module-sdk";
import type { StoreCommand } from "@suite/module-sdk/server";
import type { TObject } from "@suite/module-sdk";
import type { Tx } from "../persistence/database";
import { lockKey, type Context } from "../identity/authorization";
import { found, requireCondition } from "../errors";
import { audit } from "../persistence/transactions";

/** The enclosing operation owns authorization, transaction lifetime and failure draining. */
export async function executeStore(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  name: string,
  command: StoreCommand,
) {
  requireCondition(
    Object.hasOwn(module.stores ?? {}, name),
    403,
    "CAPABILITY_DENIED",
    "This module has not declared that private store.",
  );
  const definition = module.stores![name];
  if (command.action === "query" || command.action === "aggregate")
    return queryStore(tx, ctx, module.id, name, definition, command);
  assertSchema(storeCommandSchema, command);
  // '$' is not a legal public resource identifier. No resource route can expose a store.
  const resource = `$${name}`;
  const select = () =>
    tx
      .selectFrom("suite.module_records")
      .selectAll()
      .where("workspace_id", "=", ctx.workspaceId)
      .where("module_id", "=", module.id)
      .where("resource", "=", resource);
  const active = () => select().where("archived", "=", false);
  const view = (row: {
    id: string;
    data: Record<string, unknown>;
    version: number;
  }) => {
    assertSchema(definition.schema, row.data);
    return { id: row.id, data: row.data, version: row.version };
  };
  // A row lock cannot protect an absent record. Lock the logical ID first, too.
  const recordId =
    command.action === "create"
      ? (command.id ?? randomUUID())
      : command.action === "scan"
        ? undefined
        : command.id;
  if (recordId && (command.action !== "get" || command.lock))
    await lockKey(
      tx,
      `store-record:${ctx.workspaceId}:${module.id}:${name}:${recordId.toLowerCase()}`,
    );
  if (command.action === "get") {
    let query = active().where("id", "=", command.id);
    if (command.lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? view(row) : null;
  }
  if (command.action === "scan") {
    let query = active().orderBy("id");
    if (command.where) {
      assertSchema(
        Type.Partial(definition.schema as TObject, {
          additionalProperties: false,
        }),
        command.where,
      );
      query = query.where(
        sql<boolean>`data @> ${JSON.stringify(command.where)}::jsonb`,
      );
    }
    if (command.after) query = query.where("id", ">", command.after);
    const limit = command.limit ?? 50;
    const rows = await query.limit(limit + 1).execute();
    return {
      items: rows.slice(0, limit).map(view),
      next: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  if (command.action !== "archive") {
    assertSchema(definition.schema, command.data);
    requireCondition(
      Buffer.byteLength(JSON.stringify(command.data)) <= 1024 * 1024,
      413,
      "STORE_RECORD_TOO_LARGE",
      "A private record cannot exceed 1 MiB.",
    );
    for (const field of definition.unique) {
      if (command.data[field] === undefined || command.data[field] === null)
        continue;
      await lockKey(
        tx,
        `store-unique:${ctx.workspaceId}:${module.id}:${name}:${field}:${JSON.stringify(command.data[field])}`,
      );
      let query = active().where(
        sql<boolean>`data @> ${JSON.stringify({ [field]: command.data[field] })}::jsonb`,
      );
      if (command.action === "replace")
        query = query.where("id", "!=", command.id);
      requireCondition(
        !(await query.executeTakeFirst()),
        409,
        "STORE_UNIQUE_CONFLICT",
        `The ${name}.${field} value is already in use.`,
      );
    }
  }
  let row;
  if (command.action === "create") {
    row = await tx
      .insertInto("suite.module_records")
      .values({
        workspace_id: ctx.workspaceId,
        module_id: module.id,
        resource,
        id: recordId!,
        data: command.data,
        created_by: ctx.actor.id,
        version: 1,
        archived: false,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  } else {
    const current = found(
      await active()
        .where("id", "=", command.id)
        .forUpdate()
        .executeTakeFirst(),
    );
    requireCondition(
      current.version === command.version,
      412,
      "VERSION_CONFLICT",
      "This private record changed. Read its current version before retrying.",
    );
    row = await tx
      .updateTable("suite.module_records")
      .set({
        ...(command.action === "replace"
          ? { data: command.data }
          : { archived: true }),
        version: current.version + 1,
        updated_at: new Date(),
      })
      .where("workspace_id", "=", ctx.workspaceId)
      .where("module_id", "=", module.id)
      .where("resource", "=", resource)
      .where("id", "=", command.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }
  await tx
    .insertInto("suite.module_revisions")
    .values({
      workspace_id: ctx.workspaceId,
      module_id: module.id,
      resource,
      record_id: row.id,
      version: row.version,
      data: row.data,
    })
    .execute();
  await audit(tx, ctx, `${module.id}.store.${name}.${command.action}`, row.id);
  return command.action === "archive" ? undefined : view(row);
}
