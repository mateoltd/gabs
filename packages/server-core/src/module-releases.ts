import { readFile } from "node:fs/promises";
import { moduleDefinition } from "@suite/module-catalog";
import { hydrateModule, type ModuleDefinition } from "@suite/module-sdk";
import {
  resolveReleases,
  type ReleaseManifest,
} from "@suite/module-sdk/registry";
import { verifyPackage } from "../../module-sdk/node/signing";
import type { Tx } from "./database";
import { found, AppError } from "./errors";
export const registryPublicKey = async () =>
  process.env.MODULE_SIGNING_PUBLIC_KEY ??
  (await readFile(
    `${process.env.MODULE_SIGNING_DIRECTORY ?? ".local/module-keys"}/public.pem`,
    "utf8",
  ));
export async function resolveWorkspaceRelease(
  tx: Tx,
  workspaceId: string,
  id: string,
) {
  const releases = await tx
    .selectFrom("suite.module_releases")
    .selectAll()
    .execute();
  const rows = await tx
    .selectFrom("suite.platform_settings")
    .selectAll()
    .where("workspace_id", "=", workspaceId)
    .where("key", "like", "pin:%")
    .execute();
  const pins = Object.fromEntries(
    rows
      .filter((r) => r.value.version)
      .map((r) => [r.key.slice(4), String(r.value.version)]),
  );
  let plan: ReleaseManifest[];
  try {
    plan = resolveReleases(
      id,
      releases.map((r) => r.manifest as unknown as ReleaseManifest),
      "1.0.0",
      "1.0.0",
      pins,
    );
  } catch (error) {
    throw new AppError(409, "RELEASE_INCOMPATIBLE", (error as Error).message);
  }
  const publicKey = await registryPublicKey();
  return plan.map((item) =>
    verifyPackage(
      found(
        releases.find(
          (r) => r.module_id === item.id && r.version === item.version,
        ),
      ),
      publicKey,
    ),
  );
}
export async function workspaceModule(
  tx: Tx,
  workspaceId: string,
  id: string,
): Promise<ModuleDefinition> {
  const published = await tx
    .selectFrom("suite.module_releases")
    .select("version")
    .where("module_id", "=", id)
    .executeTakeFirst();
  if (!published) return found(moduleDefinition(id));
  const plan = await resolveWorkspaceRelease(tx, workspaceId, id);
  return hydrateModule(
    found(plan.find((p) => p.module_id === id))
      .artifact as unknown as ModuleDefinition,
  );
}
