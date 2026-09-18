# Module host capabilities

SDK-05 adds typed, signed capability declarations to independently published modules. Corporate custom views can request a bounded export, a notification, or access to an already authorized desktop LAN transport. LAN calls require current server authorization by default. Explicit `offline: "lease"` declarations may use a verified, unexpired grant for peer status or provisional transfers over an already enabled transport. [Explicit module startup](lan-authority.md) now uses a verified relay grant, including protected offline restart. Read-only peer status cannot start transport; neither grant establishes peer trust. [Development simulation](module-scenarios.md#host-capability-fixtures) is available with typed result fixtures and explicit simulated outcomes. Scoped standalone/offline acceptance and remaining work are recorded in the [acceptance map](sdk-05-acceptance.md).

## Authoring

Declare a module-owned permission and bind a capability alias to it:

```ts
import { capability, defineModule, Type } from "@suite/module-sdk";

export default defineModule({
  id: "notes",
  name: "Notes",
  version: "1.0.0",
  description: "Notes with a typed export capability",
  host: "^1",
  backend: "^1",
  publisher: "suite",
  dependencies: {},
  configuration: Type.Object({}, { additionalProperties: false }),
  permissions: ["notes.export"],
  capabilities: {
    export: capability({ kind: "files.export", permission: "notes.export" }),
  },
  resources: {},
  operations: {},
});
```

The `host` property supplied to `defineView(module, ...)` infers the aliases, inputs and results:

```ts
const result = await host.call("export", {
  filename: "notes.txt",
  content: "Notes to export",
});
```

Unknown aliases, mismatched inputs and undeclared permissions fail type checking. Runtime validation checks transported declarations and calls too. Capability permissions must belong to the declaring module's namespace. Generated module documentation includes each capability's actual input/result schemas and permission. Builds with capabilities require signed `client.host` revision 1; older hosts reject unsupported contracts before execution.

| Kind                 | Input                                        | Result and limits                                                                                                                                                                         |
| -------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files.export`       | `filename`, string `content`                 | `status`: `offered` in a browser; `saved` or `cancelled` on desktop. Filenames are bounded, path-free `.csv`, `.json` or `.txt` names. Content is bounded to 20 Mi characters.            |
| `notifications.show` | `title`, `message`                           | `requested` indicates whether the adapter invoked notification presentation. It does not prove delivery or that a person saw it. Web requires previously granted notification permission. |
| `lan.status`         | `{}`                                         | Enabled/configured state and discovered peers. Only the current account/workspace's unexpired managed desktop transport is exposed.                                                       |
| `lan.relay`          | `peerId`, `kind`, `id`, serialized `payload` | `{ relayed: true, authoritative: false }` acknowledges transport receipt. Use an ID returned by `lan.status`. No corporate effect is committed.                                           |

## Authority and lifetime

Signed manifest metadata must exactly match the artifact's declarations. A declaration requests access; current policy grants it. `POST /api/v1/module/{moduleId}/workspaces/{workspaceId}/capabilities/authorize` requires the identified release, current actor/membership, module availability, entitlements/assignment, dependency readiness and declared effective permission. Existing explicit denial and release-pin checks apply. File content stays out of this authorization request.

The host binds the response to the exact account, workspace, module, version and alias. The renderer cannot supply a reusable authorization response to the privileged desktop bridge. Desktop sessions are opaque handles opened by the trusted host, scoped to the current profile and invalidated on view cleanup, document navigation and authentication transitions. A save dialog is followed by a fresh authorization check before writing. Late authorization after leaving or losing access to a view cannot trigger a web download.

The desktop file adapter uses a user-selected path and returns no filesystem handle. The LAN adapter requires an already enabled, unexpired workspace transport. Artifacts must identify the declaring module; pending payloads must identify that module, workspace and actor. Transport receipt never bypasses eventual authoritative validation. Complete module relay/receipt and partition acceptance remains open.

These are boundaries for reviewed, trusted modules, not a sandbox for hostile JavaScript. Existing host-owned privileged entry points still need the migration/audit listed in SDK-05. Offline capability grants, standalone service access, persistent notification delivery and full profile recovery are not implied by this milestone.

## Verification

See [corporate host capability acceptance](verification/host-capabilities/README.md), including independent signed publication, real browser download, native file writing, revocation during dialogs, stale-view cancellation and explicit evidence limits.

## Relaying a durable pending change

Use the portable helper with an existing durable `JournalEntry`, preserving its original request ID, account, workspace, signed module version, base version and dependencies:

```ts
import { pendingRelay } from "@suite/module-sdk/relay";

await host.call("relay", { peerId, ...pendingRelay(entry) });
```

The public `PendingRelaySchema` and `assertPendingRelay` share the receiver's structural contract. The helper rejects superseded/non-pending changes and invalid retry identities, strips prior result/error claims, and bounds payload size and nesting. Module-policy and input-schema validation still occur at the receiving host against the authorized signed release. Online-only commitments cannot use draft recovery.

A relayed response only acknowledges encrypted quarantine. [Received draft recovery](verification/lan-recovery/README.md) lets an administrator signed into the same account review and submit the draft explicitly. The server checks current permissions and business rules; retries reuse the original idempotency key. Current recovery requires the exact authoring version to be active and locally confirmed dependency receipts. [Package reuse](verification/lan-packages/README.md) and [receipt lifecycle](verification/lan-life/README.md) have scoped acceptance. [Leased module calls](verification/lan-leases/README.md) now work over an already enabled transport. [Module-granted employee startup](lan-authority.md) supports protected offline restart. Employee receipt recovery, inactive-release and remote-dependency reconciliation remain required work.
