import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
} from "node:crypto";
import type { ModuleDefinition } from "@suite/module-sdk";
import {
  CapabilityLeasePayloadSchema,
  type CapabilityLease,
  type CapabilityLeasePayload,
} from "@suite/module-sdk/capability-leases";
import { assertSchema } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import type { Tx } from "../persistence/database";
import type { Context } from "./authorization";
import { found, requireCondition } from "../errors";
import { audit } from "../persistence/transactions";

/** Separate online authorization key: never use the offline module-publication private key. */
function signingKey() {
  const value = process.env.CAPABILITY_LEASE_PRIVATE_KEY;
  requireCondition(
    value,
    503,
    "CAPABILITY_LEASE_UNAVAILABLE",
    "Offline device authorization is not configured on this server.",
  );
  const privateKey = createPrivateKey(value);
  requireCondition(
    privateKey.asymmetricKeyType === "ed25519",
    503,
    "CAPABILITY_LEASE_UNAVAILABLE",
    "Offline device authorization requires an Ed25519 signing key.",
  );
  const publicKey = createPublicKey(privateKey);
  return {
    privateKey,
    publicKey,
    keyId: createHash("sha256")
      .update(publicKey.export({ type: "spki", format: "der" }))
      .digest("hex"),
  };
}
export function capabilityLeaseKey() {
  const { publicKey, keyId } = signingKey();
  return {
    keyId,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}
export function signCapabilityLease(
  payload: CapabilityLeasePayload,
): CapabilityLease {
  assertSchema(CapabilityLeasePayloadSchema, payload);
  const { privateKey, keyId } = signingKey();
  return {
    payload,
    keyId,
    signature: sign(null, Buffer.from(canonical(payload)), privateKey).toString(
      "base64",
    ),
  };
}
/** Caller must first authorize the current actor, module availability and exact accepted release in the same snapshot transaction. */
export async function prepareCapabilityLease(
  tx: Tx,
  ctx: Context,
  module: ModuleDefinition,
  capability: string,
  issuer: string,
): Promise<CapabilityLeasePayload> {
  const declaration = Object.hasOwn(module.capabilities ?? {}, capability)
    ? module.capabilities![capability]
    : undefined;
  requireCondition(
    declaration,
    403,
    "CAPABILITY_UNDECLARED",
    "This module did not declare the requested host capability.",
  );
  requireCondition(
    ctx.permissions.includes(declaration.permission),
    403,
    "FORBIDDEN",
    "Your current permissions do not allow this host action.",
  );
  requireCondition(
    declaration.offline === "lease" &&
      ["files.export", "notifications.show"].includes(declaration.kind),
    403,
    "CAPABILITY_ONLINE_REQUIRED",
    "This device capability requires online authorization.",
  );
  const workspace = found(
    await tx
      .selectFrom("suite.workspaces")
      .select("offline_hours")
      .where("id", "=", ctx.workspaceId)
      .executeTakeFirst(),
  );
  requireCondition(
    workspace.offline_hours > 0,
    403,
    "OFFLINE_DISABLED",
    "Offline access is disabled for this workspace.",
  );
  const revision =
    (
      await tx
        .selectFrom("suite.workspace_policy")
        .select("revision")
        .where("workspace_id", "=", ctx.workspaceId)
        .executeTakeFirst()
    )?.revision ?? "0";
  const now = Date.now();
  return {
    purpose: "suite:corporate-device:v1",
    id: randomUUID(),
    issuer,
    userId: ctx.actor.id,
    workspaceId: ctx.workspaceId,
    membershipId: ctx.membershipId,
    moduleId: module.id,
    moduleVersion: module.version,
    capability,
    kind: declaration.kind,
    permission: declaration.permission,
    contractDigest: createHash("sha256")
      .update(canonical(module))
      .digest("hex"),
    policyRevision: revision,
    issuedAt: now,
    expiresAt: now + Math.min(workspace.offline_hours, 24) * 3600000,
  };
}
export async function issueCapabilityLease(
  tx: Tx,
  ctx: Context,
  payload: CapabilityLeasePayload,
) {
  const lease = signCapabilityLease(payload);
  await audit(tx, ctx, "module.capability.lease", payload.id);
  return lease;
}
