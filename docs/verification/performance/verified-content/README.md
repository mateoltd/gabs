# Verified package reuse on the server

16 September 2026. OPS-07 remains active until the unchanged remote acceptance workload passes on this candidate. This milestone changes server request processing without changing the interface or latency budgets.

## Cause and implementation

The failed remote run [35145085258](https://github.com/mateoltd/gabs/actions/runs/35145085258) recorded 1,529/2,597 ms p95 for reads/confirmations. Its diagnostic artifact showed 1,100 SQL queries across 50 reads: release metadata, pins and executable packages were each fetched 150 times. Repeated canonical serialization, JSON parsing and contract hydration occupied substantial CPU time. Instrumented latency is diagnostic only.

- Registry and staged-server queries return signed content as text. A bounded process cache hashes the **actual returned bytes plus the current public key**, verifies and parses misses, and freezes successful results. A database digest alone never establishes a cache hit. Changed content, signatures, identity or trust keys require new verification. Invalid results are not retained.
- Client and server caches each retain at most 128 entries and 32 MiB of serialized content accounting. Oversized results are verified but not retained. These bounds do not specify V8 heap size; hydrated definitions and existing loaded executables have separate lifetimes.
- Hydrated published contracts are immutable and associated weakly with the verified package. This removes repeated schema reconstruction without allowing one caller to mutate later callers' definitions.
- Only read-only, repeatable-read database transactions reuse release selection within their own snapshot. Workspace, module, requested version and explicit overrides are part of the key. Commands continue resolving against current transaction state; no selection or authorization result is shared across requests.
- Current actor permissions, membership, activation, entitlement, assignment, publisher status, backend publication/readiness and service grants remain database checks. The current signing key is still read before content lookup. This is not a hosted trust-rotation implementation.

## Local measurements

Same machine, Node 24.19, PostgreSQL 18.6, 1,000 orders, 50 concurrent clients and the same stock record. All reports are uninstrumented; the 500/1,000 ms budgets and workload are unchanged.

| Candidate                                       | Read p95 | Confirmation p95 | Report                            |
| ----------------------------------------------- | -------: | ---------------: | --------------------------------- |
| Before changes                                  |   410 ms |           900 ms | [Before](before.json)             |
| Content reuse only                              |   226 ms |           574 ms | [Intermediate](content-only.json) |
| Content reuse plus read-only snapshot selection |   170 ms |           596 ms | [Final](after.json)               |

These are individual local runs, not a statistical claim about hosted latency. Confirmation variation between the latter two runs does not show a command-path benefit from read-only memoization.

## Regression evidence

All 153 unit/PostgreSQL tests in 30 files, strict type/boundary/copy checks and all four builds passed. Coverage includes unchanged-digest payload tampering, signature/identity/key changes, successful key replacement, deeply immutable shared content, cache eviction and repeated invalid/oversized inputs. The independent reviewed-module API fixture warms caches before revoking entitlement, suspending the publisher, corrupting stored release bytes and removing permission; every rejected command preserves record/event/audit/receipt counts. It also verifies fresh version pins, a coherent read-only snapshot and changed pins within a read-committed command transaction.

- Four headless Chromium journeys passed against the current API: fresh scoped onboarding, independently installed TSX views/queries and writes, connected suspension/offline lease expiry, and migrated Inventory/Orders workflows with conflicts/offline drafts. No native application was launched for this server-only change. Existing screenshots were preserved.
- A separate [instrumented diagnostic](diagnostic.json) recorded [800 queries](queries.json) across 50 reads, down from the prior remote profile's 1,100. Release metadata, pins and package-content fetches each occur 50 times rather than 150. Authorization/entitlement checks still occur 100 times each. The [sampled CPU summary](cpu-summary.json) describes the local run only; different machines/instrumentation must not be treated as a latency comparison.
- The [local logical restore](restore.json) passed with zero relational/scoped business invariant violations, namespace isolation and the retired-storage write fence intact. This does not verify hosted point-in-time recovery or offsite infrastructure.
- The final cache eviction refinement passed all three focused cache tests. No source changes followed the broad regression/build/load/browser runs.

Exact candidate remote acceptance is pending. No release-readiness or full functionality-parity claim is made.
