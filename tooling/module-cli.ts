import { buildLocalBundle } from "../packages/module-sdk/node/build-local";
import { requiresServer } from "@suite/module-sdk/local-artifact";
import { buildClientViews } from "../packages/module-sdk/node/build-client";
import { buildServerPackage } from "../packages/module-sdk/node/build-server";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "./registry-review";
import type { ServerPackage } from "../packages/module-sdk/node/server-package";
import { validateFixtures } from "@suite/module-sdk/simulator";
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { identifier, type ModuleDefinition } from "@suite/module-sdk";
import { resolveReleases } from "@suite/module-sdk/registry";
import { moduleDefinitions } from "@suite/module-catalog";
import { moduleServers } from "@suite/module-catalog/server";
import { canonical } from "@suite/module-sdk/registry";
import {
  signPackage,
  verifyPackage,
  type SignedPackage,
} from "../packages/module-sdk/node/signing";
const [command, name, ...args] = process.argv.slice(2);
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
} else if (command === "console") {
  const { buildRegistryConsole } = await import("./registry-console/build");
  const { startRegistryConsole } = await import("./registry-console/server");
  const url =
    process.env.REGISTRY_DATABASE_URL ||
    (["development", "test"].includes(process.env.NODE_ENV ?? "")
      ? process.env.MIGRATION_DATABASE_URL
      : undefined);
  if (!url)
    throw Error(
      "REGISTRY_DATABASE_URL is required for protected release tooling.",
    );
  const pool = new Pool({ connectionString: url });
  try {
    const consoleServer = await startRegistryConsole({
      pool,
      publicKey:
        process.env.MODULE_SIGNING_PUBLIC_KEY ??
        (await readFile(`${keys}/public.pem`, "utf8")),
      assets: await buildRegistryConsole(),
      port: Number(process.env.REGISTRY_CONSOLE_PORT ?? 4322),
      builtins: moduleServers,
    });
    console.log(
      `Registry operator console: ${consoleServer.origin}\nAccess code: ${consoleServer.accessCode}\nKeep this terminal open. Decisions use the authenticated registry database identity.`,
    );
    const close = async () => {
      await consoleServer.close();
      await pool.end();
      process.exit(0);
    };
    process.once("SIGINT", () => void close());
    process.once("SIGTERM", () => void close());
  } catch (error) {
    await pool.end();
    throw error;
  }
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
} else if (command === "services") {
  if (!name || !args[0])
    throw Error(
      "Usage: pnpm module services <module-id-or-directory> <output.ts>",
    );
  const directory = identifier.test(name)
    ? resolve(`modules/${name}`)
    : resolve(name);
  const module = (
    await import(pathToFileURL(resolve(directory, "module.ts")).href)
  ).default as ModuleDefinition;
  const { serviceContractSource } =
    await import("../packages/module-sdk/node/service-contracts");
  const { format } = await import("prettier");
  const source = await format(serviceContractSource(module), {
    parser: "typescript",
  });
  if (args.includes("--check")) {
    if ((await readFile(resolve(args[0]), "utf8")) !== source)
      throw Error(
        "The service snapshot differs from the provider. Review the new contract, then regenerate with --update.",
      );
  } else
    await writeFile(resolve(args[0]), source, {
      flag: args.includes("--update") ? "w" : "wx",
    });
  console.log(
    `${args.includes("--check") ? "Verified" : "Exported"} typed public services for ${module.id}@${module.version} at ${args[0]}. Declare its dependency and request administrator grants.`,
  );
} else if (command === "build") {
  if (!name) throw Error("Usage: pnpm module build <module-id-or-directory>");
  const directory = identifier.test(name)
    ? resolve(`modules/${name}`)
    : resolve(name);
  const module = (
    await import(pathToFileURL(resolve(directory, "module.ts")).href)
  ).default as ModuleDefinition;
  let available = [
    ...moduleDefinitions.filter((m) => m.id !== module.id),
    module,
  ];
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== "--dependency" || !args[index + 1])
      throw Error(
        "Usage: pnpm module build <module-id-or-directory> [--dependency <provider-directory>]...",
      );
    const dependency = (
      await import(pathToFileURL(resolve(args[index + 1], "module.ts")).href)
    ).default as ModuleDefinition;
    if (dependency.id === module.id)
      throw Error("A dependency cannot replace the module being built.");
    available = [
      ...available.filter((m) => m.id !== dependency.id),
      dependency,
    ];
  }
  resolveReleases(module.id, available, "1.0.0", "1.0.0");
  const key = await readFile(`${keys}/private.pem`, "utf8");
  const pkg = signPackage(
    module,
    key,
    await buildClientViews(module, directory),
    await buildLocalBundle(module, directory),
  );
  await mkdir(".local/modules", { recursive: true });
  const path = `.local/modules/${module.id}-${module.version}.json`;
  await writeFile(path, JSON.stringify(pkg, null, 2));
  if (requiresServer(module)) {
    const builtin = moduleServers.find(
      (server) =>
        server.kind === "trusted" &&
        canonical(server.module) === canonical(module),
    );
    if (builtin)
      console.warn(
        "Built the client package. This legacy trusted backend ships with the host; migrate it to scoped SDK capabilities before independent server publication.",
      );
    else {
      const server = await buildServerPackage(module, directory, key);
      await writeFile(
        path.replace(".json", ".server.json"),
        JSON.stringify(server, null, 2),
      );
    }
  }
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
} else if (
  ["submit", "review", "stage", "publish", "submissions"].includes(command)
) {
  const url =
    process.env.REGISTRY_DATABASE_URL ||
    (["development", "test"].includes(process.env.NODE_ENV ?? "")
      ? process.env.MIGRATION_DATABASE_URL
      : undefined);
  if (!url)
    throw Error(
      "REGISTRY_DATABASE_URL is required for protected release tooling.",
    );
  const pool = new Pool({ connectionString: url });
  try {
    const publicKey =
      process.env.MODULE_SIGNING_PUBLIC_KEY ??
      (await readFile(`${keys}/public.pem`, "utf8"));
    if (command === "submit") {
      const pkg = JSON.parse(await readFile(name, "utf8")) as SignedPackage;
      const server = args[0]
        ? (JSON.parse(await readFile(args[0], "utf8")) as ServerPackage)
        : null;
      const id = await submitRelease(pool, pkg, server, publicKey);
      console.log(id);
    } else if (command === "review") {
      if (!["approve", "reject"].includes(args[0]) || !args[1]?.trim())
        throw Error(
          "Usage: pnpm module review <submission-id> <approve|reject> <reason>",
        );
      await reviewRelease(
        pool,
        name,
        args[0] === "approve" ? "approved" : "rejected",
        args[1],
        publicKey,
      );
      console.log(`Review recorded for ${name}.`);
    } else if (command === "stage") {
      await stageRelease(pool, name, publicKey);
      console.log(
        `Reviewed server staged for ${name}. Client publication remains separate.`,
      );
    } else if (command === "publish") {
      let id = name;
      if (name.endsWith(".json")) {
        const pkg = JSON.parse(await readFile(name, "utf8")) as SignedPackage;
        verifyPackage(pkg, publicKey);
        const match = await pool.query(
          "select id from suite.module_submissions where module_id=$1 and version=$2 and client_package->>'digest'=$3",
          [pkg.module_id, pkg.version, pkg.digest],
        );
        if (!match.rows[0])
          throw Error(
            "Submit, review and stage this release before publishing it.",
          );
        id = match.rows[0].id;
      }
      const pkg = await publishRelease(pool, id, publicKey);
      console.log(
        `Published ${pkg.module_id}@${pkg.version}. Entitlement, configuration and employee publication remain separate administrator actions.`,
      );
    } else {
      const result = name
        ? await pool.query(
            "select * from suite.module_submissions where id=$1",
            [name],
          )
        : await pool.query(
            "select id,module_id,version,publisher_id,state,backend_kind,submitted_by,submitted_at,reviewed_by,review_reason,staged_at,client_package->>'digest' as client_digest,server_package->>'digest' as server_digest from suite.module_submissions order by submitted_at desc limit 100",
          );
      console.log(JSON.stringify(result.rows, null, 2));
    }
  } finally {
    await pool.end();
  }
} else if (command === "inspect") {
  const pkg = JSON.parse(await readFile(name, "utf8")) as SignedPackage;
  verifyPackage(pkg, await readFile(`${keys}/public.pem`, "utf8"));
  console.log(JSON.stringify(pkg.manifest, null, 2));
} else
  throw Error(
    "Commands: create, dev, check, test, services, keygen, build, submit, submissions, review, stage, publish, inspect, console",
  );
