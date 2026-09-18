import { it, expect, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { defineModule, capability } from "@suite/module-sdk";
import {
  capabilityContractDigest,
  verifyCapabilityLease,
  type CapabilityLeasePayload,
} from "@suite/module-sdk/capability-leases";
import {
  signCapabilityLease,
  capabilityLeaseKey,
} from "../../packages/server/src/identity/capability-leases";
import base from "../fixtures/local-capabilities";

it.each(["files.export", "lan.status", "lan.relay"] as const)(
  "verifies %s signed offline scope, exact contract, policy and bounded time while rejecting tampering",
  async (kind) => {
    if (false) {
      const invalid = {
        kind: "lan.relay",
        permission: "device-notes.export",
        offline: "forever",
      } as const;
      // @ts-expect-error Offline authorization requires an expiring lease policy.
      capability(invalid);
    }
    const original = process.env.CAPABILITY_LEASE_PRIVATE_KEY;
    const privateKey = generateKeyPairSync("ed25519")
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    process.env.CAPABILITY_LEASE_PRIVATE_KEY = privateKey;
    try {
      const module = defineModule({
        ...base,
        capabilities: {
          ...base.capabilities,
          export: { ...base.capabilities.export, kind, offline: "lease" },
        },
      });
      const payload: CapabilityLeasePayload = {
        purpose: "suite:corporate-device:v1",
        id: randomUUID(),
        issuer: "https://api.suite.test",
        membershipId: randomUUID(),
        userId: randomUUID(),
        workspaceId: randomUUID(),
        moduleId: module.id,
        moduleVersion: module.version,
        capability: "export",
        kind,
        permission: "device-notes.export",
        contractDigest: await capabilityContractDigest(module),
        policyRevision: "3",
        issuedAt: 100000,
        expiresAt: 3700000,
      };
      const lease = signCapabilityLease(payload),
        key = capabilityLeaseKey();
      const context = {
        issuer: payload.issuer,
        userId: payload.userId,
        workspaceId: payload.workspaceId,
        module,
        call: {
          moduleId: module.id,
          moduleVersion: module.version,
          capability: "export",
          input:
            kind === "files.export"
              ? { filename: "note.txt", content: "Cached notes" }
              : kind === "lan.status"
                ? {}
                : {
                    peerId: "trusted-peer",
                    kind: "pending",
                    id: "draft",
                    payload: "{}",
                  },
        },
        minimumPolicyRevision: "3",
        now: 100001,
      };
      expect(
        await verifyCapabilityLease(lease, key.publicKey, context),
      ).toEqual(payload);
      const clock = vi
        .spyOn(Date, "now")
        .mockReturnValueOnce(100001)
        .mockReturnValue(payload.expiresAt);
      try {
        await expect(
          verifyCapabilityLease(lease, key.publicKey, {
            ...context,
            now: undefined,
          }),
        ).rejects.toThrow(/expired during verification/);
      } finally {
        clock.mockRestore();
      }
      for (const change of [
        { userId: randomUUID() },
        { workspaceId: randomUUID() },
        { issuer: "https://other.test" },
        { module: { ...module, description: "Changed signed contract" } },
        { now: payload.expiresAt },
        { now: payload.issuedAt - 1 },
        { minimumPolicyRevision: "4" },
      ])
        await expect(
          verifyCapabilityLease(lease, key.publicKey, {
            ...context,
            ...change,
          }),
        ).rejects.toThrow();
      await expect(
        verifyCapabilityLease(
          { ...lease, payload: { ...payload, policyRevision: "5" } },
          key.publicKey,
          context,
        ),
      ).rejects.toThrow(/signature/);
      await expect(
        verifyCapabilityLease(
          signCapabilityLease({
            ...payload,
            expiresAt: payload.issuedAt + 24 * 3600000 + 1,
          }),
          key.publicKey,
          context,
        ),
      ).rejects.toThrow(/time window/);
      const other = generateKeyPairSync("ed25519")
        .publicKey.export({ type: "spki", format: "pem" })
        .toString();
      await expect(
        verifyCapabilityLease(lease, other, context),
      ).rejects.toThrow(/Untrusted/);
      await expect(
        verifyCapabilityLease(lease, key.publicKey, {
          ...context,
          module: {
            ...module,
            capabilities: {
              export: { kind, permission: "device-notes.export" },
            },
          },
        }),
      ).rejects.toThrow(/online authorization/);
      expect(() =>
        defineModule({
          ...base,
          capabilities: {
            bad: {
              kind: "lan.relay",
              permission: "foreign.network",
              offline: "lease",
            },
          },
        } as never),
      ).toThrow(/Invalid/);
    } finally {
      if (original === undefined)
        delete process.env.CAPABILITY_LEASE_PRIVATE_KEY;
      else process.env.CAPABILITY_LEASE_PRIVATE_KEY = original;
    }
  },
);
