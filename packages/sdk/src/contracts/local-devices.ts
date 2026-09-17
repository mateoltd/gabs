import type { Static } from "@sinclair/typebox";
import type { ModuleDefinition } from "../authoring/module";
import { canonical } from "./registry";
import {
  hostCapabilitySchemas,
  resolveHostCapability,
  type HostCapability,
  type HostCapabilityCall,
  type HostCapabilityName,
} from "./host-capabilities";

/** Consent supplied by the profile host, never by a module handler. */
export interface LocalDeviceGrant extends HostCapability {
  id: string;
  moduleId: string;
  moduleVersion: string;
  capability: string;
  releaseDigest: string;
}
export interface LocalDeviceIntent {
  id: string;
  grantId: string;
  call: HostCapabilityCall;
}
export interface LocalDeviceClient<M extends ModuleDefinition> {
  /** Commit a request with the transaction. Its ID is not proof of a device effect. */
  request<N extends HostCapabilityName<M>>(
    name: N,
    input: Static<
      (typeof hostCapabilitySchemas)[NonNullable<
        M["capabilities"]
      >[N]["kind"]]["input"]
    >,
  ): Promise<string>;
}
export const localDeviceLimits = Object.freeze({
  transactionCount: 16,
  transactionBytes: 24 * 1024 * 1024,
  journalCount: 256,
  journalBytes: 64 * 1024 * 1024,
});
export function deviceRequestBytes(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export async function bundledDeviceDigest(module: ModuleDefinition) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(module)),
  );
  return (
    "bundled:" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export function resolveLocalDeviceGrant(
  module: ModuleDefinition,
  grants: readonly LocalDeviceGrant[],
  call: HostCapabilityCall,
) {
  const declaration = resolveHostCapability(
    module,
    call.capability,
    call.input,
  );
  const grant = grants.find(
    (grant) =>
      grant.moduleId === module.id &&
      grant.moduleVersion === module.version &&
      call.moduleId === module.id &&
      call.moduleVersion === module.version &&
      grant.capability === call.capability &&
      grant.kind === declaration.kind &&
      grant.permission === declaration.permission,
  );
  if (!grant)
    throw Object.assign(
      Error(
        "Allow this device capability in Local modules before requesting it.",
      ),
      { code: "CAPABILITY_DENIED" },
    );
  return grant;
}
