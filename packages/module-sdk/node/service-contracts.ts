import type { ModuleDefinition, TSchema } from "../src/index";

/** Emit portable TypeBox expressions so a copied public contract retains inferred
 * types without importing the provider's executable implementation. */
function schemaSource(schema: TSchema, path: string): string {
  const value = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
  const options = { ...value };
  const take = (key: string) => {
    delete options[key];
    return value[key];
  };
  const type = take("type");
  const call = (name: string, args: string[] = []) => {
    if (Object.keys(options).length) args.push(JSON.stringify(options));
    return `Type.${name}(${args.join(", ")})`;
  };
  const child = (s: unknown, name: string) =>
    schemaSource(s as TSchema, `${path}.${name}`);
  if (Object.hasOwn(value, "const"))
    return call("Literal", [JSON.stringify(take("const"))]);
  for (const [key, builder] of [
    ["anyOf", "Union"],
    ["allOf", "Intersect"],
  ] as const)
    if (Array.isArray(value[key])) {
      const items = take(key) as TSchema[];
      return call(builder, [
        `[${items.map((s, i) => child(s, `${key}[${i}]`)).join(", ")}]`,
      ]);
    }
  if (type === "object" && !value.patternProperties) {
    const properties = (take("properties") ?? {}) as Record<string, TSchema>;
    const required = (take("required") ?? []) as string[];
    if (typeof value.additionalProperties === "object")
      throw Error(
        `${path}: schema-valued additionalProperties is not supported by service export yet.`,
      );
    return call("Object", [
      `{${Object.entries(properties)
        .map(([name, property]) => {
          const source = child(property, name);
          return `${JSON.stringify(name)}: ${required.includes(name) ? source : `Type.Optional(${source})`}`;
        })
        .join(", ")}}`,
    ]);
  }
  if (type === "array" && value.items && !Array.isArray(value.items))
    return call("Array", [child(take("items"), "items")]);
  const primitives: Record<string, string> = {
    string: "String",
    integer: "Integer",
    number: "Number",
    boolean: "Boolean",
    null: "Null",
  };
  if (typeof type === "string" && primitives[type])
    return call(primitives[type]);
  if (!Object.keys(value).length) return "Type.Unknown()";
  throw Error(
    `${path}: unsupported service schema. Use objects, arrays, primitives, literals, unions or intersections.`,
  );
}

/** Exact, versioned public schema snapshots; regeneration is explicit. */
export function serviceContractSource(module: ModuleDefinition) {
  const entries = Object.entries(module.operations).filter(
    ([, op]) => op.public,
  );
  if (!entries.length)
    throw Error(`${module.id} has no public service operations.`);
  const operations = entries.map(([name, op]) => {
    const { input, output, errors, ...metadata } = op;
    const contract = `{...${JSON.stringify(metadata)}, input: ${schemaSource(input, `${name}.input`)}, output: ${schemaSource(output, `${name}.output`)}${errors ? `, errors: ${schemaSource(errors, `${name}.errors`)}` : ""}}`;
    return `${JSON.stringify(name)}: { moduleId: ${JSON.stringify(module.id)}, operation: ${JSON.stringify(name)}, version: ${JSON.stringify(module.version)}, contract: operation(${contract}) }`;
  });
  return `// Generated public services for ${module.id}@${module.version}. Regenerate with pnpm module services.\nimport { operation, Type } from "@suite/module-sdk";\nexport default {${operations.join(",\n")}} as const;\n`;
}
