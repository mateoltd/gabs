import { Type, assertSchema, type Static } from "@suite/module-sdk";
import { canonical } from "@suite/module-sdk/registry";
import {
  ArtifactTransferSchema,
  ArtifactMetadataSchema,
  artifactTransfer,
  assertArtifactTransfer,
  decodeArtifactPart,
  artifactRelays,
  relayArtifactLimit,
  type ArtifactTransfer,
} from "@suite/module-sdk/relay-artifacts";
import type {
  ArtifactMetadata,
  InstallationSelection,
  SignedArtifact,
} from "@suite/module-sdk/platform";
import type { Scope } from "@suite/client";
import type { OperationRequest } from "@suite/contracts";
import { validateRelayEnvelope, type RelayEnvelope } from "./transport";
const hash = Type.String({ pattern: "^[a-f0-9]{64}$" });
export const LanPackageSelection = Type.Object(
  {
    moduleId: ArtifactTransferSchema.properties.module_id,
    version: ArtifactTransferSchema.properties.version,
    digest: hash,
  },
  { additionalProperties: false },
);
const Entry = Type.Object(
  {
    transfer: ArtifactTransferSchema,
    received: Type.Array(Type.Integer({ minimum: 0, maximum: 1023 }), {
      uniqueItems: true,
      maxItems: 1024,
    }),
    updatedAt: Type.Number(),
    legacy: Type.Optional(
      Type.Object({ id: Type.String({ maxLength: 128 }), digest: hash }),
    ),
  },
  { additionalProperties: false },
);
const Index = Type.Array(Entry, { maxItems: 4 });
type Entry = Static<typeof Entry>;
interface Host {
  currentUser(): string | undefined;
  request(
    request: OperationRequest,
  ): Promise<{ status: number; body: unknown }>;
  read(scope: Scope, key: string): Promise<unknown>;
  write(scope: Scope, key: string, value: unknown): Promise<void>;
  prune(scope: Scope, keep: string[]): Promise<void>;
  verify(
    scope: Scope,
    transfer: ArtifactTransfer,
    metadata: ArtifactMetadata,
    publicKey: string,
  ): Promise<SignedArtifact>;
  // Read the protected snapshot directly: waiting on the session's receipt queue here would deadlock.
  readInbox(scope: Scope): Promise<unknown>;
  dismiss(scope: Scope, id: string, digest: string): Promise<void>;
}
/** Bounded, reconstructable package cache. Pending business envelopes live separately. */
export class LanPackages {
  private generation = 0;
  private pending = Promise.resolve();
  constructor(private readonly host: Host) {}
  invalidate() {
    this.generation++;
  }
  private guard(scope: Scope) {
    const generation = this.generation;
    const check = () => {
      if (
        generation !== this.generation ||
        scope.userId !== this.host.currentUser()
      )
        throw Error("This profile is no longer active.");
    };
    check();
    return check;
  }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const task = this.pending.then(action);
    this.pending = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private async index(scope: Scope, check: () => void): Promise<Entry[]> {
    try {
      const value = await this.host.read(scope, "index");
      check();
      if (value === undefined) return [];
      assertSchema(Index, value);
      if (
        new Set(value.map((entry) => entry.transfer.transfer)).size !==
          value.length ||
        value.reduce((sum, entry) => sum + entry.transfer.bytes, 0) >
          relayArtifactLimit
      )
        throw Error("Invalid received package cache.");
      for (const entry of value) {
        assertArtifactTransfer(entry.transfer);
        if (entry.received.some((part) => part >= entry.transfer.parts))
          throw Error("Invalid received package cache.");
      }
      return value;
    } catch {
      check();
      // This namespace contains reconstructable bytes only. Repair a damaged index
      // without touching business drafts or weakening the normal registry checks.
      await this.save(scope, [], check);
      return [];
    }
  }

  private async save(scope: Scope, entries: Entry[], check: () => void) {
    check();
    await this.host.write(scope, "index", entries);
    check();
    // Also removes orphan chunks left by an interrupted write before its index commit.
    await this.host.prune(scope, [
      "index",
      ...entries.flatMap((entry) =>
        entry.received.map((index) => `${entry.transfer.transfer}/${index}`),
      ),
    ]);
    check();
  }
  private async part(
    scope: Scope,
    value: unknown,
    check: () => void,
    legacy?: Entry["legacy"],
  ) {
    const { part } = decodeArtifactPart(value);
    const transfer = artifactTransfer(part);
    let entries = await this.index(scope, check);
    let entry = entries.find(
      (item) => item.transfer.transfer === transfer.transfer,
    );
    if (entry && canonical(entry.transfer) !== canonical(transfer))
      throw Error("Package transfer metadata changed.");
    if (!entry) {
      entries.sort((a, b) => a.updatedAt - b.updatedAt);
      while (
        entries.length >= 4 ||
        entries.reduce(
          (sum, item) => sum + item.transfer.bytes,
          transfer.bytes,
        ) > relayArtifactLimit
      )
        entries.shift();
      entry = {
        transfer,
        received: [],
        updatedAt: Date.now(),
        ...(legacy ? { legacy } : {}),
      };
      entries.push(entry);
    }
    const key = `${transfer.transfer}/${part.index}`;
    if (entry.received.includes(part.index)) {
      const previous = await this.host.read(scope, key);
      check();
      if (previous !== undefined && previous !== part.content)
        throw Error("Package chunk content changed.");
      if (previous === part.content) return;
      // A missing durable chunk is repaired by the sender's exact retry.
      entry.received = entry.received.filter((index) => index !== part.index);
    }
    await this.save(scope, entries, check);
    await this.host.write(scope, key, part.content);
    check();
    entry.received.push(part.index);
    entry.updatedAt = Date.now();
    await this.save(scope, entries, check);
  }
  receive(scope: Scope, envelope: RelayEnvelope, active: () => void) {
    const identity = this.guard(scope);
    const check = () => {
      identity();
      active();
    };
    return this.exclusive(async () => {
      check();
      validateRelayEnvelope(envelope, scope.workspaceId);
      if (envelope.kind !== "artifact")
        throw Error("Expected a module package.");
      const value = JSON.parse(envelope.payload);
      if (value?.format === "suite-package-v1")
        return this.part(scope, value, check);
      // Older, small whole-package envelopes remain readable; they gain no authority here.
      for await (const part of artifactRelays(value as SignedArtifact)) {
        check();
        await this.part(scope, JSON.parse(part.payload), check);
      }
    });
  }
  private async metadata(
    scope: Scope,
    selection: InstallationSelection,
    check: () => void,
  ) {
    const result = await this.host.request({
      operation: "moduleArtifactMetadata",
      params: { workspaceId: scope.workspaceId, moduleId: selection.moduleId },
    });
    check();
    if (result.status !== 200)
      throw Error(
        "Current module access is required to use a received package.",
      );
    assertSchema(ArtifactMetadataSchema, result.body);
    const metadata = result.body;
    if (
      metadata.module_id !== selection.moduleId ||
      metadata.version !== selection.version ||
      metadata.digest !== selection.digest
    )
      throw Error(
        "The selected module release changed. Refresh available releases and retry.",
      );
    return metadata;
  }
  get(scope: Scope, selection: InstallationSelection) {
    assertSchema(LanPackageSelection, selection);
    const check = this.guard(scope);
    return this.exclusive(async () => {
      check();
      let entries = await this.index(scope, check);
      const matches = (entry: Entry) =>
        entry.transfer.module_id === selection.moduleId &&
        entry.transfer.version === selection.version &&
        entry.transfer.digest === selection.digest;
      let entry = entries.find(
        (item) => matches(item) && item.received.length === item.transfer.parts,
      );
      if (!entry) {
        const inbox = await this.host.readInbox(scope);
        check();
        if (Array.isArray(inbox) && inbox.length <= 10)
          for (const envelope of inbox) {
            // Corrupt/foreign legacy receipts remain in quarantine for explicit recovery.
            try {
              validateRelayEnvelope(envelope, scope.workspaceId);
              if (envelope.kind !== "artifact") continue;
              const pkg = JSON.parse(envelope.payload) as SignedArtifact;
              if (
                pkg.module_id !== selection.moduleId ||
                pkg.version !== selection.version ||
                pkg.digest !== selection.digest
              )
                continue;
              for await (const part of artifactRelays(pkg)) {
                check();
                await this.part(scope, JSON.parse(part.payload), check, {
                  id: envelope.id,
                  digest: envelope.digest,
                });
              }
            } catch {
              check();
            }
          }
        entries = await this.index(scope, check);
        entry = entries.find(
          (item) =>
            matches(item) && item.received.length === item.transfer.parts,
        );
      }
      if (!entry) return;
      const metadata = await this.metadata(scope, selection, check);
      const trust = await this.host.request({ operation: "moduleTrust" });
      check();
      if (
        trust.status !== 200 ||
        !trust.body ||
        typeof trust.body !== "object" ||
        !("publicKey" in trust.body) ||
        typeof trust.body.publicKey !== "string"
      )
        throw Error("Module signature trust is unavailable.");
      let pkg: SignedArtifact;
      try {
        pkg = await this.host.verify(
          scope,
          entry.transfer,
          metadata,
          trust.body.publicKey,
        );
      } catch {
        check();
        // Untrusted/corrupt cache content is replaceable through the regular registry download.
        await this.save(
          scope,
          entries.filter((item) => item !== entry),
          check,
        );
        return;
      }
      check();
      const current = await this.metadata(scope, selection, check);
      if (canonical(current) !== canonical(metadata))
        throw Error("The signed module release changed during verification.");
      return { pkg, transferId: entry.transfer.transfer };
    });
  }
  async acknowledge(scope: Scope, transferId: string) {
    assertSchema(hash, transferId);
    const check = this.guard(scope);
    const legacy = await this.exclusive(async () => {
      check();
      const entries = await this.index(scope, check);
      const entry = entries.find(
        (item) => item.transfer.transfer === transferId,
      );
      if (!entry) return;
      await this.save(
        scope,
        entries.filter((item) => item !== entry),
        check,
      );
      return entry.legacy;
    });
    // Never wait on the receiver while holding the package cache lock.
    check();
    if (legacy) await this.host.dismiss(scope, legacy.id, legacy.digest);
  }
}
