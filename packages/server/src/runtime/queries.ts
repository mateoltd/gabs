import {
  storeQueryCommandSchema,
  storeFieldKind,
} from "@suite/module-sdk/server";
import { queryCursor } from "./query-cursor";
import { createHash } from "node:crypto";
import { sql, type RawBuilder } from "kysely";
import {
  assertSchema,
  Type,
  type Store,
  type TObject,
} from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import type { StoreQueryCommand } from "@suite/module-sdk/server";
import type { Context } from "../identity/authorization";
import type { Tx } from "../persistence/database";
import { requireCondition } from "../errors";
const cursorSchema = Type.Object(
  {
    version: Type.Literal(1),
    scope: Type.String(),
    id: Type.String({
      pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$",
    }),
    values: Type.Array(
      Type.Union([Type.String(), Type.Number(), Type.Boolean(), Type.Null()]),
      { maxItems: 3 },
    ),
  },
  { additionalProperties: false },
);
/** No caller-controlled SQL identifiers: field names and values are parameters. */
export async function queryStore(
  tx: Tx,
  ctx: Context,
  moduleId: string,
  storeName: string,
  definition: Store,
  command: StoreQueryCommand,
) {
  assertSchema(storeQueryCommandSchema, command);
  const properties = (definition.schema as TObject).properties;
  const field = (
    key: string,
    allowed = ["string", "number", "integer", "boolean"],
  ) => {
    const schema = Object.hasOwn(properties, key) ? properties[key] : undefined;
    const type = schema && storeFieldKind(schema);
    requireCondition(
      type && allowed.includes(type),
      400,
      "INVALID_STORE_QUERY",
      `The ${storeName}.${key} field does not support this query.`,
    );
    const value = sql`(data ->> ${key})`;
    const expression =
      type === "number" || type === "integer"
        ? sql`${value}::numeric`
        : type === "boolean"
          ? sql`${value}::boolean`
          : sql`${value} collate "C"`;
    return { schema: schema!, type: type!, expression };
  };
  const predicates: RawBuilder<unknown>[] = [
    sql`workspace_id = ${ctx.workspaceId}::uuid`,
    sql`module_id = ${moduleId}`,
    sql`resource = ${`$${storeName}`}`,
    sql`archived = false`,
  ];
  if (command.where) {
    assertSchema(
      Type.Partial(definition.schema as TObject, {
        additionalProperties: false,
      }),
      command.where,
    );
    predicates.push(sql`data @> ${JSON.stringify(command.where)}::jsonb`);
  }
  if (command.search) {
    const pattern = `%${command.search.text.replace(/[\\%_]/g, (s) => `\\${s}`)}%`;
    predicates.push(
      sql`(${sql.join(
        command.search.fields.map((key) => {
          field(key, ["string"]);
          // Search uses the database's locale; byte ordering is only for stable cursors.
          return sql`(data ->> ${key}) ilike ${pattern}`;
        }),
        sql` or `,
      )})`,
    );
  }
  const ranges = Object.entries(command.ranges ?? {});
  requireCondition(
    ranges.length <= 8,
    400,
    "INVALID_STORE_QUERY",
    "A query supports at most eight range fields.",
  );
  for (const [key, bounds] of ranges) {
    const target = field(key, ["string", "number", "integer"]);
    for (const [operator, value] of Object.entries(bounds)) {
      assertSchema(target.schema, value);
      if (operator === "gt")
        predicates.push(sql`${target.expression} > ${value}`);
      if (operator === "gte")
        predicates.push(sql`${target.expression} >= ${value}`);
      if (operator === "lt")
        predicates.push(sql`${target.expression} < ${value}`);
      if (operator === "lte")
        predicates.push(sql`${target.expression} <= ${value}`);
    }
  }
  const where = () => sql.join(predicates, sql` and `);
  if (command.action === "aggregate") {
    const sums = (command.sum ?? []).map((key, index) => ({
      key,
      ...field(key, ["number", "integer"]),
      alias: `value_${index}`,
    }));
    const group = command.groupBy ? field(command.groupBy) : undefined;
    const limit = command.maxGroups ?? 200;
    const select = [
      sql`count(*) as count`,
      ...sums.map(
        (s) =>
          sql`coalesce(sum(${sql.ref(s.alias)}), 0) as ${sql.ref(s.alias)}`,
      ),
    ];
    const projections = [
      sql`${group ? group.expression : sql`null`} as group_key`,
      ...sums.map((s) => sql`${s.expression} as ${sql.ref(s.alias)}`),
    ];
    const result = await sql<Record<string, unknown>>`with selected as (
      select ${sql.join(projections)} from suite.module_records where ${where()}
    ) select ${sql.join(select)}, ${group ? sql`group_key, grouping(group_key) as total` : sql`null as group_key, 1 as total`}
      from selected ${group ? sql`group by grouping sets ((), (group_key)) order by total desc, group_key asc nulls last limit ${limit + 2}` : sql``}`.execute(
      tx,
    );
    requireCondition(
      result.rows.length <= limit + 1,
      422,
      "AGGREGATE_GROUP_LIMIT",
      "Narrow this aggregate: it exceeds the requested group limit.",
    );
    const numeric = (value: unknown, integer: boolean) => {
      const parsed = Number(value);
      requireCondition(
        Number.isFinite(parsed) && (!integer || Number.isSafeInteger(parsed)),
        422,
        "AGGREGATE_OVERFLOW",
        "This aggregate exceeds the supported numeric range.",
      );
      return parsed;
    };
    const summarize = (row: Record<string, unknown>) => ({
      count: numeric(row.count, true),
      sums: Object.fromEntries(
        sums.map((s) => [s.key, numeric(row[s.alias], s.type === "integer")]),
      ),
    });
    const total = result.rows.find((row) => row.total === 1)!;
    return {
      ...summarize(total),
      groups: result.rows
        .filter((row) => row.total === 0)
        .map((row) => ({
          key:
            row.group_key === null
              ? null
              : group!.type === "integer" || group!.type === "number"
                ? numeric(row.group_key, group!.type === "integer")
                : row.group_key,
          ...summarize(row),
        })),
    };
  }
  const order = command.orderBy ?? [];
  requireCondition(
    new Set(order.map((o) => o.field)).size === order.length,
    400,
    "INVALID_STORE_QUERY",
    "Sort fields must be distinct.",
  );
  const fields = order.map((o) => ({ ...o, ...field(o.field) }));
  const scope = createHash("sha256")
    .update(
      canonical({
        workspaceId: ctx.workspaceId,
        actorId: ctx.actor.id,
        moduleId,
        storeName,
        where: command.where ?? {},
        search: command.search ?? null,
        ranges: command.ranges ?? {},
        orderBy: order,
      }),
    )
    .digest("hex");
  const codec = queryCursor(scope);
  if (command.cursor) {
    const cursor = codec.decode(command.cursor);
    assertSchema(cursorSchema, cursor);
    requireCondition(
      cursor.scope === scope && cursor.values.length === fields.length,
      400,
      "INVALID_STORE_CURSOR",
      "This cursor belongs to a different query or workspace.",
    );
    const prefixes: RawBuilder<unknown>[] = [],
      alternatives: RawBuilder<unknown>[] = [];
    for (const [index, current] of fields.entries()) {
      const value: string | number | boolean | null = cursor.values[index];
      if (value !== null) {
        assertSchema(current.schema, value);
        const beyond =
          current.direction === "asc"
            ? sql`${current.expression} > ${value}`
            : sql`${current.expression} < ${value}`;
        alternatives.push(
          sql`(${sql.join([...prefixes, sql`(${beyond} or ${current.expression} is null)`], sql` and `)})`,
        );
      }
      prefixes.push(sql`${current.expression} is not distinct from ${value}`);
    }
    alternatives.push(
      sql`(${sql.join([...prefixes, sql`id > ${cursor.id}::uuid`], sql` and `)})`,
    );
    predicates.push(sql`(${sql.join(alternatives, sql` or `)})`);
  }
  const ordering = [
    ...fields.map((o) =>
      o.direction === "asc"
        ? sql`${o.expression} asc nulls last`
        : sql`${o.expression} desc nulls last`,
    ),
    sql`id asc`,
  ];
  const limit = command.limit ?? 50;
  const rows = (
    await sql<{
      id: string;
      data: Record<string, unknown>;
      version: number;
    }>`select id, data, version from suite.module_records where ${where()} order by ${sql.join(ordering)} limit ${limit + 1}`.execute(
      tx,
    )
  ).rows;
  const items = rows.slice(0, limit);
  for (const row of items) assertSchema(definition.schema, row.data);
  let next: string | null = null;
  if (rows.length > limit) {
    const last = items.at(-1)!;
    next = codec.encode({
      version: 1,
      scope,
      id: last.id,
      values: fields.map((f) => last.data[f.field] ?? null),
    });
    requireCondition(
      next.length <= 24576,
      422,
      "QUERY_CURSOR_TOO_LARGE",
      "Use bounded fields to sort this private store.",
    );
  }
  return { items, next };
}
