import type { ModuleDefinition } from "./module";
import { FormatRegistry, type TSchema } from "@sinclair/typebox";
import { fullFormats } from "ajv-formats/dist/formats.js";

/** Versioned by the SDK, identical in every host and independently built module. */
export const supportedSchemaFormats = Object.freeze([
  "date",
  "time",
  "date-time",
  "duration",
  "uri",
  "uri-reference",
  "uri-template",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "regex",
  "uuid",
  "json-pointer",
  "relative-json-pointer",
  "json-pointer-uri-fragment",
  "byte",
] as const);
export type SchemaStringFormat = (typeof supportedSchemaFormats)[number];

const validators = new Map(
  supportedSchemaFormats.map((name) => {
    const definition = fullFormats[name];
    const validate =
      typeof definition === "object" && !(definition instanceof RegExp)
        ? definition.validate
        : definition;
    if (typeof validate !== "function" && !(validate instanceof RegExp))
      throw new Error(`Missing SDK format validator: ${name}`);
    return [
      name,
      (value: string): boolean =>
        validate instanceof RegExp
          ? validate.test(value)
          : Boolean((validate as (value: string) => boolean)(value)),
    ] as const;
  }),
);

/** Inspect schema positions, never application data in defaults/examples/const. */
export function schemaFormats(
  schema: TSchema,
  path = "schema",
): Set<SchemaStringFormat> {
  const formats = new Set<SchemaStringFormat>();
  const seen = new Set<object>();
  function visit(value: unknown, at: string): void {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const node = value as TSchema;
    if (node.format !== undefined) {
      if (!validators.has(node.format) || node.type !== "string")
        throw new Error(
          `${at}/format: Unsupported schema format ${JSON.stringify(node.format)}. Use a string schema with one of: ${supportedSchemaFormats.join(", ")}. Use pattern for a custom string constraint.`,
        );
      formats.add(node.format as SchemaStringFormat);
    }
    for (const key of [
      "properties",
      "patternProperties",
      "$defs",
      "definitions",
      "dependentSchemas",
    ])
      for (const [name, child] of Object.entries(node[key] ?? {}))
        visit(
          child,
          `${at}/${key}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`,
        );
    for (const key of [
      "items",
      "additionalProperties",
      "additionalItems",
      "unevaluatedProperties",
      "contains",
      "propertyNames",
      "not",
      "if",
      "then",
      "else",
      "anyOf",
      "allOf",
      "oneOf",
      "prefixItems",
    ])
      if (Array.isArray(node[key]))
        node[key].forEach((child: unknown, index: number) =>
          visit(child, `${at}/${key}/${index}`),
        );
      else visit(node[key], `${at}/${key}`);
  }
  visit(schema, path);
  return formats;
}

/** TypeBox exposes a global registry only. Bind our validators for one synchronous
 * check and restore the caller's registry, including on failure. No lazy iterator
 * or promise may escape this scope. No application registration is required. */
export function withSchemaFormats<T>(schema: TSchema, check: () => T): T {
  const formats = schemaFormats(schema);
  const previous = [...formats].map(
    (name) => [name, FormatRegistry.Get(name)] as const,
  );
  try {
    for (const name of formats) FormatRegistry.Set(name, validators.get(name)!);
    return check();
  } finally {
    for (const [name, validate] of previous)
      if (validate) FormatRegistry.Set(name, validate);
      else FormatRegistry.Delete(name);
  }
}

/** Validate every module-owned schema and derive host requirements. */
export function moduleSchemaFormats(
  definition: ModuleDefinition,
): Set<SchemaStringFormat> {
  const formats = new Set<SchemaStringFormat>();
  const collect = (schema: TSchema, path: string) => {
    for (const format of schemaFormats(schema, path)) formats.add(format);
  };
  collect(definition.configuration, "configuration");
  for (const group of ["resources", "stores"] as const)
    for (const [name, value] of Object.entries(definition[group] ?? {}))
      collect(value.schema, `${group}/${name}/schema`);
  for (const [name, schema] of Object.entries(definition.events ?? {}))
    collect(schema, `events/${name}`);
  for (const [name, view] of Object.entries(definition.views ?? {}))
    if (view.state) collect(view.state.schema, `views/${name}/state/schema`);
  for (const [name, op] of [
    ...Object.entries(definition.operations).map(
      ([name, op]) => [`operations/${name}`, op] as const,
    ),
    ...Object.entries(definition.services ?? {}).map(
      ([name, service]) =>
        [`services/${name}/contract`, service.contract] as const,
    ),
  ])
    for (const key of ["input", "output", "errors"] as const)
      if (op[key]) collect(op[key], `${name}/${key}`);
  return formats;
}
