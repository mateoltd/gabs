# Functionality parity tracker

Updated: 16 September 2026. **Overall status: active; parity has not been achieved.** Owner: the assistant in this project, with user decisions only where materially required.

## Sources and working rules

- [Product vision and parity contract](product-vision.md): approved outcomes, architecture, intentional replacements and deferrals.
- [Requirement ledger](requirement-ledger.md): original specification coverage and implementation gaps.
- [Verification history](verification/README.md): dated checks and their actual limits.
- [Implementation guide](modular-platform.md): current contracts, commands and behavior.

This tracker owns execution status. The ledger owns requirement mappings; verification records own evidence. Update them together when a requirement changes state. Each row is a deliverable, not a completion percentage. Split a row into stable child IDs if implementation needs smaller steps; retain its acceptance criteria.

Statuses: **ready** = executable next work; **open** = unfinished; **active** = currently being implemented; **blocked** = a named dependency prevents this item; **verify** = implemented but acceptance is pending; **verified** = linked acceptance passed. `After` lists prerequisite task IDs, not a requirement to stop all other work. Only the explicit deferrals in the vision are excluded from parity.

## Current handoff

**User direction: resume feature parity after creating and pushing the repository checkpoint. UI refinement is authorized as a second goal after parity is verified; see [its queued brief](ui-refinement-goal.md).** The current interface remains an engineering baseline, not an accepted visual standard.

- **Active:** SDK-01. The [private transactional store foundation](verification/private-stores/README.md) now provides inferred server-only stores, row locks, version checks, uniqueness, bounded queries, atomic audits/events/services and forward migrations. Orders/Inventory still use their raw transaction bridges; their business handlers, read models, shared services and existing-data migration remain next. Preserve the current UI and supported release contracts.
- **Completed milestone:** EXT-05 now has local acceptance for optional/mandatory releases, compatible pinned clients, generated/custom editor preservation, native restart and exact receipt recovery, partial rollout/report delivery, and [connected suspension with explicit offline lease limits](verification/module-suspension/README.md). Suspension hides open views and portals; reauthorization restores live input and validates retained pending work. This does not complete broader profile recovery or durable arbitrary custom operations.
- **In parallel:** OPS-07 remains open. Remote `35109976212` / `39dcd94` passed functional/build checks, all browser journeys, three unsigned packaging jobs and restore, but measured 679/654 ms p95 for read/confirmation against unchanged 500/1000 ms limits. Earlier `1897f84` passed at 361/418 ms; this variation does not establish a performance fix. [Evidence](verification/performance/authorization/README.md).
- **Next:** SDK-01 implementation and business-correctness acceptance. Broader working-set/profile recovery remains OFF-02/03. Hosted trust/production release acceptance remains open in EXT-06 and OPS-04/05; separate administrator data deletion is EXT-08. No external dependency blocks the scoped SDK work.
- **Repository and goal:** private https://github.com/mateoltd/gabs; initial checkout preserved as `ef70776443ed4020f4c43f9741108d52f9268c58`. The resumed parity goal is active. The UI-refinement goal remains queued after parity.
- **Blockers:** no external dependency blocks the next engineering item. Provider credentials, hosted infrastructure and target-platform environments are required later; see dependency register.
- **Last verified baseline:** 93 unit/PostgreSQL tests, strict types/boundaries/copy checks and four production builds passed. Both selected browser journeys and all three selected minimized Electron journeys passed. Private-store API and signed migration tests cover concurrency, isolation, rollback, retry deduplication and schema/uniqueness validation. [Exact scope and remaining work](verification/private-stores/README.md). The prior suspension checkpoint has separate full remote browser and local 12-native acceptance; those results do not imply full regression on later code.

## 1. Independent modules and lifecycle

| ID     | Status   | Deliverable and acceptance required                                                                                                                                                                                            | After                  | Coverage                       |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------ |
| EXT-01 | verified | Signed executable client bundles and manifest-driven custom React loading. Install a reviewed custom-view module without host edits; reject corrupt or untrusted bytes and prevent styles escaping the container.              | —                      | CORE-002, STORE-003, UI-004    |
| EXT-02 | verified | Reviewed server-component staging/deployment and publisher submission/review workflow. Client releases cannot become available before the exact compatible server contract is staged; rejected submissions cannot publish.     | —                      | BACK-001, CORE-002             |
| EXT-03 | verified | Per-module migration manager with namespaced storage, forward compatibility and failure recovery. Exercise interrupted/failed migration without exposing a half-ready release or losing data.                                  | EXT-02                 | BACK-001, BACK-002             |
| EXT-04 | verified | Resumable installation, update, pins, repair, suspension and schema-safe executable rollback acceptance. Preserve data on uninstall and block incompatible dependency/backend/schema combinations with actionable diagnostics. | EXT-01, EXT-03         | CORE-002, ORG-004              |
| EXT-05 | verified | Mandatory-update rollout controls and lifecycle observability. Demonstrate pinned-client compatibility, emergency suspension, partial rollout failure and explicit offline lease limits.                                       | EXT-04                 | ORG-004                        |
| EXT-06 | open     | Registry hosting, trust-key rotation and recovery. Test an authorized rotation, revoked/unknown key rejection and recovery with independently distributed artifacts.                                                           | EXT-01                 | STORE-003                      |
| EXT-07 | open     | Complete fifth-module proof: scaffold, custom UI/service implementation, check, test, build, review, publish, install and update through public contracts without editing host source.                                         | EXT-04, SDK-02, SDK-03 | Framework acceptance           |
| EXT-08 | open     | Separate administrator-controlled permanent module-data deletion. Require explicit scope/confirmation, current authorization, module reference validation and an audit record; ordinary uninstall always preserves data.       | EXT-03, EXT-04         | CORE-002, lifecycle acceptance |

## 2. Typed SDK and runtime

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                                    | After  | Coverage                           |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------- |
| SDK-01 | active | Migrate Orders/Inventory trusted raw-transaction bridges to scoped public SDK capabilities. Retain atomic reservation/fulfillment, audit, outbox and retry behavior; deny undeclared cross-module access.              | —      | CORE-004, BACK-002                 |
| SDK-02 | open   | Standalone custom operations and substantial local computation in workers. Exercise local authority, crash/restart, cancellation, typed errors and desktop/web capability boundaries.                                  | —      | CORE-003                           |
| SDK-03 | open   | Custom React preview, cross-module fixtures and module-owned test scenarios in the CLI. Invalid types/contracts fail with useful diagnostics; hot reload, permissions and offline simulations remain usable.           | EXT-01 | Typed framework acceptance         |
| SDK-04 | open   | Complete schema-derived documentation, forms, tables, filtering/pagination and composability. Exercise inferred resource/configuration/error/event/service contracts without duplicated application-facing interfaces. | —      | UI-003, Typed framework acceptance |
| SDK-05 | open   | Complete module-scoped host capability grants, including desktop and LAN interfaces. Undeclared or revoked capabilities fail at the host boundary with current actor/workspace checks.                                 | —      | CORE-001, BACK-002                 |

## 3. Hybrid offline work and recovery

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                       | After         | Coverage                       |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------ |
| OFF-01 | ready  | Complete dependent-create and conflict-resolution UI. Crash/reconnect preserves required order; conflicts are explicit; rejected work does not block unrelated operations or appear accepted.             | —             | Offline correctness            |
| OFF-02 | open   | Authorized working-set selection, freshness and bounded cache management. Prove account/workspace isolation and lease shortening, expiry and connected revocation without losing pending work.            | —             | SHELL-001, Offline correctness |
| OFF-03 | open   | Pending-work and uncertain-request recovery through sign-out, profile removal and revoked authorization. Reauthentication determines resubmission/export rights; no silent deletion or duplicate effects. | OFF-01, ID-02 | SHELL-001, AUTH-002            |
| OFF-04 | open   | Explicit personal-to-company import with preview and server validation. Reject unauthorized/invalid records, handle references and retries, and preserve source personal work.                            | SDK-02        | AUTH-001                       |

## 4. Identity and desktop security

| ID    | Status | Deliverable and acceptance required                                                                                                                                                                 | After        | Coverage           |
| ----- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------ |
| ID-01 | ready  | Multiple saved online profiles and corporate background privacy. Switching/locking never exposes another profile's data; web/native MFA and refresh flow acceptance uses a real provider.           | —            | AUTH-001, AUTH-002 |
| ID-02 | open   | Local unlock and supported native biometric/PIN integration with explicit fallback and locked-profile recovery. Verify cancellation, unavailable hardware, invalid credentials and profile removal. | —            | AUTH-002, SEC-002  |
| ID-03 | open   | Full-file encrypted desktop persistence and key lifecycle. Verify metadata protection, OS-protected keys, rotation, failure behavior and recoverability without exposing credentials to renderers.  | —            | SEC-002, SEC-003   |
| ID-04 | open   | Supported-signal integrity checks and auditable lockdown/recovery. Exercise tamper signals, false-positive recovery and pending-work preservation without unsupported spyware/OS-security promises. | ID-02, ID-03 | DESK-001, SEC-003  |

## 5. Governance, commerce and notifications

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                                            | After                  | Coverage                                    |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ------------------------------------------- |
| GOV-01 | ready  | Tag-targeted bulk policies and complete employee/group management. Effective-permission explanations match ordinary grants, explicit denials and opt-in inheritance in both policy interfaces.                                 | —                      | ORG-003, PERM-001, PERM-002                 |
| GOV-02 | open   | Large DAG pan/navigation and deletion UX with keyboard/assistive-technology acceptance. Preserve multiple parents, protected root, last administrator and cycle/orphan rules.                                                  | —                      | ORG-002                                     |
| GOV-03 | open   | Generic integration readiness probes and prepublication permission review. Employees cannot discover or run modules before configuration, readiness and administrator publication pass.                                        | EXT-02                 | ORG-006                                     |
| GOV-04 | open   | Connected policy/approval invalidation and background web push; complete actionable invitation/request/decision/failure/module events. Recheck authority when actions execute; revoked clients lose connected access promptly. | —                      | NOTIF-001, ORG-005, PERM-002                |
| GOV-05 | open   | Provider-backed commerce/reconciliation acceptance. Cover duplicate/out-of-order/delayed webhooks, failures, subscription/seat changes, invitation acceptance/revocation and recovery; redirects never grant entitlement.      | —                      | ORG-001, Commerce acceptance                |
| GOV-06 | open   | Adversarial administration/store journeys across free, approval-required and blocked stores. Verify final-admin protection, seats, assignments, publication and automatic install following approval.                          | GOV-01, GOV-03, GOV-04 | ORG-001 through ORG-006, PERM-001, PERM-002 |

## 6. Applications and presentation

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                                                                      | After                                | Coverage                                   |
| ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------ |
| APP-01 | ready  | Finish Contacts/Projects product journeys: people/organizations/roles/addresses/notes/archive, projects/tasks/dates/status/assignments/comments/time/contact links. Verify useful search/edit flows and offline capture through public SDK contracts.    | —                                    | Four applications acceptance               |
| APP-02 | open   | Finish Orders/Inventory product journeys, including multi-product count sessions. Verify concurrent reservation, cancellation/release, adjustments and fulfillment/consumption with retries, stale edits and no overselling.                             | SDK-01                               | Four applications and business correctness |
| UI-01  | open   | Complete semantic UI kit, generated interactions and custom-view containment acceptance. Verify forms, tables, virtual lists, trees, layouts, dialogs, feedback and keyboard/focus behavior in real interfaces.                                          | SDK-04, EXT-01                       | UI-003, UI-004                             |
| UI-02  | open   | Complete ten specified archetypes across light/dark/system/high-contrast, separate corporate/personal choices and preference synchronization. Test theme/offline/workspace transitions and applicable AAA contrast beyond the existing four token pairs. | —                                    | UI-001, UI-002, SHELL-001                  |
| UI-03  | open   | Resolve shell visual parity against the original expandable-sidebar specification; document any user-approved intentional difference. Verify personal-first navigation, workspace branding and profile/account switching on web/desktop.                 | ID-01                                | SHELL-001, SHELL-002                       |
| UI-04  | open   | Whole-journey keyboard and screen-reader acceptance across administration, notifications, profiles and all four applications. Fix observed issues; do not infer whole-product accessibility from token checks or automated scans.                        | APP-01, APP-02, UI-01, UI-02, GOV-06 | Product acceptance                         |

## 7. LAN, operations and release

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                                                | After                                                                                                       | Coverage                               |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| OPS-01 | ready  | LAN peer exchange, bounded scan coordination and full SDK relay flow. Native tests cover three-port fallback, heartbeat/rescan cadence, partitions, permissions and tenant rejection; only the server finalizes corporate effects. | SDK-05                                                                                                      | DESK-002, SEC-001                      |
| OPS-02 | open   | Dashboards and alerts for sync failure, queue age, conflicts, install/update failures, entitlement drift and server rejections. Induced failures surface actionable alerts and recovery signals.                                   | —                                                                                                           | Operations acceptance                  |
| OPS-03 | open   | Hosted backup/restore, recovery runbooks and staging exercises against declared RPO/RTO. Verify business consistency, tenant isolation, pending work and service restoration, including managed recovery where configured.         | —                                                                                                           | Operations acceptance                  |
| OPS-04 | open   | Signed/notarized packaged installation and real update across macOS, Windows and Linux. Exercise credential storage, offline work, crash recovery, invalid updates and preserved data on supported target machines.                | EXT-04, ID-03                                                                                               | CORE-001, DESK-001, Release acceptance |
| OPS-05 | open   | Production-like TLS, certificate/credential rotation, registry and identity/billing configuration acceptance. Validate short-lived credentials, recovery and environment isolation with no secrets in artifacts/logs.              | EXT-06, ID-01, GOV-05                                                                                       | AUTH-001, STORE-003, SEC-001           |
| OPS-06 | open   | Final requirement audit and full acceptance run on the candidate release. Every original ID has evidence/replacement/approved deferral; no required open work or production-facing placeholders remain.                            | EXT-07, EXT-08, OPS-07, OFF-03, OFF-04, ID-04, GOV-06, UI-03, UI-04, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05 | All requirements and gates             |
| OPS-07 | active | Profile and fix the remote CI read-latency failure without relaxing the 500 ms read / 1,000 ms confirmation budgets. Verify the candidate on the same CI workload and complete its restore gate.                                   | —                                                                                                           | Performance and operations acceptance  |

## External dependency register

These are acceptance dependencies, not excuses to stop engineering. Do not record secrets here. When an item becomes blocked, record the specific missing resource, affected task and next independent work in the handoff.

| Dependency                                                                        | Needed for             | Current status and safe next action                                                                                           |
| --------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Configured identity provider and MFA test accounts                                | ID-01, OPS-05          | Real-provider acceptance remains unverified. Implement and verify local boundaries first, then use an authorized test tenant. |
| Stripe products/prices, webhook endpoint and test scenarios                       | GOV-05, OPS-05         | Provider-backed journeys remain unverified. Use test mode for failure scenarios; the goal does not authorize live charges.    |
| Hosted registry/artifacts and protected release/trust keys                        | EXT-06, OPS-04, OPS-05 | Hosted distribution and rotation acceptance remain open; local development keys are not production credentials.               |
| Staging infrastructure, certificates, monitoring destinations and managed backups | OPS-02, OPS-03, OPS-05 | Local health and logical restore exist. Hosted alerts and full recovery require an authorized environment.                    |
| Signing/notarization credentials and target OS environments                       | OPS-04, UI-04          | Local Electron evidence exists. Signed installed macOS/Windows/Linux and assistive-technology acceptance remain open.         |

## Release acceptance gates

Every gate starts **open**. Link dated evidence here when accepted; passing a subset never closes a gate. All required rows above must be verified as well.

| Gate                 | Required proof                                                                                                                                                        | Status / evidence                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Framework            | Fifth executable module through the public SDK and complete lifecycle without host edits; inferred types reject invalid contracts.                                    | Open; [independent executable client proof](verification/executable-modules/README.md) passes; full fifth-module lifecycle remains open. |
| Business correctness | Concurrent reservations cannot oversell; retries cannot duplicate fulfillment/payment effects/audit; cross-module transactions are atomic.                            | Open; current partial coverage in verification history.                                                                                  |
| Offline              | Crash durability, dependencies, visible conflicts, independent rejection handling, expired/revoked access and authorized pending-work recovery.                       | Open.                                                                                                                                    |
| Authorization        | Workspace/profile isolation, malicious requests, current permissions, scoped service/capability grants and locked-profile recovery.                                   | Open.                                                                                                                                    |
| Lifecycle            | Interrupted/corrupt/incompatible installation, migration failure, supported pins, suspension, repair, schema-safe rollback and data-preserving uninstall.             | Open.                                                                                                                                    |
| Commerce             | Provider-backed duplicate/delayed webhooks, seats, subscription changes, failures and reconciliation end to end.                                                      | Open.                                                                                                                                    |
| Product              | Real web and packaged desktop journeys for four applications, organization editing, profiles, approvals, notifications, all themes and keyboard/assistive technology. | Open.                                                                                                                                    |
| Operations           | Observable sync/lifecycle/entitlement failures, routed alerts, signed updates and validated backup/service recovery.                                                  | Open.                                                                                                                                    |

## Work log

### 16 September 2026: tracker established

- Created this execution backlog and preserved the approved vision separately from changing implementation status.
- Linked the existing requirement ledger and dated verification; no implementation gap was reclassified as a deferral or marked verified by this documentation change.
- Set an active parity goal in the current task. Next implementation item is EXT-01.
- Tracker validation: check local document links, unique task IDs, valid acyclic dependencies and all 29 original requirement IDs. No application tests are required for this documentation-only change.

Future entries: task IDs, user-visible outcome, exact verification and limitations, changed requirements, blockers and next action. Keep detailed command output in verification artifacts, not this log.

### 16 September 2026: UI-R02 shared-list redesign

- User-authorized UI follow-up covering People, Inventory, Audit and one shared foundation for all table renderers, including Orders and generated modules.
- Verified: 15 distinct scoped Chromium tests passed across the final run and focused reruns, six motion checks, one actual Electron test, web/desktop builds, TypeScript, boundary/copy checks and formatting. [Exact scope and screenshots](verification/people-inventory/README.md).
- UI-003 evidence expanded; its incomplete component/composability/assistive-technology acceptance remains open. No feature-parity item resumed. Next action remains waiting for user direction on the parity pause.

### 16 September 2026: repository checkpoint and parity resumption

- Created the private `mateoltd/gabs` repository through GitHub CLI, linked `origin`, committed the existing checkout, and pushed `main` with upstream tracking.
- User resumed feature-parity engineering and authorized a subsequent dedicated UI-refinement goal. All release gates remain open; UI refinement must follow verified parity rather than being silently folded into this resumption.
- EXT-01 is active. Preserve shared UI conventions and test observable custom-module behavior without redesigning unrelated screens.

### 16 September 2026: EXT-01 executable client packages

- Added the public typed `defineView` contract, signed self-contained JS/CSS packages, CLI builds from independent directories, manifest-driven loading and host UI styles inside Shadow DOM. No host registry/router edit is needed to publish the fifth module.
- Verified real save/reload and corrupt-download rejection in Chromium, native execution through the bounded Electron bridge, runtime/type contract checks, and wide/narrow/native screenshots. Final regression: 62 unit/integration tests, 55 Chromium journeys, 5 Electron tests, all builds, formatting and boundaries passed. [Evidence and limitations](verification/executable-modules/README.md).
- Fixed dynamic-route reload/initial-navigation races and long version metadata wrapping found during acceptance. Preserved historical UI screenshots; current UI is not declared polished.
- The initial remote CI exposed missing historical release seeds and a Debian executable-name mismatch. Both are corrected; fresh remote CI must confirm them.
- EXT-01 is verified locally. EXT-02 is next and active; full framework/lifecycle gates remain open, including reviewed backend deployment, migrations, custom offline execution and hosted trust rotation.

### 16 September 2026: EXT-02 publication authority boundary

- Removed registry mutation privileges from the application/worker/public database roles. Added a non-login registry role with only registry read/insert rights for protected release tooling; it cannot update or delete immutable releases. Local seeding now uses its explicit migration connection for registry insertion, while business fixtures still use the ordinary application connection.
- The real PostgreSQL distribution test first proves an API connection cannot insert a release, then inserts via the explicit fixture publisher and exercises normal installation/data access. Migration, local seed and all 62 unit/integration checks passed.
- EXT-02 remains active: immutable review records, server artifact staging/deployment, promotion gates and review workflow still need implementation. This privilege fix alone is not a review system.

### 16 September 2026: EXT-02 reviewed independent server deployment

- Added immutable submissions, protected official publisher metadata, review decisions, staging and database publication guards. Separate signed server factories load through the shared scoped SDK; exact reviewed client/server contracts and signatures are checked before execution. The API needs no rebuild/restart for a new staged module.
- Added CLI submit, submissions, review, stage and guarded publish. Real PostgreSQL acceptance uses the restricted registry role, rejects premature or rejected publication, checks failed staging and immutable artifacts, deduplicates concurrent publication, and proves atomic operation rejection, permission revocation and independently staged old-version pins.
- Changed dependency authorization to resolve the workspace's signed pinned release graph instead of relying on a previously visited catalogue screen. Batched module entitlement/assignment checks and role/grant reads, retaining current authorization on every request. Worker jobs receive registry read access for the same checks.
- The fifth TSX fixture now builds, reviews, stages and publishes both client and server through the CLI and saves through its independently deployed operation in Chromium and Electron. A fresh isolated PostgreSQL database successfully migrated and seeded five explicitly reviewed fixture releases.
- EXT-02 remains active for its review interface and remaining acceptance; migrations, external publisher access and hosted release readiness remain open. [Implementation and limitations](module-server-releases.md).

- EXT-02 milestone verification: 63 unit/integration tests, 55 browser journeys, 5 native Electron journeys, all builds and formatting passed locally; a fresh database seeded all five baseline releases and the logical restore drill passed. Local p95 read/confirmation was 212/258 ms. [Dated evidence](verification/module-server-releases/README.md). Remote performance remains unverified on the new change.

### 16 September 2026: EXT-02 administrator activation

- Made registry metadata and permission selection dynamic for existing companies. Publication creates missing activation rows, validates the selected signed configuration and dependency graph, and still requires entitlement. Both policy editors accept only registered business permissions or authorized platform permissions under their existing authority rules.
- Replaced the two-module assignment list with the actual workspace catalogue. Role creation and module assignment now support independently published modules without host edits or SQL permission fixtures.
- Added a browser journey covering unpublished employee visibility, missing entitlement, invalid configuration, invalid role permissions, role creation, narrow-screen member assignment and a configured independently deployed server operation. [Evidence and limitations](verification/module-activation/README.md).
- Fixed low-contrast pending result rows found in remote CI and added a slow-request contrast check. No broad UI redesign or acceptance claim is included.
- EXT-02 remains active for the protected publisher review interface and remaining release acceptance. Per-module migrations remain next under EXT-03; the later UI-refinement goal remains queued.

- Final activation milestone verification: 63 unit/PostgreSQL tests, 56 browser journeys, 5 Electron journeys, all four builds and formatting passed. Wide/narrow assignment and custom-view evidence was inspected. Remote CI must still confirm the changes; the prior latency gate remains open.

### 16 September 2026: bounded executable reads during authorization

- Investigated the outstanding CI latency gate. Release selection fetched the whole executable registry on each module authorization. It now resolves compact manifests and loads only exact selected packages, retaining checksum/signature verification and current permission/entitlement checks.
- Local 50-client p95 order reads changed from 318 to 168 ms; confirmation changed from 372 to 300 ms. All 63 unit/PostgreSQL tests, four builds, two focused signed-installation/activation browser journeys and formatting passed. [Reports and limits](verification/registry-resolution/README.md). These measurements do not close the remote latency gate.

### 16 September 2026: EXT-02 protected operator review interface

- Added a loopback React console through `pnpm module console`. It uses protected database operator credentials, terminal-code unlock, expiring HTTP-only sessions, same-origin and CSRF checks, and immediate lock/revocation. Ordinary application credentials cannot start it.
- Reviewers can upload signed packages, search/filter/page submissions, inspect exact contracts and executable artifacts, enter an immutable decision reason, stage approved server code, publish and inspect database-attributed history. The interface uses the same registry guards as the CLI.
- Verified 64 unit/PostgreSQL tests, the actual CLI startup/shutdown, an accessible wide/narrow browser journey for approval/staging/publication and rejection, and inspected screenshots. [Exact scope](verification/registry-console/README.md). EXT-02 is verified locally; EXT-03 is now active. Hosted release operations, migrations and complete update recovery remain open.
- CI for `933068e` passed all unsigned packaging and browser journeys but still failed p95 order reads at 685 ms versus 500 ms. The latency gate remains open; no target was relaxed.

### 16 September 2026: signed per-module storage migrations

- EXT-03 is verified locally. Public storage contracts and inferred migration handlers ship in signed client/server manifests; resource-only migration backends build, review and stage through the official workflow.
- The host isolates each module namespace, serializes schema changes against business execution, preserves revisions and commits records/history/schema/audit/outbox atomically. Failures and forced database disconnect roll back; concurrent retries apply once. Invalid new references and revoked migration authority fail. Existing historical links survive.
- Resolution keeps compatible code available until migration commits, rejects unsafe pins and prevents old executables from writing data invalid under the stored schema. Empty namespaces initialize without fake migration history; retained archived records validate before schema commit.
- The existing Configure modal shows current/target schemas, migration steps, failure and retry. Wide/narrow screenshots and a real generated-module journey were inspected. [SDK and operator guide](module-storage-migrations.md), [acceptance evidence](verification/module-migrations/README.md).
- Final checks: 66 unit/PostgreSQL tests, 58 Chromium journeys, 5 Electron journeys, all builds, formatting, boundaries and local logical restore passed. Local load: 150/233 ms p95 read/confirmation. Remote run `35049529410` failed reads at 925 ms; targets remain unchanged. EXT-04 is next and active; overall parity and the later UI-refinement goal remain unfinished.

### 16 September 2026: release identity and current permission checks

- EXT-05 now has release identity from typed clients and generated screens through persistent queued work and browser/native transports. Stale contracts fail before execution or receipt replay; legacy retries retain their original hash. This does not complete accepted-version rollout policy.
- Closed a resource receipt replay gap: current action-level permissions are now checked before idempotency lookup, including legacy receipts. A PostgreSQL regression verifies revocation, independent read access, restoration and exactly one record.
- Verified 73 unit/PostgreSQL tests, 14 focused Chromium journeys, all six distinct native journeys and four builds for the release-identity foundation. [Evidence and remaining work](verification/client-module-version/README.md). Remote diagnostics run `35057665259` is pending; OPS-07 remains active.

### 16 September 2026: current authorization and stock receipt replay

- Remote `6442851` passed load/restore at 387/420 ms, but `1b7d216` failed read p95 at 552 ms; confirmation 593 ms and restore passed. Both completed all browser and unsigned packaging checks. Preserve both outcomes rather than treating one green run as a closed gate.
- Candidate `e43bd69` reads current identity, membership and full role/assignment graph in one statement, reducing 50-list-request query count from 750 to 650 without permission caching. 74 unit/PostgreSQL tests, 18 distinct browser journeys, all builds and formatting passed locally; load 102/177 ms. Remote run `35087408586` is pending. [Evidence](verification/performance/authorization/README.md).
- The legacy receiving/adjustment endpoint now checks its body-dependent permission before idempotency lookup. Regression proves revoked permissions deny new writes and replay, restored access returns the original result, and no extra stock effects occur. All 75 unit/PostgreSQL tests and two focused real browser journeys passed. [Receipt authorization evidence](verification/client-module-version/README.md).
- EXT-05 remains next: explicit accepted-client releases, mandatory rollout enforcement, device observability and suspension delivery. No interface redesign or full parity claim accompanies these changes.

### 16 September 2026: preserving editors during module updates

- Generated editors retain unsaved input, record identity, base versions and uncertain request keys across package changes. Removed fields require explicit removal; removed resources remain exportable. Failed update downloads keep the verified current view mounted.
- Custom views keep their running state until explicit replacement. This is a safe fallback; automatic typed publisher checkpoint/restore remains open. Exported recovery JSON distinguishes unsaved input from unconfirmed effects and retains the original request. Electron validates the bounded export before its save dialog and file write.
- Verified 76 unit/PostgreSQL tests, 27 distinct selected browser journeys, all six Electron journeys, all builds and formatting. Inspected recovery dialogs at wide/narrow sizes. [Detailed evidence](verification/editor-updates/README.md). EXT-05 remains active; no final UI approval or full parity is claimed.
- Remote run `35092809379` passed code/build and unsigned packaging but one browser filter assertion raced loading (60/61 passed). Corrected its wait against the existing `aria-busy` state without weakening row assertions. That run skipped load/restore; OPS-07 still has the latest measured 637 ms remote read p95.

### 16 September 2026: native journal restart across mandatory updates

- Added two real Electron journeys using signed independent module releases, protected native storage and the authoritative server. A transport-interrupted queued request survives process restart and remains in conflict until explicitly reviewed under the new release. An accepted request with a lost reply recovers its original receipt after restart/update without duplication.
- Both scenarios retain original request identity and leave exactly one record, create audit and receipt. Inspected native conflict/review/recovery screens. [Evidence and limits](verification/native-rollout/README.md). Eight distinct native journeys now pass locally; this test-only change does not establish abrupt-crash, offline cold-authentication or cross-OS installed acceptance.
- EXT-05 remains active for typed custom-view transfer, unsaved native editor handoff, device rollout progress/failure reporting and connected suspension delivery. Remote run `35095394975` for the editor-preservation implementation is still in progress; its three unsigned packaging jobs have passed.

### 16 September 2026: typed custom-view input and nonintrusive acceptance

- EXT-05 now includes manifest-declared editable state, inferred immutable values and validated publisher conversion. The host preserves input through compatible updates, rejects invalid conversion and restores the prior view after an initial render failure. Active writes block replacement. This is live-session state, not durable custom-operation recovery.
- Regression exposed and fixed background installation undoing an explicit uninstall: the installer rechecks authoritative device intent inside its lifecycle lock. Explicit reinstall remains supported.
- Verified 79 unit/PostgreSQL tests, 27 distinct selected browser journeys across iterations (seven affected journeys rerun after the fix), all nine real Electron journeys, four builds and formatting. Inspected wide/narrow and native state-transfer screens. [Detailed evidence and limits](verification/custom-view-state/README.md).
- Browser tests are explicitly headless; desktop tests start minimized without focus or Dock windows. Native acceptance asserts that behavior. Production window behavior is unchanged. EXT-05 and the broader parity goal remain active; generated native editor handoff and fleet rollout reporting remain next.

### 16 September 2026: generated editor handoff in Electron

- Two native journeys verify open generated forms through failed downloads, mandatory schema changes, removed fields/resources, native recovery-file export and exact uncertain-receipt recovery. Both leave one update audit and receipt. Shared reviewed fixtures also passed both corresponding browser journeys.
- Strict TypeScript, boundary/copy and formatting checks passed. Screenshots were inspected; all native runs remained minimized/unfocused. This test-only change brings distinct native coverage to eleven across milestone runs. [Evidence and limits](verification/native-editor-updates/README.md).
- EXT-05 remains active for fleet rollout progress, partial failure and connected suspension delivery. Remote `fc3583c` passed functional/build/packaging/restore but failed the unchanged read budget at 675 ms; confirmation was 743 ms. OPS-07 remains open.

### 16 September 2026: device rollout observations and explicit onboarding

- Added bounded, tenant-scoped device observations, immutable attempt identity with sequence ordering, ready-receipt validation and reconnect delivery from module storage. Module administration now shows paginated per-person/device progress, failures, accepted-release counts and last report times. Unchanged dependencies retain their original receipt timestamp.
- Broad browser verification found and corrected registry discovery leaking into new-workspace assignments and completed member mutations keeping unrelated dialogs locked during refresh. Default onboarding now uses the generated bundled selection; extra modules require explicit trusted selection. Existing workspaces/data were preserved.
- All 81 unit/PostgreSQL tests and four builds passed. The broad browser run passed 63/66; all 11 affected journeys passed after fixes, covering the three failures. Wide/narrow device reports and failure/recovery views were inspected. All 11 minimized native journeys and formatting passed; the native device view was inspected. [Detailed scope and remaining work](verification/module-fleet/README.md). EXT-05 and overall parity remain active.

### 16 September 2026: durable report delivery and removal observations

- EXT-05 reports now use bounded four-item batches, two-second network deadlines and persistent exponential retry delays. Invalid/superseded observations stop retrying; late replies cannot settle newer work. Account binding protects delivery across profile changes while preserving legacy clients.
- Preflight failures remain visible without invented versions or installation receipts. Repeated failed plans reuse their observation identity. Removal progress, dependency rejection and completion use the same device view; completed removal requires its current authoritative receipt.
- Verified 85 unit/PostgreSQL tests, the affected lifecycle test again after the final preflight refinement, six focused headless browser journeys, all 11 minimized Electron journeys, all builds and formatting. Inspected wide/narrow removal and native device screens. [Evidence and limits](verification/report-recovery/README.md). Connected suspension/emergency offline acceptance is next; parity and the later UI goal remain unfinished.
- Remote `35102687893` for `1897f84` passed all 66 browser journeys, build/unsigned packaging, load at 361/418 ms p95 and restore. Earlier failed measurements remain documented; current-candidate remote acceptance and runner variation remain OPS-07 considerations.

### 16 September 2026: connected suspension and explicit lease recovery

- Completed EXT-05 local acceptance with durable transaction-scoped policy revisions, bounded PostgreSQL notifications/long polling, fresh authorization, protected IPC and monotonic client delivery. Existing workspaces receive a lockable revision through an additive backfill; new workspaces receive one before memberships exist.
- Paused views and their portals retain live editor input. Disconnected work remains available only through its existing lease; expiry hides corporate content without discarding the journal. Reconnection to a suspended module does not submit its work; restored access allows server validation.
- Broad verification exposed and corrected Orders layout selectors, concurrent archetype saves and a stale installation query after restoration. A controlled delayed-response journey verifies the last race; cache completion cannot restore an earlier in-memory policy epoch.
- Verified 88 unit/PostgreSQL tests, four builds, 67 distinct browser journeys across iterations, three repeated delayed-response journeys and eight affected lifecycle journeys after the installation-check correction. Three focused policy tests and six affected browser journeys passed after the final cache-ordering refinement. All 12 native journeys passed minimized/unfocused. Inspected wide/narrow/native suspension, expiry and recovery, plus the corrected Orders layout. [Evidence and limits](verification/module-suspension/README.md).
- SDK-01 is now active. Overall parity is unfinished; the separately authorized UI-refinement goal stays queued. Hosted deployment, signed cross-OS acceptance, provider delivery and the remaining tracker rows are not implicitly complete.

### 16 September 2026: SDK-01 private transactional stores

- Added public schema-derived private stores and scoped server capabilities for row locking, bounded scans, create/versioned replacement and archival. The server selects the tenant/module namespace and rejects malformed data or cross-module store selection. Private data cannot be addressed by public CRUD routes.
- Writes, audits, service effects, events and receipts remain in one transaction; caught and detached failures roll back all effects. Forward migrations handle private store conversion and copy/archive, validate target schemas and unique fields, and preserve foreign workspaces.
- Verified 93 unit/PostgreSQL tests, compile-time contract rejections, four builds, two selected browser journeys and three minimized/unfocused native journeys. [Evidence and limitations](verification/private-stores/README.md). SDK-01 remains active: the actual Orders/Inventory bridges and legacy-data/read-model migration are not yet replaced.
- Remote `35109976212` for the preceding suspension checkpoint passed functional/build/packaging/restore acceptance but failed the unchanged read-load budget at 679 ms; confirmation was 654 ms. OPS-07 remains open.
