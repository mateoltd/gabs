# Opaque retry identities across desktop and receipt recovery

OFF-01, 18 September 2026. This closes the narrower desktop/receipt character restrictions recorded in the [offline acceptance map](../../offline-workflows.md).

## Contract and implementation

The server's existing execution path permits opaque keys between 8 and 128 characters. Desktop submission and receipt lookup previously imposed an additional word-character/hyphen restriction. A request committed on another client under `device:contacts/123.v1+draft=1` could therefore be rejected during desktop retry or prerequisite lookup.

`RequestKeySchema` now supplies the shared bounds for desktop submission, settlement request/results and receipt lookup request/results. It preserves punctuation, case and internal spaces. NUL is rejected because PostgreSQL text cannot store it. The desktop additionally checks Node HTTP header validity and rejects keys that Fetch would trim; it never silently normalizes or replaces an identity. This transport restriction does not alter JSON-only receipt lookup identities or authorize resubmission of uncertain work.

OpenAPI was regenerated. Generated TypeScript API declarations remain unchanged because the represented wire types are still strings. No signed package, operation policy, permission decision or UI/style source changed.

## Verified behavior

- Native validator tests cover punctuation, case, internal spaces/tabs, Latin-1 and both length boundaries. Too-short/long values, header normalization, control characters, non-header Unicode and non-string input are rejected.
- The PostgreSQL/API receipt test creates and repeats a punctuation-key request, then settles the exact request and retrieves its receipt. It verifies one record/audit, both resource and custom-operation receipts, current permission and entitlement checks, actor/workspace isolation, duplicate/oversized batches and malformed keys. NUL lookup/settlement requests return 400.
- The hidden Electron LAN journey commits a punctuation-key parent remotely and repeats it through renderer IPC without changing the response or effects. Punctuation-key child envelopes find the parent's authoritative receipt, retain their identity through a lost reply and process restart, and recover an original-release receipt after a mandatory update. Missing prerequisites stay blocked; unrelated current-release work succeeds. PostgreSQL asserts four intended records/audits and one receipt for the retried child.
- The existing native settlement journey verifies authoritative cancellation and corrected dependent work after restart. Desktop tests assert hidden/minimized, unfocused windows. No foreground or system dialog is required.

## Validation

Final root/browser/Node/preload/worker type checks, dependency/copy checks and four production builds passed. The full isolated unit/PostgreSQL run passed **475 tests across 81 files**. Both hidden desktop journeys passed. Both headless browser regressions passed (settlement and direct create-collision recovery). Scoped Axe checks in the native LAN journey passed. Historical screenshots were restored to their committed bytes; there are no new visual-source changes to accept. All isolated databases were removed.

Logs: `/tmp/gabs-request-key-build-final2.log`, `/tmp/gabs-request-key-full-final.log`, `/tmp/gabs-request-key-native.log`, `/tmp/gabs-request-key-web.log`. Source was frozen during final serialized acceptance. Formatting and generated-schema checks passed. The existing web bundle-size warning remains.

## Limits and next work

This is scoped local development-service and hidden Electron acceptance, not hosted or signed-release acceptance. The earlier intermittent linked-create dialog-close concern remains unchanged; this milestone does not claim to fix it.

Custom module views currently reject all offline calls, including operations declared `queued`. Durable custom-operation capture must expose pending status distinctly from typed accepted output, retain original identities/contracts, and support recovery after restart without bypassing server validation. Archive/custom descendants, submitted-child outcomes, revocation/profile recovery and the remaining OFF-01/overall parity gates remain required.
