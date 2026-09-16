import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Type, type ModuleDefinition } from "@suite/module-sdk";
import { renderModuleDocumentation } from "@suite/module-sdk/documentation";
import { checkModuleSources } from "../tooling/module-workspace";
import structured from "./fixtures/schema-editor/module";
import services from "./fixtures/service-preview/module";
import contacts from "../modules/contacts/module";
import projects from "../modules/projects/module";
import orders from "../modules/orders/module";
import inventory from "../modules/inventory/module";

const schemas = (reference: string) =>
  [...reference.matchAll(/^(`{3,})json\n([\s\S]*?)\n\1$/gm)].map((match) =>
    JSON.parse(match[2]),
  );
const transport = <T>(value: T): T => JSON.parse(JSON.stringify(value));

it("typechecks the generated examples against the actual resource, operation and service contracts", async () => {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/documentation-examples-"));
  const modules = [
    [contacts, "modules/contacts/module.ts"],
    [projects, "modules/projects/module.ts"],
    [orders, "modules/orders/module.ts"],
    [inventory, "modules/inventory/module.ts"],
    [services, "tests/fixtures/service-preview/module.ts"],
  ] as const;
  try {
    await writeFile(resolve(directory, "module.ts"), "export {};\n");
    let count = 0;
    for (const [module, path] of modules) {
      const folder = resolve(directory, module.id);
      await mkdir(folder);
      await writeFile(
        resolve(folder, "module.ts"),
        `export { default } from ${JSON.stringify(resolve(path))};\n`,
      );
      for (const [index, match] of [
        ...renderModuleDocumentation(module).matchAll(
          /^(`{3,})ts\n([\s\S]*?)\n\1$/gm,
        ),
      ].entries()) {
        await writeFile(resolve(folder, `example-${index}.ts`), match[2]);
        count++;
      }
    }
    expect(count).toBeGreaterThan(20);
    await checkModuleSources(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("documents all four business modules without losing schemas or changing the contracts", () => {
  for (const module of [
    contacts,
    projects,
    orders,
    inventory,
  ] as ModuleDefinition[]) {
    const original = JSON.stringify(module);
    const reference = renderModuleDocumentation(module);
    expect(reference).toBe(renderModuleDocumentation(transport(module)));
    const expected = [
      module.configuration,
      ...Object.values(module.resources).map((r) => r.schema),
      ...Object.values(module.operations).flatMap((op) => [
        op.input,
        op.output,
        ...(op.errors ? [op.errors] : []),
      ]),
      ...Object.values(module.events ?? {}),
      ...Object.values(module.stores ?? {}).map((store) => store.schema),
      ...Object.values(module.services ?? {}).flatMap((s) => [
        s.contract.input,
        s.contract.output,
        ...(s.contract.errors ? [s.contract.errors] : []),
      ]),
    ];
    expect(schemas(reference)).toEqual(
      expect.arrayContaining(transport(expected)),
    );
    for (const permission of module.permissions)
      expect(reference).toContain(permission);
    for (const id of Object.keys(module.operations))
      expect(reference).toContain(`### ${id}`);
    expect(JSON.stringify(module)).toBe(original);
  }
  const provider = renderModuleDocumentation(inventory);
  expect(provider).toContain("Denied: module service calls only");
  expect(provider).toContain("Unique fields: sku");
  expect(provider).toContain('"import-v1"');
  expect(renderModuleDocumentation(orders)).toContain(
    "Declared audit actions:",
  );
});

it("retains nested constraints, false and null defaults, references, services and view-state schemas", () => {
  const state = Type.Object({
    draft: Type.String(),
    selected: Type.Optional(Type.Integer()),
  });
  const module: ModuleDefinition = {
    ...structured,
    configuration: Type.Object({
      enabled: Type.Boolean({ default: false }),
      value: Type.Null({ default: null }),
    }),
    views: {
      home: { ...structured.views.home, state: { version: 3, schema: state } },
    },
  };
  const reference = renderModuleDocumentation(module);
  expect(reference).toContain("/lines/\\*/quantity");
  expect(reference).toContain("minimum: 1; maximum: 10");
  expect(reference).toContain("default: false");
  expect(reference).toContain("default: null");
  expect(reference).toContain("anyOf\\[1\\]");
  expect(reference).toContain("Editable-state contract version: 3");
  expect(schemas(reference)).toContainEqual(transport(state));
  expect(renderModuleDocumentation(projects)).toContain(
    "Resource reference: contacts/contacts",
  );
  expect(renderModuleDocumentation(projects)).toContain(
    "Workspace membership reference",
  );
  const consumed = renderModuleDocumentation(services);
  expect(consumed).toContain("record: preview-provider.record");
  expect(consumed).toContain("Provider contract version: 1.0.0");
  expect(consumed).toContain("explicit administrator grant");
});

it("escapes publisher text and safely fences exact schemas including arbitrary property names", () => {
  const schema = Type.Object({
    "a/b~c": Type.String({
      description: "```\n<script>alert(1)</script>\n| extra |",
      default: "`````",
    }),
  });
  const module = {
    ...structured,
    name: "<img src=x> [click](javascript:alert(1))",
    description: "line\n# heading | column",
    configuration: schema,
  };
  const reference = renderModuleDocumentation(module);
  expect(reference).toContain("&lt;img src=x&gt;");
  expect(reference).toContain("\\[click\\]\\(javascript:alert\\(1\\)\\)");
  expect(reference).toContain("line<br>\\# heading \\| column");
  expect(reference).toContain("/a~1b~0c");
  expect(reference).toContain("``````json");
  expect(schemas(reference)).toContainEqual(transport(schema));
  expect(
    renderModuleDocumentation({ ...module, description: "---" }),
  ).toContain("\n\n\\---\n\n");
  expect(
    renderModuleDocumentation({ ...module, description: "1. Literal prose" }),
  ).toContain("1\\. Literal prose");
});

it("generates, checks and rebuilds an independent module reference without host changes", async () => {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/documentation-cli-"));
  const id = `docs-${randomUUID().slice(0, 8)}`;
  const base = resolve(`.local/modules/${id}-1.0.0`);
  const catalog = await readFile(
    "packages/module-catalog/src/index.ts",
    "utf8",
  );
  const run = (...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tooling/module-cli.ts", ...args],
      {
        encoding: "utf8",
        timeout: 45000,
        env: {
          ...process.env,
          MODULE_SIGNING_DIRECTORY: resolve(directory, "keys"),
        },
      },
    );
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      output: result.stdout + result.stderr,
    };
  };
  const entry = resolve(directory, "module.ts"),
    output = resolve(directory, "reference.md");
  const source = (
    minimum: number,
  ) => `import {defineModule,resource,field,Type} from '@suite/module-sdk';
export default defineModule({id:'${id}',name:'Independent docs',description:'A module outside the host catalog',version:'1.0.0',publisher:'suite',host:'^1.0.0',backend:'^1.0.0',dependencies:{},permissions:['${id}.items.read','${id}.items.write'],configuration:Type.Object({}),operations:{},resources:{items:resource({name:field.text({minLength:${minimum}})},{title:'Items'})}});`;
  try {
    await writeFile(entry, source(1));
    const stdout = run("docs", directory);
    expect(stdout.status, stdout.output).toBe(0);
    expect(stdout.stdout).toContain("# Independent docs module reference");
    const generated = run("docs", directory, output);
    expect(generated.status, generated.output).toBe(0);
    expect(await readFile(output, "utf8")).toBe(stdout.stdout);
    expect(run("docs", directory, output, "--check").status).toBe(0);
    expect(run("docs", directory, output).status).not.toBe(0);
    await writeFile(entry, source(5));
    const stale = run("docs", directory, output, "--check");
    expect(stale.status).not.toBe(0);
    expect(stale.output).toContain("Module documentation is stale");
    const updated = run("docs", directory, output, "--update");
    expect(updated.status, updated.output).toBe(0);
    const expected = await readFile(output, "utf8");
    expect(expected).toContain("minLength: 5");
    expect(run("docs", directory, "--unknown").output).toContain("Usage:");
    const keyed = run("keygen");
    expect(keyed.status, keyed.output).toBe(0);
    const built = run("build", directory);
    expect(built.status, built.output).toBe(0);
    expect(await readFile(`${base}.md`, "utf8")).toBe(expected);
    expect(await readFile("packages/module-catalog/src/index.ts", "utf8")).toBe(
      catalog,
    );
    await writeFile(
      entry,
      source(5).replace("minLength:5", "minLength:'wrong'"),
    );
    const invalid = run("docs", directory);
    expect(invalid.status).not.toBe(0);
    expect(invalid.output).toContain("not assignable");
  } finally {
    await rm(directory, { recursive: true, force: true });
    for (const extension of [".json", ".md", ".server.json"])
      await rm(`${base}${extension}`, { force: true });
  }
}, 120000);
