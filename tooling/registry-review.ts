import { requiresServer } from "@suite/module-sdk/local-artifact";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { hydrateModule } from "@suite/module-sdk";
import {
  canonical,
  satisfies,
  resolveReleases,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import { moduleContract } from "@suite/module-sdk/client-artifact";
import {
  verifyPackage,
  type SignedPackage,
} from "../packages/module-sdk/node/signing";
import {
  verifyServerPackage,
  loadServerPackage,
  type ServerPackage,
} from "../packages/module-sdk/node/server-package";
import type { InstalledModuleServer } from "../packages/server-core/src/module-services";

export interface Submission {
  id: string;
  module_id: string;
  version: string;
  client_package: SignedPackage;
  server_package: ServerPackage | null;
  backend_kind: "none" | "builtin" | "bundled";
  state: "pending" | "approved" | "rejected" | "published";
  review_reason: string | null;
  staged_at: Date | null;
}
async function transaction<T>(pool: Pool, run: (db: PoolClient) => Promise<T>) {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const value = await run(db);
    await db.query("COMMIT");
    return value;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    db.release();
  }
}
async function locked(db: PoolClient, id: string) {
  const result = await db.query<Submission>(
    "select * from suite.module_submissions where id=$1 for update",
    [id],
  );
  if (!result.rows[0]) throw Error("Submission not found.");
  return result.rows[0];
}
function verifySubmission(
  row: Pick<Submission, "client_package" | "server_package" | "backend_kind">,
  publicKey: string,
) {
  const pkg = verifyPackage(row.client_package, publicKey);
  const module = hydrateModule(moduleContract(pkg.artifact));
  if (!satisfies("1.0.0", module.host) || !satisfies("1.0.0", module.backend))
    throw Error(
      "The submitted contract is incompatible with this host/backend.",
    );
  if (
    canonical(pkg.manifest) !==
    canonical({
      id: module.id,
      version: module.version,
      publisher: module.publisher,
      host: module.host,
      backend: module.backend,
      dependencies: module.dependencies,
      permissions: module.permissions,
      ...(module.storage ? { storage: module.storage } : {}),
      ...(module.localStorage ? { localStorage: module.localStorage } : {}),
    })
  )
    throw Error("Manifest metadata differs from the signed module contract.");
  if (row.server_package) {
    verifyServerPackage(row.server_package, publicKey);
    if (canonical(row.server_package.payload.module) !== canonical(module))
      throw Error("Client and server contracts must match exactly.");
  }
  if (requiresServer(module) && row.backend_kind === "none")
    throw Error(
      "Operation-bearing submissions and storage migrations require a signed server component.",
    );
  return module;
}
export async function submitRelease(
  pool: Pool,
  pkg: SignedPackage,
  server: ServerPackage | null,
  publicKey: string,
  builtin = false,
) {
  const backend_kind = server ? "bundled" : builtin ? "builtin" : "none";
  verifySubmission(
    { client_package: pkg, server_package: server, backend_kind },
    publicKey,
  );
  return transaction(pool, async (db) => {
    const publisher = await db.query(
      "select status from suite.module_publishers where id=$1",
      [pkg.manifest.publisher],
    );
    if (publisher.rows[0]?.status !== "official")
      throw Error("Only official publishers may submit modules at this stage.");
    const id = randomUUID();
    await db.query(
      "insert into suite.module_submissions(id,module_id,version,publisher_id,client_package,server_package,backend_kind) values($1,$2,$3,$4,$5,$6,$7) on conflict(module_id,version) do nothing",
      [
        id,
        pkg.module_id,
        pkg.version,
        pkg.manifest.publisher,
        pkg,
        server,
        backend_kind,
      ],
    );
    const result = await db.query<Submission>(
      "select * from suite.module_submissions where module_id=$1 and version=$2",
      [pkg.module_id, pkg.version],
    );
    const row = result.rows[0];
    if (
      canonical(row.client_package) !== canonical(pkg) ||
      canonical(row.server_package) !== canonical(server) ||
      row.backend_kind !== backend_kind
    )
      throw Error(
        "Submitted versions are immutable. Increment the module version.",
      );
    return row.id;
  });
}
export async function reviewRelease(
  pool: Pool,
  id: string,
  decision: "approved" | "rejected",
  reason: string,
  publicKey: string,
) {
  if (!reason.trim()) throw Error("A review reason is required.");
  return transaction(pool, async (db) => {
    const row = await locked(db, id);
    if (row.state === decision && row.review_reason === reason) return;
    if (row.state !== "pending")
      throw Error("This submission already has an immutable review decision.");
    verifySubmission(row, publicKey);
    await db.query(
      "update suite.module_submissions set state=$2,review_reason=$3 where id=$1",
      [id, decision, reason],
    );
  });
}
export async function stageRelease(
  pool: Pool,
  id: string,
  publicKey: string,
  builtins: readonly InstalledModuleServer[] = [],
) {
  return transaction(pool, async (db) => {
    const row = await locked(db, id);
    if (!["approved", "published"].includes(row.state))
      throw Error("Approve the submission before staging its server.");
    const module = verifySubmission(row, publicKey);
    if (row.backend_kind === "bundled")
      await loadServerPackage(row.server_package!, publicKey);
    if (
      row.backend_kind === "builtin" &&
      !builtins.some((s) => canonical(s.module) === canonical(module))
    )
      throw Error(
        "The reviewed builtin backend is not present in this host build.",
      );
    if (!row.staged_at)
      await db.query(
        "update suite.module_submissions set staged_at=now() where id=$1",
        [id],
      );
  });
}
export async function publishRelease(
  pool: Pool,
  id: string,
  publicKey: string,
) {
  return transaction(pool, async (db) => {
    const row = await locked(db, id);
    if (!["approved", "published"].includes(row.state))
      throw Error("Release requires an approved submission.");
    verifySubmission(row, publicKey);
    if (row.backend_kind !== "none" && !row.staged_at)
      throw Error(
        "Stage the reviewed server component before publishing the client.",
      );
    const pkg = row.client_package;
    const available = await db.query<{ manifest: ReleaseManifest }>(
      "select manifest from suite.module_releases",
    );
    resolveReleases(
      pkg.module_id,
      [
        ...available.rows.map((r) => r.manifest),
        pkg.manifest as unknown as ReleaseManifest,
      ],
      "1.0.0",
      "1.0.0",
      { [pkg.module_id]: pkg.version },
    );
    const old = await db.query(
      "select digest from suite.module_releases where module_id=$1 and version=$2",
      [pkg.module_id, pkg.version],
    );
    if (old.rows[0] && old.rows[0].digest !== pkg.digest)
      throw Error("Published versions are immutable.");
    await db.query(
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
    return pkg;
  });
}
