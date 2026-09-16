import { randomUUID } from "node:crypto";
import {
  Type,
  assertSchema,
  hydrateModule,
  type ModuleDefinition,
} from "@suite/module-sdk";
import { canonical, type ReleaseManifest } from "@suite/module-sdk/registry";
import type {
  InstallationReceipt,
  InstallationSelection,
} from "@suite/module-sdk/platform";
import type { Tx } from "./database";
import {
  authorize,
  checkModule,
  lockWorkspace,
  type Context,
} from "./authorization";
import { audit, idempotent } from "./transactions";
import { resolveWorkspaceRelease, workspaceModule } from "./module-releases";
import { stagedModuleServer } from "./staged-module-server";
import type { InstalledModuleServer } from "./module-services";
import { found, requireCondition } from "./errors";

const slug = Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" });
const selection = Type.Object(
  {
    moduleId: slug,
    version: Type.String({ minLength: 1, maxLength: 40 }),
    digest: Type.String({ pattern: "^[a-f0-9]{64}$" }),
  },
  { additionalProperties: false },
);
const sorted = (releases: InstallationSelection[]) =>
  [...releases].sort((a, b) => a.moduleId.localeCompare(b.moduleId));

export async function changeDeviceInstallation(
  tx: Tx,
  initialContext: Context,
  action: "install" | "uninstall",
  input: Record<string, unknown>,
  key: string | undefined,
  servers: readonly InstalledModuleServer[],
) {
  assertSchema(
    Type.Object(
      {
        moduleId: slug,
        deviceId: Type.String({ pattern: "^[a-zA-Z0-9-]{8,100}$" }),
        ...(action === "install"
          ? { releases: Type.Array(selection, { minItems: 1, maxItems: 100 }) }
          : {}),
      },
      { additionalProperties: false },
    ),
    input,
  );
  const moduleId = String(input.moduleId),
    deviceId = String(input.deviceId);
  const expected =
    action === "install" ? (input.releases as InstallationSelection[]) : [];
  const scope = () =>
    tx
      .selectFrom("suite.module_installations")
      .selectAll()
      .where("workspace_id", "=", initialContext.workspaceId)
      .where("user_id", "=", initialContext.actor.id)
      .where("device_id", "=", deviceId);
  const currentPlan = async (ctx: Context) => {
    await checkModule(tx, ctx.workspaceId, ctx.membershipId, moduleId);
    const packages = await resolveWorkspaceRelease(
      tx,
      ctx.workspaceId,
      moduleId,
    );
    const releases = packages.map((p) => ({
      moduleId: p.module_id,
      version: p.version,
      digest: p.digest,
    }));
    requireCondition(
      canonical(sorted(expected)) === canonical(sorted(releases)),
      409,
      "INSTALLATION_POLICY_CHANGED",
      "The release policy changed. Refresh available releases and retry installation.",
    );
    for (const pkg of packages) {
      const module = hydrateModule(pkg.artifact as unknown as ModuleDefinition);
      const selected = await workspaceModule(tx, ctx.workspaceId, module.id);
      requireCondition(
        selected.version === module.version,
        409,
        "DEPENDENCY_POLICY_CONFLICT",
        `${moduleId} requires ${module.id}@${module.version}, but the workspace selects ${selected.version}. Choose compatible version pins before installation.`,
      );
      if (Object.keys(module.operations).length)
        requireCondition(
          await stagedModuleServer(tx, module, servers),
          409,
          "BACKEND_UNAVAILABLE",
          `Stage the reviewed backend for ${module.id}@${module.version} before installing it.`,
        );
    }
    return releases;
  };
  const response = await idempotent(
    tx,
    initialContext,
    key,
    `platform.${action}`,
    { action, value: input },
    async () => {
      await lockWorkspace(tx, initialContext.workspaceId);
      const ctx = await authorize(
        tx,
        initialContext.actor,
        initialContext.workspaceId,
        initialContext.requestId,
      );
      const existing = await scope().execute();
      let releases: InstallationSelection[];
      if (action === "install") releases = await currentPlan(ctx);
      else {
        const root = found(existing.find((r) => r.module_id === moduleId));
        // Inspect the installed contracts, not a newer release's changed dependencies.
        for (const dependent of existing.filter(
          (r) => r.state === "installed" && r.module_id !== moduleId,
        )) {
          const row = found(
            await tx
              .selectFrom("suite.module_releases")
              .select("manifest")
              .where("module_id", "=", dependent.module_id)
              .where("version", "=", dependent.version)
              .executeTakeFirst(),
          );
          const manifest = row.manifest as unknown as ReleaseManifest;
          requireCondition(
            !Object.hasOwn(manifest.dependencies, moduleId),
            409,
            "DEPENDENTS_INSTALLED",
            `Uninstall ${dependent.module_id} before removing its dependency ${moduleId}.`,
          );
        }
        releases = [{ moduleId, version: root.version, digest: "" }];
      }
      const receipt: InstallationReceipt = {
        id: randomUUID(),
        action,
        moduleId,
        deviceId,
        releases: action === "install" ? releases : [],
      };
      for (const release of releases) {
        // Installing a dependent does not supersede an unchanged dependency's own receipt.
        const prior = existing.find(
          (r) =>
            r.module_id === release.moduleId &&
            r.version === release.version &&
            r.state === "installed",
        );
        const receiptId =
          action === "install" && release.moduleId !== moduleId && prior
            ? prior.receipt_id
            : receipt.id;
        await tx
          .insertInto("suite.module_installations")
          .values({
            workspace_id: ctx.workspaceId,
            user_id: ctx.actor.id,
            device_id: deviceId,
            module_id: release.moduleId,
            version: release.version,
            state: action === "install" ? "installed" : "removed",
            receipt_id: receiptId,
            updated_at: new Date(),
          })
          .onConflict((oc) =>
            oc
              .columns(["workspace_id", "user_id", "device_id", "module_id"])
              .doUpdateSet({
                version: release.version,
                state: action === "install" ? "installed" : "removed",
                receipt_id: receiptId,
                updated_at: new Date(),
              }),
          )
          .execute();
      }
      await audit(tx, ctx, `modules.${action}`, moduleId);
      return { ok: true, installation: receipt };
    },
  );
  // Replaying a receipt never resurrects a later removal or bypasses revoked access.
  await lockWorkspace(tx, initialContext.workspaceId);
  const ctx = await authorize(
    tx,
    initialContext.actor,
    initialContext.workspaceId,
    initialContext.requestId,
  );
  if (action === "install") await currentPlan(ctx);
  const rows = await scope().execute();
  const current = rows.find((r) => r.module_id === moduleId);
  requireCondition(
    current?.receipt_id === response.installation.id,
    409,
    "INSTALLATION_SUPERSEDED",
    "Another installation change replaced this request. Refresh the device state before retrying.",
  );
  requireCondition(
    action === "uninstall" ||
      expected.every((release) =>
        rows.some(
          (r) =>
            r.module_id === release.moduleId &&
            r.version === release.version &&
            r.state === "installed",
        ),
      ),
    409,
    "INSTALLATION_SUPERSEDED",
    "A dependency changed on this device. Refresh available releases and retry.",
  );
  return response;
}
