# Corporate saved-work recovery acceptance

**ID-03-BACKUP-CORPORATE: verification pending external/provider/platform acceptance.** The implementation and local product acceptance below cover the approved corporate backup/recovery scope. Historical “broader graphs/source/failure” notes in earlier milestones are reconciled here; they are not additional unbounded requirements. No overall parity or full SEC-002/CORE-003 completion is claimed.

## Requirement reconciliation

| Required outcome | Implementation and actual acceptance evidence |
| --- | --- |
| Retain exact saved input, request identities, source versions and observed outcomes as inert copies | [Admission and explicit promotion](../corporate-work-import/README.md); import source/authority checks, single-write receipt publication, source-byte comparisons and current server settlement |
| Exchange useful saved work between independent web and desktop stores | [All four portability directions](../corporate-work-portability/README.md), including independently keyed native stores and real product exports |
| Reconcile current record targets and disjoint/conflicting edits | [Linked record reviews](../imported-record-reviews/README.md), [linked target choices](../imported-linked-targets/README.md), [request update/archive targets](../imported-request-targets/README.md), and [current archived targets](../imported-schema/README.md) |
| Preserve and explicitly reauthorize dependency/reference and collision choices | [Stopped command dependencies](../imported-command-dependencies/README.md), [collision drafts](../imported-collision-drafts/README.md), [reference hints](../imported-reference-hints/README.md), [draft references](../imported-draft-references/README.md); missing prerequisites remain held and selected corrections retain exact effects |
| Preserve competing reviews without overwriting newer local work | [Resource and command snapshots](../imported-snapshots/README.md), including actual exports, explicit switches, retained displaced copies and restart |
| Recover through changed/retired resource contracts without silent input loss or invalid business writes | [Signed schema transitions](../imported-schema/README.md); source fields remain intact, obsolete-field removal is explicit, retired resources stay unavailable for editing, and current schema validation gates the new save |
| Encrypted, bounded corporate archives without restored credentials or blanket authority | [Archive workflow](../corporate-work-archives/README.md): mixed modules/reviews, independent transfer, passphrase/tamper checks, additive selection, count/byte limits and multi-batch recovery |
| Current account/workspace authorization after lock, expiry, revocation, replacement and reconnect | [Archive lifecycle](../corporate-work-archives/README.md) and [ordinary-restoration matrix](../corporate-promotion-interruption/README.md), using public policy changes, current server sessions and real UI transitions |
| Crash/retry safety without duplicate restoration, business effects or audit records | [Ordinary-restoration matrix](../corporate-promotion-interruption/README.md): actual main/utility death before/after request and draft commits, real lost settlement replies, browser commit/profile ordering and exact duplicate-safe receipts |
| Recover after corporate key loss or unreadable storage while preserving the original | [Device recovery](../corporate-device-recovery/README.md): retained encrypted directory, independently keyed empty store, fresh authentication and normal archive restoration, interrupted activation and exact retry |

The evidence is cumulative and scoped. It does not claim every possible combination of module graph, operating system and failure timing has been exercised. Shared source remains unchanged by the latest acceptance fixtures; their reports distinguish historical checks, current checks and provider simulations.

## Still required

- Actual identity-provider OIDC/MFA account switching and recovery, including denied/expired sessions through the configured provider rather than the development issuer.
- Actual OS-protected storage and physical biometric/provider success, cancellation and failure where supported; controlled safeStorage callbacks do not prove these.
- Signed, installed target-platform journeys and physical durability acceptance, including reboot/remount/power-loss conditions. SIGKILL and simulated write failure are not substitutes.
- The broader platform release gates in the [parity tracker](../../parity-tracker.md), including integrity lockdown/recovery under ID-04. UI-refinement observations remain recorded separately and do not constitute final UI approval.

ID-03 and its corporate/standalone recovery parents stay at **verify**, not **verified**. Independent engineering can proceed to ID-04 while those acceptance dependencies remain open. Do not reopen completed corporate graph/archive/interruption slices without a new failure, changed implementation or explicit unmet requirement.
