import { it, expect } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

it("injects independent provider backends and typed fixtures into module-owned CLI scenarios", async () => {
  const catalog = await readFile(
    "packages/module-catalog/src/index.ts",
    "utf8",
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "tooling/module-cli.ts",
      "test",
      "tests/fixtures/service-preview",
      "--dependency",
      "tests/fixtures/service-preview/provider",
    ],
    { encoding: "utf8", timeout: 60000 },
  );
  const output = result.stdout + result.stderr;
  expect(result.status, output).toBe(0);
  expect(output).toContain("2/2 module-owned scenarios passed.");
  expect(await readFile("packages/module-catalog/src/index.ts", "utf8")).toBe(
    catalog,
  );
}, 65000);

it("checks and executes an independent module's own scenarios with actionable failures", async () => {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/scenario-cli-"));
  const catalog = await readFile(
    "packages/module-catalog/src/index.ts",
    "utf8",
  );
  const run = (command: "check" | "test", args: string[] = []) => {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tooling/module-cli.ts", command, directory, ...args],
      {
        encoding: "utf8",
        timeout: 45_000,
      },
    );
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  };
  const entry = resolve(directory, "module.scenarios.ts");
  const scenario = (body: string) => `import assert from 'node:assert/strict';
import {defineModuleScenarios} from '@suite/module-sdk/scenarios';
import module from './module';
export default defineModuleScenarios(module, {scenarios:{'independent behavior':async ({client})=>{${body}}}});`;
  try {
    await writeFile(
      resolve(directory, "module.ts"),
      `import {defineModule, resource, field, Type} from '@suite/module-sdk';
export default defineModule({id:'scenario-proof',name:'Scenario proof',version:'1.0.0',description:'Independent development proof',publisher:'suite',host:'^1.0.0',backend:'^1.0.0',dependencies:{},configuration:Type.Object({},{additionalProperties:false}),permissions:['scenario-proof.items.read','scenario-proof.items.write'],operations:{},resources:{items:resource({name:field.text({minLength:1})},{title:'Items'})}});`,
    );
    await writeFile(
      resolve(directory, "fixtures.json"),
      JSON.stringify({ items: [{ name: "Loaded from disk" }] }),
    );
    await writeFile(
      entry,
      scenario(
        "assert.equal((await client.resource('items').list()).items[0].data.name, 'Loaded from disk');",
      ),
    );
    const passed = run("test");
    expect(passed, passed.output).toMatchObject({ status: 0 });
    expect(passed.output).toContain(
      "PASS scenario-proof: independent behavior",
    );
    expect(passed.output).toContain("1/1 module-owned scenarios passed.");

    await writeFile(
      entry,
      scenario(
        "assert.equal((await client.resource('items').list()).items.length, 20, 'Module assertion reached');",
      ),
    );
    const failed = run("test");
    expect(failed.status).toBe(1);
    expect(failed.output).toContain(
      "FAIL scenario-proof: independent behavior",
    );
    expect(failed.output).toContain("Module assertion reached");

    await writeFile(
      entry,
      scenario("await client.resource('missing').list();"),
    );
    const invalid = run("check");
    expect(invalid.status).toBe(1);
    expect(invalid.output).toContain("module.scenarios.ts");
    expect(invalid.output).toContain("not assignable to parameter of type");

    await rm(entry);
    const absent = run("test");
    expect(absent.status).toBe(1);
    expect(absent.output).toContain("No module-owned scenarios");

    await writeFile(
      resolve(directory, "fixtures.json"),
      JSON.stringify({ items: [{ name: 4 }] }),
    );
    const fixtures = run("check");
    expect(fixtures.status).toBe(1);
    expect(fixtures.output).toContain("Fixture items[0]");
    await rm(resolve(directory, "fixtures.json"));
    const source = await readFile(resolve(directory, "module.ts"), "utf8");
    await writeFile(
      resolve(directory, "module.ts"),
      source.replace(
        "dependencies:{}",
        "dependencies:{'scenario-provider':'^1.0.0'}",
      ),
    );
    const missingDependency = run("check");
    expect(missingDependency.status).toBe(1);
    expect(missingDependency.output).toContain(
      "No compatible official release set",
    );
    const provider = resolve(directory, "provider");
    await mkdir(provider);
    await writeFile(
      resolve(provider, "module.ts"),
      source.replaceAll("scenario-proof", "scenario-provider"),
    );
    const suppliedDependency = run("check", ["--dependency", provider]);
    expect(suppliedDependency, suppliedDependency.output).toMatchObject({
      status: 0,
    });
    expect(await readFile("packages/module-catalog/src/index.ts", "utf8")).toBe(
      catalog,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
