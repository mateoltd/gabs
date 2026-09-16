import { buildClientViews } from "../packages/module-sdk/node/build-client";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import { validateFixtures } from "@suite/module-sdk/simulator";
import { moduleServers } from "@suite/module-catalog/server";
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { identifier, type ModuleDefinition } from "@suite/module-sdk";
import { canonical, resolveReleases } from "@suite/module-sdk/registry";
import { moduleDefinitions } from "@suite/module-catalog";
import {
  signPackage,
  verifyPackage,
  type SignedPackage,
} from "../packages/module-sdk/node/signing";
const [command, name] = process.argv.slice(2);
const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
const execute = (args: string[]) => {
  const result = spawnSync("pnpm", args, { stdio: "inherit" });
  if (result.status) process.exit(result.status);
};
if (command === "keygen") {
  await mkdir(keys, { recursive: true, mode: 0o700 });
  const pair = generateKeyPairSync("ed25519");
  await writeFile(
    `${keys}/private.pem`,
    pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    `${keys}/public.pem`,
    pair.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644, flag: "wx" },
  );
  console.log(
    "Created local module signing keys. Never commit the private key.",
  );
} else if (command === "create") {
  if (!name || !identifier.test(name))
    throw Error("Usage: pnpm module create <lowercase-module-id>");
  await mkdir(`modules/${name}`);
  await writeFile(
    `modules/${name}/package.json`,
    JSON.stringify(
      {
        name: `@suite/${name}`,
        version: "1.0.0",
        private: true,
        type: "module",
        exports: { ".": "./module.ts" },
        dependencies: { "@suite/module-sdk": "workspace:*" },
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(
    `modules/${name}/module.ts`,
    `import {defineModule,resource,field,Type} from '@suite/module-sdk';\nexport default defineModule({id:'${name}',name:'${name}',version:'1.0.0',description:'${name} records',host:'^1.0.0',backend:'^1.0.0',publisher:'suite',dependencies:{},permissions:['${name}.items.read','${name}.items.write'],configuration:Type.Object({},{additionalProperties:false}),operations:{},navigation:{path:'/${name}',permission:'${name}.items.read'},resources:{items:resource({name:field.text({minLength:1})},{title:'Items',standalone:true})}});\n`,
  );
  await writeFile(
    `modules/${name}/fixtures.json`,
    JSON.stringify({ items: [{ name: "Example record" }] }, null, 2) + "\n",
  );
  execute(["modules:discover"]);
  console.log(
    `Created ${name}. Run pnpm install, then pnpm module check ${name}.`,
  );
} else if (command === "dev") {
  execute(["exec", "tsx", "watch", "tooling/module-dev.ts", name ?? ""]);
} else if (command === "check" || command === "test") {
  if (name && !moduleDefinitions.some((m) => m.id === name))
    throw Error("Module not discovered. Run pnpm modules:discover.");
  const selected = name
    ? moduleDefinitions.filter((m) => m.id === name)
    : moduleDefinitions;
  for (const module of selected) {
    resolveReleases(module.id, moduleDefinitions, "1.0.0", "1.0.0");
    try {
      const fixtures = JSON.parse(
        await readFile(`modules/${module.id}/fixtures.json`, "utf8"),
      );
      validateFixtures(module, fixtures);
      console.log(`Validated fixtures for ${module.id}.`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  execute(["typecheck"]);
  if (command === "test")
    execute(["exec", "vitest", "run", "tests/module-sdk.test.ts"]);
  console.log(`${selected.length} module definitions validated.`);
} else if (command === "build") {
  if (!name) throw Error("Usage: pnpm module build <module-id-or-directory>");
  const directory = identifier.test(name)
    ? resolve(`modules/${name}`)
    : resolve(name);
  const module = (
    await import(pathToFileURL(resolve(directory, "module.ts")).href)
  ).default as ModuleDefinition;
  resolveReleases(
    module.id,
    [...moduleDefinitions.filter((m) => m.id !== module.id), module],
    "1.0.0",
    "1.0.0",
  );
  const key = await readFile(`${keys}/private.pem`, "utf8");
  const pkg = signPackage(
    module,
    key,
    await buildClientViews(module, directory),
  );
  await mkdir(".local/modules", { recursive: true });
  const path = `.local/modules/${module.id}-${module.version}.json`;
  await writeFile(path, JSON.stringify(pkg, null, 2));
  await writeFile(
    path.replace(".json", ".md"),
    `# ${module.name}\n\n${module.description}\n\nVersion: ${module.version}\n\n## Resources\n${Object.entries(
      module.resources,
    )
      .map(
        ([id, r]) =>
          `- ${id}: ${r.policy}, fields ${Object.keys(r.schema.properties).join(", ")}`,
      )
      .join("\n")}\n`,
  );
  console.log(path);
} else if (command === "publish") {
  const pkg = JSON.parse(await readFile(name, "utf8")) as SignedPackage;
  verifyPackage(pkg, await readFile(`${keys}/public.pem`, "utf8"));
  if (
    Object.keys((pkg.artifact as unknown as ModuleDefinition).operations)
      .length &&
    !moduleServers.some(
      (server) =>
        server.module.id === pkg.module_id &&
        server.module.version === pkg.version &&
        canonical(server.module) === canonical(moduleContract(pkg.artifact)),
    )
  )
    throw Error(
      "Stage a reviewed module-server.ts with the exact signed contract before publication.",
    );
  const pool = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
  });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = await client.query(
      "select digest from suite.module_releases where module_id=$1 and version=$2",
      [pkg.module_id, pkg.version],
    );
    if (old.rowCount && old.rows[0].digest !== pkg.digest)
      throw Error(
        "Published versions are immutable. Increment the module version.",
      );
    await client.query(
      "insert into suite.module_releases(module_id,version,manifest,digest,signature,key_id,artifact) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing",
      [
        pkg.module_id,
        pkg.version,
        pkg.manifest,
        pkg.digest,
        pkg.signature,
        pkg.key_id,
        pkg.artifact,
      ],
    );
    await client.query(
      "insert into suite.entitlements(workspace_id,module_id,active) select id,$1,false from suite.workspaces on conflict do nothing",
      [pkg.module_id],
    );
    await client.query(
      "insert into suite.module_activations(workspace_id,module_id,state,config) select id,$1,'draft','{}' from suite.workspaces on conflict do nothing",
      [pkg.module_id],
    );
    await client.query(
      "update suite.roles set permissions=ARRAY(SELECT DISTINCT unnest(permissions || $1::text[])) where protected and name in ('Owner','Administrator')",
      [pkg.manifest.permissions],
    );
    await client.query("COMMIT");
    console.log(
      `Published ${pkg.module_id}@${pkg.version}. Entitlement and publication remain separate administrator actions.`,
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
} else if (command === "inspect") {
  const pkg = JSON.parse(await readFile(name, "utf8")) as SignedPackage;
  verifyPackage(pkg, await readFile(`${keys}/public.pem`, "utf8"));
  console.log(JSON.stringify(pkg.manifest, null, 2));
} else
  throw Error(
    "Commands: create, dev, check, test, keygen, build, publish, inspect",
  );
