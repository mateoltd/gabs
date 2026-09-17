import type { ModuleDefinition } from "@suite/module-sdk";
import { sql } from "kysely";
import type { ScopedModuleServer } from "@suite/module-sdk/server";
import {
  loadServerPackage,
  verifyServerPackage,
  type ServerPackage,
} from "@suite/module-sdk/node/server-package";
import type { Tx } from "../persistence/database";
import type { InstalledModuleServer } from "../runtime/services";
import { registryPublicKey } from "./module-releases";
import { requireCondition } from "../errors";
import { VerifiedContent } from "./verified-content";
const loaded = new Map<string, Promise<ScopedModuleServer>>();
const verifiedPackages = new VerifiedContent((json, key) =>
  verifyServerPackage(JSON.parse(json) as ServerPackage, key),
);

/** Reviewed server artifacts are deployed independently of the API executable. */
export async function stagedModuleServer(
  tx: Tx,
  module: ModuleDefinition,
  builtins: readonly InstalledModuleServer[],
) {
  const row = await tx
    .selectFrom("suite.module_submissions as s")
    .innerJoin("suite.module_publishers as p", "p.id", "s.publisher_id")
    .select([
      "s.backend_kind",
      sql<string | null>`s.server_package::text`.as("server_package"),
      "s.state",
      "s.staged_at",
      "p.status",
    ])
    .where("s.module_id", "=", module.id)
    .where("s.version", "=", module.version)
    .executeTakeFirst();
  if (row) {
    requireCondition(
      row.state === "published" && row.status === "official",
      409,
      "BACKEND_UNAVAILABLE",
      "The server release is not published by an active official publisher.",
    );
    if (row.backend_kind === "bundled") {
      requireCondition(
        row.staged_at && row.server_package,
        409,
        "BACKEND_UNAVAILABLE",
        "The reviewed backend has not been staged.",
      );
      const key = await registryPublicKey();
      const pkg = verifiedPackages.get(row.server_package, key);
      if (!loaded.has(pkg.digest)) {
        const loading = loadServerPackage(pkg, key);
        loaded.set(pkg.digest, loading);
        void loading.catch(() => loaded.delete(pkg.digest));
      }
      return loaded.get(pkg.digest)!;
    }
  }
  return builtins.find(
    (server) =>
      server.module.id === module.id &&
      server.module.version === module.version,
  );
}
