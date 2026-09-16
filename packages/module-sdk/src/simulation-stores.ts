import {
  assertSchema,
  Type,
  type JsonRecord,
  type ModuleDefinition,
  type TObject,
  type Store,
} from "./index";
import type { StoreCommand } from "./store";
import type { StoreQueryCommand, StoreQueryFilter } from "./store-query";
import {
  storeCommandSchema,
  storeQueryCommandSchema,
  storeFieldKind,
} from "./store-contract";
import { canonical } from "./registry";
import {
  simulationError as rejected,
  type SimulationStoreRecord,
} from "./simulation-fixtures";

/** JSON containment for development fixtures; SQL remains authoritative for database locale/numeric semantics. */
function contains(value: unknown, expected: unknown): boolean {
  if (Array.isArray(value))
    return Array.isArray(expected)
      ? expected.every((item) =>
          value.some((candidate) => contains(candidate, item)),
        )
      : value.some((item) => contains(item, expected));
  if (expected && typeof expected === "object" && !Array.isArray(expected))
    return (
      !!value &&
      typeof value === "object" &&
      Object.entries(expected).every(
        ([key, item]) =>
          Object.hasOwn(value, key) &&
          contains((value as JsonRecord)[key], item),
      )
    );
  return canonical(value) === canonical(expected);
}
function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === "string" && typeof b === "string") {
    const left = new TextEncoder().encode(a),
      right = new TextEncoder().encode(b);
    for (let i = 0; i < Math.min(left.length, right.length); i++)
      if (left[i] !== right[i]) return left[i] - right[i];
    return left.length - right.length;
  }
  return Number(a) - Number(b);
}
function queryFields(
  definition: Store,
  name: string,
  command: StoreQueryCommand,
) {
  assertSchema(storeQueryCommandSchema, command);
  const properties = (definition.schema as TObject).properties;
  const field = (
    key: string,
    allowed = ["string", "number", "integer", "boolean"],
  ) => {
    const schema = Object.hasOwn(properties, key) ? properties[key] : undefined;
    const kind = schema && storeFieldKind(schema);
    if (!kind || !allowed.includes(kind))
      throw rejected(
        400,
        "INVALID_STORE_QUERY",
        `The ${name}.${key} field does not support this query.`,
      );
    return { schema: schema!, kind };
  };
  if (command.where)
    assertSchema(
      Type.Partial(definition.schema as TObject, {
        additionalProperties: false,
      }),
      command.where,
    );
  for (const key of command.search?.fields ?? []) field(key, ["string"]);
  if (Object.keys(command.ranges ?? {}).length > 8)
    throw rejected(
      400,
      "INVALID_STORE_QUERY",
      "A query supports at most eight range fields.",
    );
  for (const [key, bounds] of Object.entries(command.ranges ?? {})) {
    const target = field(key, ["string", "number", "integer"]);
    for (const value of Object.values(bounds))
      assertSchema(target.schema, value);
  }
  if (command.action === "query") {
    const order = command.orderBy ?? [];
    if (new Set(order.map((item) => item.field)).size !== order.length)
      throw rejected(
        400,
        "INVALID_STORE_QUERY",
        "Sort fields must be distinct.",
      );
    order.forEach((item) => field(item.field));
  } else {
    command.sum?.forEach((key) => field(key, ["number", "integer"]));
    if (command.groupBy) field(command.groupBy);
  }
  return field;
}
function matches(data: JsonRecord, filter: StoreQueryFilter) {
  if (filter.where && !contains(data, filter.where)) return false;
  if (
    filter.search &&
    !filter.search.fields.some(
      (key) =>
        typeof data[key] === "string" &&
        (data[key] as string)
          .toLowerCase()
          .includes(filter.search!.text.toLowerCase()),
    )
  )
    return false;
  return Object.entries(filter.ranges ?? {}).every(
    ([key, bounds]) =>
      data[key] !== undefined &&
      data[key] !== null &&
      Object.entries(bounds).every(([operator, value]) => {
        const comparison = compare(data[key], value);
        return operator === "gt"
          ? comparison > 0
          : operator === "gte"
            ? comparison >= 0
            : operator === "lt"
              ? comparison < 0
              : comparison <= 0;
      }),
  );
}

export function createSimulationStores(
  module: ModuleDefinition,
  records: () => Record<string, SimulationStoreRecord[]>,
  audit: (action: string, targetId: string, requestId: string) => void,
) {
  const cursors = new Map<
    string,
    { scope: string; id: string; values: unknown[] }
  >();
  const view = ({ id, data, version }: SimulationStoreRecord) =>
    structuredClone({ id, data, version });
  function unique(name: string, data: JsonRecord, id?: string) {
    for (const field of module.stores![name].unique) {
      if (data[field] === undefined || data[field] === null) continue;
      if (
        records()[name].some(
          (row) =>
            !row.archived &&
            row.id !== id &&
            canonical(row.data[field]) === canonical(data[field]),
        )
      )
        throw rejected(
          409,
          "STORE_UNIQUE_CONFLICT",
          `The ${name}.${field} value is already in use.`,
        );
    }
  }
  for (const [name, rows] of Object.entries(records()))
    for (const row of rows) if (!row.archived) unique(name, row.data, row.id);
  return async (
    name: string,
    command: StoreCommand,
    requestId: string,
  ): Promise<unknown> => {
    if (!Object.hasOwn(module.stores ?? {}, name))
      throw rejected(
        403,
        "CAPABILITY_DENIED",
        "This module has not declared that private store.",
      );
    const definition = module.stores![name],
      rows = records()[name];
    if (command.action === "query" || command.action === "aggregate") {
      const field = queryFields(definition, name, command);
      const filtered = rows.filter(
        (row) => !row.archived && matches(row.data, command),
      );
      if (command.action === "aggregate") {
        const summarize = (group: SimulationStoreRecord[]) => {
          const sums = Object.fromEntries(
            (command.sum ?? []).map((key) => {
              const sum = group.reduce(
                (value, row) => value + Number(row.data[key] ?? 0),
                0,
              );
              if (
                !Number.isFinite(sum) ||
                (field(key).kind === "integer" && !Number.isSafeInteger(sum))
              )
                throw rejected(
                  422,
                  "AGGREGATE_OVERFLOW",
                  "This aggregate exceeds the supported numeric range.",
                );
              return [key, sum];
            }),
          );
          return { count: group.length, sums };
        };
        const groups = new Map<unknown, SimulationStoreRecord[]>();
        if (command.groupBy)
          for (const row of filtered) {
            const key = row.data[command.groupBy] ?? null;
            const group = groups.get(key) ?? [];
            group.push(row);
            groups.set(key, group);
          }
        if (groups.size > (command.maxGroups ?? 200))
          throw rejected(
            422,
            "AGGREGATE_GROUP_LIMIT",
            "Narrow this aggregate: it exceeds the requested group limit.",
          );
        return {
          ...summarize(filtered),
          groups: [...groups]
            .sort(([a], [b]) =>
              a === null
                ? b === null
                  ? 0
                  : 1
                : b === null
                  ? -1
                  : compare(a, b),
            )
            .map(([key, group]) => ({ key, ...summarize(group) })),
        };
      }
      const order = command.orderBy ?? [];
      const values = (row: SimulationStoreRecord) =>
        order.map((sort) => row.data[sort.field] ?? null);
      const compareRow = (
        row: SimulationStoreRecord,
        after: { id: string; values: unknown[] },
      ) => {
        for (const [index, sort] of order.entries()) {
          const a = row.data[sort.field] ?? null,
            b = after.values[index];
          const comparison =
            a === null
              ? b === null
                ? 0
                : 1
              : b === null
                ? -1
                : compare(a, b) * (sort.direction === "desc" ? -1 : 1);
          if (comparison) return comparison;
        }
        return compare(row.id, after.id);
      };
      filtered.sort((a, b) => compareRow(a, { id: b.id, values: values(b) }));
      const scope = canonical({
        name,
        where: command.where ?? {},
        search: command.search ?? null,
        ranges: command.ranges ?? {},
        order,
      });
      const cursor = command.cursor ? cursors.get(command.cursor) : undefined;
      if (command.cursor && (!cursor || cursor.scope !== scope))
        throw rejected(
          400,
          "INVALID_STORE_CURSOR",
          "This cursor belongs to another query or simulation. Reload the list.",
        );
      const matched = cursor
        ? filtered.filter((row) => compareRow(row, cursor) > 0)
        : filtered;
      const items = matched.slice(0, command.limit ?? 50);
      let next: string | null = null;
      if (matched.length > items.length) {
        next = `sim1.${crypto.randomUUID()}`;
        const last = items.at(-1)!;
        cursors.set(next, {
          scope,
          id: last.id,
          values: structuredClone(values(last)),
        });
        if (cursors.size > 1000) cursors.delete(cursors.keys().next().value!);
      }
      return { items: items.map(view), next };
    }
    assertSchema(storeCommandSchema, command);
    if (command.action === "scan") {
      if (command.where)
        assertSchema(
          Type.Partial(definition.schema as TObject, {
            additionalProperties: false,
          }),
          command.where,
        );
      const selected = rows
        .filter(
          (row) =>
            !row.archived &&
            (!command.after || row.id > command.after.toLowerCase()) &&
            (!command.where || contains(row.data, command.where)),
        )
        .sort((a, b) => compare(a.id, b.id));
      const limit = command.limit ?? 50;
      return {
        items: selected.slice(0, limit).map(view),
        next: selected.length > limit ? selected[limit - 1].id : null,
      };
    }
    const id = (
      command.action === "create"
        ? (command.id ?? crypto.randomUUID())
        : command.id
    ).toLowerCase();
    const row = rows.find((row) => row.id === id);
    if (command.action === "get")
      return row && !row.archived ? view(row) : null;
    if (command.action !== "archive") {
      assertSchema(definition.schema, command.data);
      if (
        new TextEncoder().encode(JSON.stringify(command.data)).byteLength >
        1024 * 1024
      )
        throw rejected(
          413,
          "STORE_RECORD_TOO_LARGE",
          "A private record cannot exceed 1 MiB.",
        );
      unique(name, command.data, command.action === "replace" ? id : undefined);
    }
    let result: SimulationStoreRecord;
    if (command.action === "create") {
      if (row)
        throw rejected(
          409,
          "ALREADY_EXISTS",
          "A private record with this ID already exists.",
        );
      result = {
        id,
        data: structuredClone(command.data),
        version: 1,
        archived: false,
      };
      rows.push(result);
    } else {
      if (!row || row.archived)
        throw rejected(
          404,
          "NOT_FOUND",
          "This private record is not available.",
        );
      if (row.version !== command.version)
        throw rejected(
          412,
          "VERSION_CONFLICT",
          "This private record changed. Read its current version before retrying.",
        );
      if (command.action === "replace")
        row.data = structuredClone(command.data);
      else row.archived = true;
      row.version++;
      result = row;
    }
    audit(`${module.id}.store.${name}.${command.action}`, id, requestId);
    return command.action === "archive" ? undefined : view(result);
  };
}
