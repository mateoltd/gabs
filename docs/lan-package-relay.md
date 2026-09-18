# Received module packages

Desktop installation can reuse signed package bytes received over the optional local network. The authoritative server still decides whether the account may install the exact release. Peers cannot grant entitlements, change version pins, approve migrations or activate code.

## Authoring transfers

`artifactRelays` from `@suite/module-sdk/relay` creates stable, retryable frames from a `SignedArtifact`. A caller with the declared `lan.relay` capability can send those frames to an authorized peer:

```ts
import { artifactRelays } from "@suite/module-sdk/relay";

for await (const frame of artifactRelays(pkg)) {
  await host.call("relay", { peerId, ...frame });
}
```

Here `relay` is the module's declared capability alias; `pkg` is a previously obtained signed package. The helper does not fetch packages, authorize peers or grant host access. Module capability calls may transfer only their own module's artifacts. This is a transport primitive, not an administrator package-sharing interface.

Frames hold 64 KiB of package bytes as base64. A serialized package may be up to 64 MiB. Transfer identity binds the entire serialized package, while each envelope independently binds its payload. Repeating a frame is safe; changing already received content under the same transfer and chunk index is rejected. Retrying the same package after reconnection resumes durable partial state. JSON field order changes produce a different transfer identity without changing the signed package's authority.

## Installation and storage

The desktop host keeps package transfers in account/workspace-scoped encrypted storage, separately from received drafts. It retains at most four transfers and 64 MiB of aggregate declared package bytes per scope. Old package transfers can be evicted because they are reconstructable. Eviction never removes pending business drafts. Base64, encryption and database overhead increase physical disk usage beyond the declared byte budget.

For an exact release selected by the regular installer:

1. The server's `/api/v1/module/{moduleId}/workspaces/{workspaceId}/artifact/metadata` route checks current access, dependency entitlements, release pins, storage compatibility and the registry signature. It returns the signed header without executable bytes.
2. The desktop utility process assembles the received chunks, checks their aggregate hash and verifies the package signature against current registry trust and the exact server header.
3. The host rechecks server metadata after verification. Revoked access or changed release selection rejects reuse.
4. The regular installer independently verifies the package, persists its download cache and acknowledges the transport cache. It then applies host/dependency checks and obtains the ordinary authoritative installation receipt before activation.

Incomplete transfers fall back to the regular registry download. Corrupt assembled bytes or signatures are discarded from the package cache so the registry can repair them. A rejected authorization check does not silently become a cache miss. Interrupted installation retains the regular installer's durable download and retry identity. Small whole-package envelopes from earlier clients remain readable and receive the same verification.

This path requires a live server for authorization and installation acceptance. Offline LAN startup, automatic peer package selection/exchange, broader receipt recovery and deployment-network discovery acceptance retain their separate parity gates. [Bounded peer discovery](lan-discovery.md) documents the implemented coordination and its limitations. No release is published or installed solely because another peer sent it.
