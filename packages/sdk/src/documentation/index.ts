import { hostCapabilitySchemas } from "../contracts/host-capabilities";
import type { ModuleDefinition, Operation, TSchema } from "../index";
import { localStorageContract, storageContract } from "../authoring/storage";

// Metadata is text, never executable Markdown/HTML supplied by a publisher.
const text = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(/[\\`*_{}[\]()#+!|]/g, "\\$&")
    .replace(/^([-+=])/, "\\$1")
    .replace(/^(\d+)\. /, "$1\\. ")
    .replace(/\r\n?|\n/g, "<br>");
const json = (value: unknown) => JSON.stringify(value, null, 2);
function code(source: string, language: string) {
  const longest = Math.max(
    0,
    ...[...source.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${source}\n${fence}`;
}
const table = (headers: string[], rows: unknown[][]) =>
  [headers, headers.map(() => "---"), ...rows]
    .map((row) => `| ${row.map(text).join(" | ")} |`)
    .join("\n");
const entries = <T>(value: Record<string, T> | undefined) =>
  Object.entries(value ?? {});
const pointer = (key: string) =>
  key.replaceAll("~", "~0").replaceAll("/", "~1");
function typeName(schema: TSchema): string {
  if (Object.hasOwn(schema, "const")) return JSON.stringify(schema.const);
  if (schema.$ref) return `reference ${schema.$ref}`;
  if (schema.anyOf) return `union (${schema.anyOf.length} alternatives)`;
  if (schema.allOf) return `intersection (${schema.allOf.length} constraints)`;
  if (schema.enum) return `enum ${JSON.stringify(schema.enum)}`;
  if (Array.isArray(schema.items)) return "tuple";
  if (schema.patternProperties) return "record";
  if (schema.not && Object.keys(schema.not).length === 0) return "never";
  return schema.type ?? "unknown";
}

function schemaReference(title: string, schema: TSchema, level = 3): string {
  const rows: unknown[][] = [];
  const visit = (node: TSchema, path: string, presence: string) => {
    const details: string[] = [];
    if (node.title) details.push(`Title: ${node.title}`);
    if (node.description) details.push(node.description);
    for (const key of [
      "default",
      "examples",
      "format",
      "pattern",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf",
      "minItems",
      "maxItems",
      "uniqueItems",
      "minProperties",
      "maxProperties",
      "additionalProperties",
      "additionalItems",
      "readOnly",
      "writeOnly",
      "deprecated",
    ]) {
      if (Object.hasOwn(node, key)) {
        details.push(
          `${key}: ${typeof node[key] === "object" && key.startsWith("additional") ? "schema below" : JSON.stringify(node[key])}`,
        );
      }
    }
    if (node["x-reference"])
      details.push(
        `Resource reference: ${node["x-reference"].module}/${node["x-reference"].resource}`,
      );
    if (node["x-membership"]) details.push("Workspace membership reference");
    rows.push([path || "(root)", typeName(node), presence, details.join("; ")]);
    for (const [key, child] of entries(
      node.properties as Record<string, TSchema> | undefined,
    ))
      visit(
        child,
        `${path}/${pointer(key)}`,
        node.required?.includes(key) ? "Required" : "Optional",
      );
    if (node.items) {
      if (Array.isArray(node.items))
        node.items.forEach((child: TSchema, index: number) =>
          visit(child, `${path}/${index}`, "Tuple position"),
        );
      else visit(node.items as TSchema, `${path}/*`, "Each item");
    }
    for (const kind of ["anyOf", "allOf"])
      (node[kind] as TSchema[] | undefined)?.forEach((child, index) =>
        visit(
          child,
          `${path} (${kind}[${index}])`,
          kind === "anyOf" ? "Alternative" : "All constraints",
        ),
      );
    for (const [pattern, child] of entries(
      node.patternProperties as Record<string, TSchema> | undefined,
    ))
      visit(child, `${path}/{key matching ${pattern}}`, "Matching keys");
    for (const key of ["additionalProperties", "additionalItems"])
      if (typeof node[key] === "object" && node[key] !== null)
        visit(node[key], `${path} (${key})`, "Additional values");
    for (const key of ["$defs", "definitions"])
      for (const [name, child] of entries(
        node[key] as Record<string, TSchema> | undefined,
      ))
        visit(child, `${path}/${key}/${pointer(name)}`, "Definition");
  };
  // Serialize first so accidental circular schemas fail before recursive traversal.
  const source = json(schema);
  visit(schema, "", "Root");
  return `${"#".repeat(level)} ${text(title)}\n\n${table(["Field or branch", "Type", "Presence", "Constraints and description"], rows)}\n\n${code(source, "json")}`;
}

const policies = {
  local: "Standalone local execution. No corporate server commitment.",
  queued:
    "Offline capture is provisional. Synchronization rechecks current server authorization and business rules.",
  online: "Requires authoritative server acceptance before success.",
} as const;

function operationReference(
  id: string,
  op: Operation,
  heading: string,
  clientExample = true,
) {
  return [
    `### ${text(heading)}`,
    table(
      ["Contract", "Value"],
      [
        ["Identifier", id],
        ["Title", op.title],
        ["Kind", op.kind ?? "command"],
        ["Execution", `${op.policy}: ${policies[op.policy]}`],
        ["Permission", op.permission],
        [
          "Public service",
          op.public ? "Yes, requires an explicit consumer grant" : "No",
        ],
        [
          "Direct client access",
          op.serviceOnly
            ? "Denied: module service calls only"
            : "Allowed when authorized by the host",
        ],
        ...(op.legacyOperation
          ? [["Legacy host adapter", op.legacyOperation]]
          : []),
      ],
    ),
    ...(!clientExample || op.serviceOnly
      ? []
      : [
          code(
            `import type { createModuleClient, OperationInput } from "@suite/module-sdk";\nimport module from "./module";\n\n// Pass the client supplied by the host for the current actor and workspace.\ntype Client = ReturnType<typeof createModuleClient<typeof module>>;\ntype Input = OperationInput<typeof module, ${JSON.stringify(id)}>;\nexport const execute = (client: Client, input: Input) => client.${op.errors ? "attempt" : "call"}(${JSON.stringify(id)}, input);`,
            "ts",
          ),
        ]),
    schemaReference("Input", op.input, 4),
    schemaReference("Output", op.output, 4),
    op.errors
      ? schemaReference("Declared business errors", op.errors, 4)
      : "No typed business-error schema is declared. Host, authorization and transport errors may still occur.",
  ].join("\n\n");
}

/** Deterministic contract reference. Runtime configuration and fixtures are not read. */
export function renderModuleDocumentation(module: ModuleDefinition): string {
  const sections: string[] = [
    `# ${text(module.name)} module reference`,
    text(module.description),
    "Generated from the module contract. This reference describes declared contracts; it does not prove installation readiness, entitlement, implementation correctness or complete offline support.",
    "## Contents",
    [
      "Release and compatibility",
      "Dependencies",
      "Permissions",
      ...(entries(module.capabilities).length ? ["Host capabilities"] : []),
      "Configuration",
      "Resources",
      "Operations",
      "Consumed services",
      "Events and audit",
      "Private storage",
      "Storage evolution",
      "Views and navigation",
      "Reading schema tables",
    ]
      .map(
        (heading) =>
          `- [${heading}](#${heading.toLowerCase().replaceAll(" ", "-")})`,
      )
      .join("\n"),
    "## Release and compatibility",
    table(
      ["Property", "Value"],
      [
        ["Module ID", module.id],
        ["Version", module.version],
        ["Publisher", module.publisher],
        ["Host compatibility", module.host],
        ["Backend compatibility", module.backend],
        ["API namespace", `/api/v1/module/${module.id}`],
        [
          "Custom UI",
          module.customUI || entries(module.views).length
            ? "Declared"
            : "Not declared",
        ],
        ["Legacy host view", module.legacyView ? "Yes" : "No"],
      ],
    ),
    "## Dependencies",
    entries(module.dependencies).length
      ? table(["Module", "Version range"], entries(module.dependencies))
      : "No module dependencies declared.",
    "## Permissions",
    module.permissions.length
      ? module.permissions.map((p) => `- ${text(p)}`).join("\n")
      : "No permissions declared.",
    "Server authorization remains authoritative. A manifest permission or offline policy is not a grant.",
    ...(entries(module.capabilities).length
      ? [
          "## Host capabilities",
          "A signed declaration requests access; the current workspace permission grants it. Corporate host actions require live authorization by default. Offline declarations additionally require an unexpired server-issued lease and host support. LAN capabilities require enabled managed desktop transport. Device access never authorizes corporate business changes.",
          ...entries(module.capabilities).flatMap(([name, capability]) => [
            `### ${text(name)}`,
            table(
              ["Capability", "Permission", "Offline access"],
              [
                [
                  capability.kind,
                  capability.permission,
                  capability.offline === "lease"
                    ? "Server lease and host support required"
                    : "Not declared",
                ],
              ],
            ),
            schemaReference(
              "Input",
              hostCapabilitySchemas[capability.kind].input,
              4,
            ),
            schemaReference(
              "Result",
              hostCapabilitySchemas[capability.kind].output,
              4,
            ),
          ]),
        ]
      : []),
    "## Configuration",
    schemaReference("Configuration schema", module.configuration),
    "## Resources",
    "Resource clients infer data from the schema. Reads return records with id, data, version, archived and updatedAt. Lists return items and nextCursor; list options are where, search, cursor, limit and archived. The schema-typed where object matches up to 16 complete field values using exact equality and AND. Missing fields differ from explicit null. Pages use stable ascending record IDs, default to 50 records and allow 1–100. Reset the cursor when changing filters. Writes use an idempotency key; retain the same key for retries. Updates carry the base record and version. Append-only resources reject update and archive.",
  ];
  if (!entries(module.resources).length)
    sections.push("No public resources declared.");
  for (const [id, resource] of entries(module.resources)) {
    sections.push(
      `### ${text(id)}: ${text(resource.title)}`,
      table(
        ["Contract", "Value"],
        [
          ["Execution", `${resource.policy}: ${policies[resource.policy]}`],
          [
            "Standalone support",
            resource.standalone ? "Yes, in a local personal workspace" : "No",
          ],
          ["Append only", resource.appendOnly ? "Yes" : "No"],
          ["Read permission", `${module.id}.${id}.read`],
          ["Write permission", `${module.id}.${id}.write`],
          ["Default columns", resource.columns.join(", ")],
        ],
      ),
      code(
        `import type { createModuleClient } from "@suite/module-sdk";\nimport module from "./module";\n\ntype Client = ReturnType<typeof createModuleClient<typeof module>>;\nexport const readPage = (client: Client, cursor?: string) =>\n  client.resource(${JSON.stringify(id)}).list({ limit: 25, cursor });\n// Preserve the returned nextCursor for the next request.`,
        "ts",
      ),
      schemaReference("Record data", resource.schema, 4),
    );
  }
  sections.push(
    "## Operations",
    "Queries are read-only and do not create effect receipts. Commands use idempotency keys; retain the same key when retrying an identical effect. Only explicitly public operations can be consumed as module services.",
  );
  if (!entries(module.operations).length)
    sections.push("No custom operations declared.");
  for (const [id, op] of entries(module.operations))
    sections.push(operationReference(id, op, id));
  sections.push(
    "## Consumed services",
    "Each alias requires its declared dependency, compatible provider contract and an explicit administrator grant. Calls propagate actor/workspace context and share the caller's server transaction; private stores are not exposed by a grant.",
  );
  if (!entries(module.services).length)
    sections.push("No consumed services declared.");
  for (const [alias, service] of entries(module.services))
    sections.push(
      operationReference(
        service.operation,
        service.contract,
        `${alias}: ${service.moduleId}.${service.operation}`,
        false,
      ),
      code(
        `import type { ModuleContext, Static } from "@suite/module-sdk";\nimport module from "./module";\n\ntype Input = Static<(typeof module.services)[${JSON.stringify(alias)}]["contract"]["input"]>;\nexport const invoke = (ctx: ModuleContext<typeof module>, input: Input) =>\n  ctx.service(${JSON.stringify(alias)}, input);`,
        "ts",
      ),
      `Provider contract version: ${text(service.version)}. Dependency range: ${text(module.dependencies[service.moduleId] ?? "Not declared")}.`,
    );
  sections.push("## Events and audit");
  if (!entries(module.events).length)
    sections.push("No module events declared.");
  for (const [name, schema] of entries(module.events))
    sections.push(schemaReference(`Event ${name}`, schema));
  sections.push(
    module.audit?.length
      ? `Declared audit actions:\n\n${module.audit.map((name) => `- ${text(name)}`).join("\n")}`
      : "No module-specific audit actions declared.",
  );
  sections.push(
    "## Private storage",
    "Private stores are accessible to reviewed server handlers in the current module namespace. They are not public resource endpoints.",
  );
  if (!entries(module.stores).length)
    sections.push("No private stores declared.");
  for (const [name, store] of entries(module.stores))
    sections.push(
      `### ${text(name)}\n\nUnique fields: ${store.unique.length ? store.unique.map(text).join(", ") : "none"}.`,
      schemaReference("Stored record", store.schema, 4),
    );
  sections.push(
    "## Storage evolution",
    "Corporate and standalone storage versions are independent. Forward migrations do not make an incompatible executable rollback safe.",
    "### Corporate storage",
    code(json(storageContract(module)), "json"),
    "### Standalone storage",
    code(json(localStorageContract(module)), "json"),
    "A default storage contract does not itself declare standalone module support.",
  );
  sections.push("## Views and navigation");
  if (module.navigation)
    sections.push(
      table(
        ["Navigation", "Value"],
        [
          ["Path", module.navigation.path],
          ["Permission", module.navigation.permission],
          [
            "View",
            module.navigation.view ??
              "Generated resource view or declared legacy host view",
          ],
        ],
      ),
    );
  else sections.push("No navigation entry declared.");
  if (!entries(module.views).length)
    sections.push("No custom React views declared.");
  for (const [id, view] of entries(module.views)) {
    sections.push(
      `### View ${text(id)}`,
      table(
        ["Property", "Value"],
        [
          ["Title", view.title],
          ["Entry", view.entry],
          ["Stylesheet", view.stylesheet ?? "Host UI kit"],
          ["Permission", view.permission],
        ],
      ),
    );
    if (view.state)
      sections.push(
        `Editable-state contract version: ${view.state.version}.`,
        schemaReference("Retained view state", view.state.schema, 4),
      );
    else sections.push("No retained editable-state contract declared.");
  }
  sections.push(
    "## Reading schema tables",
    "Paths use escaped property tokens (~0 for ~, ~1 for /). * denotes each array item; anyOf/allOf labels identify schema branches, not literal data keys. Presence is relative to the containing object or branch. JSON blocks preserve the complete serializable schema, including annotations not summarized in the table.",
  );
  return sections.join("\n\n") + "\n";
}
