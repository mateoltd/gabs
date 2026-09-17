import { sql } from "kysely";
import { assertSchema, type ModuleDefinition } from "@suite/module-sdk";
import {
  referenceFields,
  ReferenceQuerySchema,
  type ReferenceTarget,
  type ReferenceQuery,
  type ReferencePage,
  type ReferenceOption,
} from "@suite/module-sdk/references";
import { type Tx } from "./database";
import { checkModule, type Context } from "./authorization";
import { found, requireCondition } from "./errors";
import { workspaceModule } from "./module-releases";
import { assertModuleStorage } from "./module-storage";

/** Shared by lookup and writes. Same-module writes retain their own resource permission. */
export async function authorizeReferenceTarget(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  target: ReferenceTarget,
) {
  if (target.kind !== "resource" || target.moduleId === module.id) return;
  requireCondition(
    Object.hasOwn(module.dependencies, target.moduleId),
    400,
    "UNDECLARED_DEPENDENCY",
    "This reference requires a declared dependency.",
  );
  requireCondition(
    ctx.permissions.includes(`${target.moduleId}.${target.resource}.read`),
    403,
    "FORBIDDEN",
    "Your role cannot read the referenced resource.",
  );
  await checkModule(tx, ctx.workspaceId, ctx.membershipId, target.moduleId);
  const grant = await tx
    .selectFrom("suite.platform_settings")
    .select("value")
    .where("workspace_id", "=", ctx.workspaceId)
    .where("key", "=", `grant:${module.id}:${target.moduleId}`)
    .executeTakeFirst();
  requireCondition(
    (grant?.value as { read?: boolean } | undefined)?.read,
    403,
    "GRANT_REQUIRED",
    `An administrator must grant ${module.name} access to ${target.moduleId}.`,
  );
}
/** Bounded, authorized labels for a field in the installed source contract. */
export async function listModuleReferences(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  resourceName: string,
  input: ReferenceQuery,
): Promise<ReferencePage> {
  assertSchema(ReferenceQuerySchema, input);
  requireCondition(
    ctx.permissions.includes(`${module.id}.${resourceName}.read`),
    403,
    "FORBIDDEN",
    "Your role cannot read this resource.",
  );
  await checkModule(tx, ctx.workspaceId, ctx.membershipId, module.id);
  await assertModuleStorage(tx, ctx.workspaceId, module);
  const resource = found(
    Object.hasOwn(module.resources, resourceName)
      ? module.resources[resourceName]
      : undefined,
  );
  const field = referenceFields(resource.schema).find(
    (field) => field.schemaPath === input.field,
  );
  requireCondition(
    field,
    400,
    "INVALID_REFERENCE_FIELD",
    "Choose a declared reference field in this resource.",
  );
  const target = field!.target;
  await authorizeReferenceTarget(tx, ctx, module, target);
  const limit = input.limit ?? 25;
  const search = input.search
    ? `%${input.search.replace(/[\\%_]/g, "\\$&")}%`
    : undefined;
  let items: ReferenceOption[];
  let selected: ReferenceOption | undefined;
  if (target.kind === "member") {
    const base = tx
      .selectFrom("suite.memberships as m")
      .innerJoin("suite.users as u", "u.id", "m.user_id")
      .select(["m.id as value", "u.name as label"])
      .where("m.workspace_id", "=", ctx.workspaceId)
      .where("m.active", "=", true)
      .where("u.active", "=", true);
    let query = base.orderBy("m.id");
    if (input.cursor) query = query.where("m.id", ">", input.cursor);
    if (search) query = query.where("u.name", "ilike", search);
    items = await query.limit(limit + 1).execute();
    if (input.selected)
      selected = await base
        .where("m.id", "=", input.selected)
        .executeTakeFirst();
  } else {
    requireCondition(
      ctx.permissions.includes(`${target.moduleId}.${target.resource}.read`),
      403,
      "FORBIDDEN",
      "Your role cannot read the referenced resource.",
    );
    const provider =
      target.moduleId === module.id
        ? module
        : await workspaceModule(tx, ctx.workspaceId, target.moduleId);
    const targetResource = found(
      Object.hasOwn(provider.resources, target.resource)
        ? provider.resources[target.resource]
        : undefined,
    );
    requireCondition(
      targetResource.policy !== "local",
      400,
      "LOCAL_ONLY",
      "This resource belongs to a standalone local workspace.",
    );
    await assertModuleStorage(tx, ctx.workspaceId, provider);
    const label = sql<string>`coalesce(
      case when jsonb_typeof(data->'name') = 'string' then nullif(data->>'name', '') end,
      case when jsonb_typeof(data->'title') = 'string' then nullif(data->>'title', '') end,
      id::text)`;
    const base = tx
      .selectFrom("suite.module_records")
      .select(["id as value", label.as("label")])
      .where("workspace_id", "=", ctx.workspaceId)
      .where("module_id", "=", target.moduleId)
      .where("resource", "=", target.resource)
      .where("archived", "=", false);
    let query = base.orderBy("id");
    if (input.cursor) query = query.where("id", ">", input.cursor);
    if (search) query = query.where(label, "ilike", search);
    items = await query.limit(limit + 1).execute();
    if (input.selected)
      selected = await base.where("id", "=", input.selected).executeTakeFirst();
  }
  return {
    items: items.slice(0, limit),
    nextCursor: items.length > limit ? items[limit - 1].value : null,
    ...(input.selected ? { selected: selected ?? null } : {}),
  };
}
