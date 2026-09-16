import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { SignedArtifact } from "@suite/module-sdk/platform";
export async function publishLocalPackage(
  options: {
    localStorage?: import("@suite/module-sdk").StorageContract;
    field?: "text" | "body";
    migrationOnly?: boolean;
    migrationDelayMs?: number;
    migrationError?: boolean;
    dependencies?: Record<string, string>;
    dependencyPackages?: SignedArtifact[];
    name?: string;
    id?: string;
    version?: string;
    prefix?: string;
    maxLength?: number;
  } = {},
) {
  await mkdir(".local", { recursive: true });
  const directory = await mkdtemp(resolve(".local/standalone-package-"));
  const id = options.id ?? `local-notes-${randomUUID().slice(0, 8)}`,
    version = options.version ?? "1.0.0";
  const field = options.field ?? "text";
  const operations = options.migrationOnly
    ? "{}"
    : `{capture:operation({title:'Capture note',policy:'local',permission:'${id}.capture',input:Type.Object({text:Type.String(),delayMs:Type.Optional(Type.Integer({minimum:0,maximum:30000})),reject:Type.Optional(Type.Boolean())}),output:Type.String(),errors:Type.Object({reason:Type.Literal('blocked')})})}`;
  const handlers = options.migrationOnly
    ? "{}"
    : `{async capture(ctx,input){if(input.delayMs)await new Promise(resolve=>setTimeout(resolve,input.delayMs));if(input.reject)ctx.reject({reason:'blocked'});const row=await ctx.resource('items').create({${field}:${JSON.stringify(options.prefix ?? "")}+(ctx.configuration.prefix??'')+input.text});return row.id;}}`;
  const migrations = options.localStorage
    ? ",{" +
      Object.keys(options.localStorage.migrations)
        .map(
          (name) =>
            `${JSON.stringify(name)}:async(ctx)=>{if(${options.migrationDelayMs ?? 0})await new Promise(resolve=>setTimeout(resolve,${options.migrationDelayMs ?? 0}));let after;do{const page=await ctx.resource('items').scan(after);for(const row of page.items)await ctx.resource('items').write(row.id,{${field}:row.data.text??row.data.body},row.version);after=page.nextCursor??undefined;}while(after);${options.migrationError ? 'throw Error("Migration fixture failure");' : ""}}`,
        )
        .join(",") +
      "}"
    : "";
  try {
    await writeFile(
      resolve(directory, "module.ts"),
      `import {defineModule,resource,field,operation,Type} from '@suite/module-sdk';
export default defineModule({id:'${id}',name:${JSON.stringify(options.name ?? "Local package notes")},version:'${version}',description:'Independent local handler acceptance',host:'^1.0.0',backend:'^1.0.0',publisher:'suite',dependencies:${JSON.stringify(options.dependencies ?? {})},permissions:['${id}.items.read','${id}.items.write','${id}.capture'],configuration:Type.Object({prefix:Type.Optional(Type.String())},{additionalProperties:false}),${options.localStorage ? "localStorage:" + JSON.stringify(options.localStorage) + "," : ""}resources:{items:resource({${field}:field.text({maxLength:${options.maxLength ?? 500}})},{title:'Notes',standalone:true,policy:'local'})},operations:${operations}});`,
    );
    await writeFile(
      resolve(directory, "module-local.ts"),
      `import {defineLocalModule} from '@suite/module-sdk/local';import module from './module';export default defineLocalModule(module)(${handlers}${migrations});`,
    );
    const dependencyArgs: string[] = [];
    for (const pkg of options.dependencyPackages ?? []) {
      const path = resolve(directory, "dependencies", pkg.module_id);
      await mkdir(path, { recursive: true });
      const { local: _local, client: _client, ...contract } = pkg.artifact;
      await writeFile(
        resolve(path, "module.ts"),
        `export default ${JSON.stringify(contract)};`,
      );
      dependencyArgs.push("--dependency", path);
    }
    execFileSync("pnpm", ["module", "build", directory, ...dependencyArgs], {
      stdio: "pipe",
    });
    const path = `.local/modules/${id}-${version}.json`;
    const submission = execFileSync("pnpm", ["module", "submit", path], {
      encoding: "utf8",
      stdio: "pipe",
    })
      .trim()
      .split("\n")
      .at(-1)!;
    execFileSync(
      "pnpm",
      [
        "module",
        "review",
        submission,
        "approve",
        "Reviewed independent local handler fixture",
      ],
      { stdio: "pipe" },
    );
    execFileSync("pnpm", ["module", "publish", path], { stdio: "pipe" });
    return {
      pkg: JSON.parse(await readFile(path, "utf8")) as SignedArtifact,
      submission,
      path,
      publicKey: await readFile(
        `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
        "utf8",
      ),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
