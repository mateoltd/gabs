import type { TObject, TSchema } from "@sinclair/typebox";
import { defineModule, type ModuleDefinition } from "../authoring/module";
import { ValidationError } from "../authoring/validation";

/** Restore TypeBox runtime metadata after a signed JSON definition crosses a transport. */
export function hydrateSchema(schema: TSchema): TSchema {
  const copy = { ...schema };
  if (schema.properties)
    copy.properties = Object.fromEntries(
      Object.entries(schema.properties as Record<string, TSchema>).map(
        ([k, v]) => [k, hydrateSchema(v)],
      ),
    );
  if (schema.patternProperties)
    copy.patternProperties = Object.fromEntries(
      Object.entries(schema.patternProperties as Record<string, TSchema>).map(
        ([key, value]) => [key, hydrateSchema(value)],
      ),
    );
  if (typeof schema.additionalProperties === "object")
    copy.additionalProperties = hydrateSchema(
      schema.additionalProperties as TSchema,
    );
  if (schema.items)
    copy.items = Array.isArray(schema.items)
      ? schema.items.map(hydrateSchema)
      : hydrateSchema(schema.items as TSchema);
  if (Array.isArray(schema.anyOf)) copy.anyOf = schema.anyOf.map(hydrateSchema);
  if (Array.isArray(schema.allOf)) copy.allOf = schema.allOf.map(hydrateSchema);
  const kind =
    schema.const !== undefined
      ? "Literal"
      : schema.not && Object.keys(schema.not).length === 0
        ? "Never"
        : schema.anyOf
          ? "Union"
          : schema.allOf
            ? "Intersect"
            : schema.patternProperties
              ? "Record"
              : Array.isArray(schema.items)
                ? "Tuple"
                : ((
                    {
                      object: "Object",
                      array: "Array",
                      string: "String",
                      integer: "Integer",
                      number: "Number",
                      boolean: "Boolean",
                      null: "Null",
                    } as Record<string, string>
                  )[String(schema.type)] ?? "Unknown");
  if (
    kind === "Unknown" &&
    (schema.type !== undefined || schema.$ref || schema.not || schema.oneOf)
  )
    throw new ValidationError(
      "Unsupported transported schema. Use the SDK field types or an explicitly supported JSON schema contract.",
    );
  return { ...copy, [Symbol.for("TypeBox.Kind")]: kind };
}
export function hydrateModule(module: ModuleDefinition): ModuleDefinition {
  const {
    client: _client,
    local: _local,
    ...contract
  } = module as ModuleDefinition & {
    client?: unknown;
    local?: unknown;
  };
  return defineModule({
    ...contract,
    configuration: hydrateSchema(module.configuration) as TObject,
    ...(module.views
      ? {
          views: Object.fromEntries(
            Object.entries(module.views).map(([key, view]) => [
              key,
              {
                ...view,
                ...(view.state
                  ? {
                      state: {
                        ...view.state,
                        schema: hydrateSchema(view.state.schema),
                      },
                    }
                  : {}),
              },
            ]),
          ),
        }
      : {}),
    ...(module.events
      ? {
          events: Object.fromEntries(
            Object.entries(module.events).map(([k, s]) => [
              k,
              hydrateSchema(s),
            ]),
          ),
        }
      : {}),
    ...(module.services
      ? {
          services: Object.fromEntries(
            Object.entries(module.services).map(([k, s]) => [
              k,
              {
                ...s,
                contract: {
                  ...s.contract,
                  input: hydrateSchema(s.contract.input),
                  output: hydrateSchema(s.contract.output),
                  ...(s.contract.errors
                    ? { errors: hydrateSchema(s.contract.errors) }
                    : {}),
                },
              },
            ]),
          ),
        }
      : {}),
    ...(module.stores
      ? {
          stores: Object.fromEntries(
            Object.entries(module.stores).map(([name, store]) => [
              name,
              { ...store, schema: hydrateSchema(store.schema) as TObject },
            ]),
          ),
        }
      : {}),
    resources: Object.fromEntries(
      Object.entries(module.resources).map(([k, r]) => [
        k,
        { ...r, schema: hydrateSchema(r.schema) },
      ]),
    ),
    operations: Object.fromEntries(
      Object.entries(module.operations).map(([k, o]) => [
        k,
        {
          ...o,
          input: hydrateSchema(o.input),
          output: hydrateSchema(o.output),
          ...(o.errors ? { errors: hydrateSchema(o.errors) } : {}),
        },
      ]),
    ),
  });
}
