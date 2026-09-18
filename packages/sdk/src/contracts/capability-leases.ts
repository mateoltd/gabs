import { Type, type Static } from "@sinclair/typebox";
import { assertSchema, type ModuleDefinition } from "../index";
import { canonical } from "./registry";
import {
  HostAuthorizationSchema,
  resolveHostCapability,
  supportsOfflineHostCapability,
  type HostCapabilityCall,
} from "./host-capabilities";
const object = <P extends Parameters<typeof Type.Object>[0]>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });
const digest = Type.String({ pattern: "^[a-f0-9]{64}$" });
const uuid = Type.String({
  pattern:
    "^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
});
export const CapabilityLeasePayloadSchema = object({
  ...HostAuthorizationSchema.properties,
  purpose: Type.Literal("suite:corporate-device:v1"),
  id: uuid,
  issuer: Type.String({ minLength: 1, maxLength: 2048 }),
  membershipId: uuid,
  permission: Type.String({ minLength: 1, maxLength: 200 }),
  contractDigest: digest,
  policyRevision: Type.String({ pattern: "^(0|[1-9][0-9]{0,18})$" }),
  issuedAt: Type.Integer({ minimum: 0 }),
  expiresAt: Type.Integer({ minimum: 0 }),
});
export const CapabilityLeaseSchema = object({
  payload: CapabilityLeasePayloadSchema,
  keyId: digest,
  signature: Type.String({ pattern: "^[A-Za-z0-9+/]{86}==$" }),
});
export const CapabilityLeaseKeySchema = object({
  keyId: digest,
  publicKey: Type.String({ maxLength: 1000 }),
});
export const CapabilityLeaseAuthoritySchema = object({
  ...CapabilityLeaseKeySchema.properties,
  issuer: Type.String({ minLength: 1, maxLength: 2048 }),
});
export type CapabilityLeaseAuthority = Static<
  typeof CapabilityLeaseAuthoritySchema
>;
export type CapabilityLease = Static<typeof CapabilityLeaseSchema>;
export type CapabilityLeasePayload = Static<
  typeof CapabilityLeasePayloadSchema
>;
const hex = (value: ArrayBuffer) =>
  Array.from(new Uint8Array(value), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
/** Checks key metadata, not provenance. Only the host's authenticated API transport establishes trust. */
export async function verifyCapabilityLeaseAuthority(
  value: unknown,
): Promise<CapabilityLeaseAuthority> {
  assertSchema(CapabilityLeaseAuthoritySchema, value);
  const authority = structuredClone(value);
  const origin = new URL(authority.issuer);
  if (
    origin.origin !== authority.issuer ||
    !["http:", "https:"].includes(origin.protocol)
  )
    throw Error("Invalid capability authority origin.");
  const der = Uint8Array.from(
    atob(authority.publicKey.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  if (hex(await crypto.subtle.digest("SHA-256", der)) !== authority.keyId)
    throw Error("The capability authority key fingerprint does not match.");
  await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, [
    "verify",
  ]);
  return authority;
}
export async function capabilityContractDigest(module: ModuleDefinition) {
  return hex(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(canonical(module)),
    ),
  );
}
/** The host supplies an independently trusted API key and current context, never values from the lease itself. */
export async function verifyCapabilityLease(
  value: unknown,
  publicKey: string,
  expected: {
    issuer: string;
    userId: string;
    workspaceId: string;
    module: ModuleDefinition;
    call: HostCapabilityCall;
    minimumPolicyRevision: string;
    now?: number;
  },
): Promise<Readonly<CapabilityLeasePayload>> {
  resolveHostCapability(
    expected.module,
    expected.call.capability,
    expected.call.input,
  );
  if (
    expected.call.moduleId !== expected.module.id ||
    expected.call.moduleVersion !== expected.module.version
  )
    throw Error("The offline capability lease does not match this release.");
  return verifyCapabilityLeaseGrant(value, publicKey, {
    ...expected,
    capability: expected.call.capability,
  });
}
/** Verify a grant for prefetching. Device effects must also validate their call input. */
export async function verifyCapabilityLeaseGrant(
  value: unknown,
  publicKey: string,
  expected: {
    issuer: string;
    userId: string;
    workspaceId: string;
    module: ModuleDefinition;
    capability: string;
    minimumPolicyRevision: string;
    now?: number;
  },
): Promise<Readonly<CapabilityLeasePayload>> {
  assertSchema(CapabilityLeaseSchema, value);
  const lease = structuredClone(value),
    payload = lease.payload;
  const now = expected.now ?? Date.now();
  if (
    !Number.isSafeInteger(now) ||
    now < 0 ||
    !/^(0|[1-9][0-9]{0,18})$/.test(expected.minimumPolicyRevision)
  )
    throw Error("Invalid offline verification context.");
  const declaration = expected.module.capabilities?.[expected.capability];
  if (
    declaration?.offline !== "lease" ||
    !supportsOfflineHostCapability(declaration.kind)
  )
    throw Error("This device capability requires online authorization.");
  if (
    payload.issuer !== expected.issuer ||
    payload.userId !== expected.userId ||
    payload.workspaceId !== expected.workspaceId ||
    payload.moduleId !== expected.module.id ||
    payload.moduleVersion !== expected.module.version ||
    payload.capability !== expected.capability ||
    payload.kind !== declaration.kind ||
    payload.permission !== declaration.permission ||
    payload.contractDigest !== (await capabilityContractDigest(expected.module))
  )
    throw Error(
      "The offline capability lease does not match this workspace, release or action.",
    );
  if (
    payload.issuedAt > now ||
    payload.expiresAt <= now ||
    payload.expiresAt <= payload.issuedAt ||
    payload.expiresAt - payload.issuedAt > 24 * 3600000
  )
    throw Error(
      "This offline capability lease is expired or outside its permitted time window. Reconnect to renew it.",
    );
  if (BigInt(payload.policyRevision) < BigInt(expected.minimumPolicyRevision))
    throw Error(
      "Workspace policy changed after this offline capability lease was issued. Reconnect to renew it.",
    );
  const der = Uint8Array.from(
    atob(publicKey.replace(/-----[^-]+-----|\s/g, "")),
    (c) => c.charCodeAt(0),
  );
  if (hex(await crypto.subtle.digest("SHA-256", der)) !== lease.keyId)
    throw Error("Untrusted offline capability signing key.");
  const key = await crypto.subtle.importKey(
    "spki",
    der,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  if (
    !(await crypto.subtle.verify(
      "Ed25519",
      key,
      Uint8Array.from(atob(lease.signature), (c) => c.charCodeAt(0)),
      new TextEncoder().encode(canonical(payload)),
    ))
  )
    throw Error("Offline capability signature verification failed.");
  if (payload.expiresAt <= (expected.now ?? Date.now()))
    throw Error(
      "The offline capability lease expired during verification. Reconnect to renew it.",
    );
  return Object.freeze(payload);
}
