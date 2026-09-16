import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { SignedArtifact } from "@suite/module-sdk/platform";
export async function publishLocalPackage(
  options: {
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
  try {
    await writeFile(
      resolve(directory, "module.ts"),
      `import {defineModule,resource,field,operation,Type} from '@suite/module-sdk';
export default defineModule({id:'${id}',name:'Local package notes',version:'${version}',description:'Independent local handler acceptance',host:'^1.0.0',backend:'^1.0.0',publisher:'suite',dependencies:{},permissions:['${id}.items.read','${id}.items.write','${id}.capture'],configuration:Type.Object({},{additionalProperties:false}),resources:{items:resource({text:field.text({maxLength:${options.maxLength ?? 500}})},{title:'Notes',standalone:true})},operations:{capture:operation({title:'Capture note',policy:'local',permission:'${id}.capture',input:Type.Object({text:Type.String()}),output:Type.String()})}});`,
    );
    await writeFile(
      resolve(directory, "module-local.ts"),
      `import {defineLocalModule} from '@suite/module-sdk/local';import module from './module';export default defineLocalModule(module)({async capture(ctx,input){const row=await ctx.resource('items').create({text:${JSON.stringify(options.prefix ?? "")}+input.text});return row.id;}});`,
    );
    execFileSync("pnpm", ["module", "build", directory], { stdio: "pipe" });
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
