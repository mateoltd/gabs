import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { hydrateModule } from "@suite/module-sdk";
import inventorySource from "../../modules/inventory/releases/2.0.0/module";
import ordersSource from "../../modules/orders/releases/2.0.0/module";
import { serviceContractSource } from "../../packages/module-sdk/node/service-contracts";
import { buildServerPackage } from "../../packages/module-sdk/node/build-server";
import { signPackage } from "../../packages/module-sdk/node/signing";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "../../tooling/registry-review";

/** Publish isolated, independently signed candidates without changing default workspace releases. */
export async function scopedBusinessFixture() {
  const version = `2.0.0-acceptance.${randomUUID().slice(0, 8)}`;
  const inventory = hydrateModule(
    JSON.parse(JSON.stringify({ ...inventorySource, version })),
  ) as typeof inventorySource;
  const orders = hydrateModule(
    JSON.parse(
      JSON.stringify({
        ...ordersSource,
        version,
        dependencies: { inventory: version },
        services: Object.fromEntries(
          Object.entries(ordersSource.services).map(([key, value]) => [
            key,
            { ...value, version },
          ]),
        ),
      }),
    ),
  ) as typeof ordersSource;
  const registry = new Pool({
    connectionString: process.env.MIGRATION_DATABASE_URL,
    options: "-c role=suite_registry",
  });
  const directory = await mkdtemp(resolve(".local/scoped-business-ui-"));
  try {
    const keys = process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
    const privateKey = await readFile(`${keys}/private.pem`, "utf8"),
      publicKey = await readFile(`${keys}/public.pem`, "utf8");
    for (const definition of [inventory, orders]) {
      const source = resolve(`modules/${definition.id}/releases/2.0.0`),
        output = resolve(directory, definition.id);
      await mkdir(output);
      await writeFile(
        resolve(output, "module.ts"),
        (await readFile(resolve(source, "module.ts"), "utf8"))
          .replace('version: "2.0.0"', `version: "${version}"`)
          .replace('inventory: "^2.0.0"', `inventory: "${version}"`),
      );
      await writeFile(
        resolve(output, "module-server.ts"),
        await readFile(resolve(source, "module-server.ts")),
      );
      if (definition.id === "orders")
        await writeFile(
          resolve(output, "inventory-services.ts"),
          serviceContractSource(inventory),
        );
      const backend = await buildServerPackage(definition, output, privateKey);
      const submission = await submitRelease(
        registry,
        signPackage(definition, privateKey),
        backend,
        publicKey,
      );
      await reviewRelease(
        registry,
        submission,
        "approved",
        "Scoped business interface acceptance",
        publicKey,
      );
      await stageRelease(registry, submission, publicKey);
      await publishRelease(registry, submission, publicKey);
    }
    return { version, inventory, orders };
  } finally {
    await registry.end();
    await rm(directory, { recursive: true, force: true });
  }
}
