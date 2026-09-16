import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { moduleServers } from "@suite/module-catalog/server";
import { buildClientViews } from "../packages/module-sdk/node/build-client";
import { moduleDefinitions } from "@suite/module-catalog";
import {
  signPackage,
  verifyPackage,
} from "../packages/module-sdk/node/signing";
import type { Pool } from "pg";
import {
  submitRelease,
  reviewRelease,
  stageRelease,
  publishRelease,
} from "./registry-review";
/** Local fixtures use local trust roots. Production publishing always uses the explicit CLI. */
export async function seedRegistry(db: Pool) {
  if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
    throw Error("Registry fixtures are restricted to development and test.");
  const directory =
    process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys";
  await mkdir(directory, { recursive: true, mode: 0o700 });
  let privateKey: string;
  try {
    privateKey = await readFile(`${directory}/private.pem`, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    privateKey = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    await writeFile(`${directory}/private.pem`, privateKey, {
      flag: "wx",
      mode: 0o600,
    });
  }
  const publicKey = createPublicKey(privateKey)
    .export({ type: "spki", format: "pem" })
    .toString();
  try {
    await writeFile(`${directory}/public.pem`, publicKey, {
      flag: "wx",
      mode: 0o644,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const trusted =
    process.env.MODULE_SIGNING_PUBLIC_KEY ??
    (await readFile(`${directory}/public.pem`, "utf8"));
  const releases = new Map(
    [...moduleDefinitions, ...moduleServers.map((server) => server.module)].map(
      (module) => [`${module.id}@${module.version}`, module],
    ),
  );
  for (const module of releases.values()) {
    const client = await buildClientViews(module, `modules/${module.id}`);
    const pkg = verifyPackage(signPackage(module, privateKey, client), trusted);
    const old = (
      await db.query(
        "select digest from suite.module_releases where module_id=$1 and version=$2",
        [pkg.module_id, pkg.version],
      )
    ).rows[0];
    if (old && old.digest !== pkg.digest)
      throw Error(
        `Published ${module.id}@${module.version} changed. Increment its version.`,
      );
    if (old) continue;
    const id = await submitRelease(
      db,
      pkg,
      null,
      trusted,
      Object.keys(module.operations).length > 0,
    );
    await reviewRelease(
      db,
      id,
      "approved",
      "Local development fixture from the checked-out host baseline",
      trusted,
    );
    await stageRelease(db, id, trusted, moduleServers);
    await publishRelease(db, id, trusted);
  }
}
