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

- **Active:** EXT-02, reviewed server-component staging and publisher submission/review. EXT-01 is verified locally; its independent package contract and evidence are linked below. The official CLI submission/review/stage/publish path and independent signed server loading are implemented. PostgreSQL verifies rejection, failed staging, atomic effects and pinned versions; browser/native fixtures exercise the compiled API. Finish the review interface and remaining release acceptance before closing EXT-02. The administrator journey for a module published after workspace creation is implemented and has focused browser evidence; it configures, publishes, grants permissions and assigns the module through the UI. [Activation evidence](verification/module-activation/README.md). [Contract and commands](module-server-releases.md).
- **Then:** EXT-03, per-module migrations; SDK-01 may proceed independently when useful. Resolve schema compatibility before claiming recoverable executable updates.
- **Current item:** EXT-02. Repository created at https://github.com/mateoltd/gabs (private), current checkout preserved as `ef70776443ed4020f4c43f9741108d52f9268c58`. Local execution and the Codex goal are active; the user resumed the goal and its active status was verified.
- **Blockers:** no external dependency blocks the next engineering item. Provider credentials, hosted infrastructure and target-platform environments are required later; see dependency register.
- **Last verified baseline:** EXT-01 passed 62 unit/integration tests, 55 Chromium journeys and 5 Electron journeys. EXT-02 adds independently staged server execution; see the current work log and verification record for exact coverage. Remote CI on `3408488` passed unsigned packaging and browser checks but failed the order-read latency target (781 ms versus 500 ms). The following run on `2f5ce51` passed packaging but exposed a browser loading-contrast failure, now addressed locally. Neither run was green; remote performance remains unresolved.

## 1. Independent modules and lifecycle

| ID     | Status   | Deliverable and acceptance required                                                                                                                                                                                            | After                  | Coverage                    |
| ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------- |
| EXT-01 | verified | Signed executable client bundles and manifest-driven custom React loading. Install a reviewed custom-view module without host edits; reject corrupt or untrusted bytes and prevent styles escaping the container.              | —                      | CORE-002, STORE-003, UI-004 |
| EXT-02 | active   | Reviewed server-component staging/deployment and publisher submission/review workflow. Client releases cannot become available before the exact compatible server contract is staged; rejected submissions cannot publish.     | —                      | BACK-001, CORE-002          |
| EXT-03 | open     | Per-module migration manager with namespaced storage, forward compatibility and failure recovery. Exercise interrupted/failed migration without exposing a half-ready release or losing data.                                  | EXT-02                 | BACK-001, BACK-002          |
| EXT-04 | open     | Resumable installation, update, pins, repair, suspension and schema-safe executable rollback acceptance. Preserve data on uninstall and block incompatible dependency/backend/schema combinations with actionable diagnostics. | EXT-01, EXT-03         | CORE-002, ORG-004           |
| EXT-05 | open     | Mandatory-update rollout controls and lifecycle observability. Demonstrate pinned-client compatibility, emergency suspension, partial rollout failure and explicit offline lease limits.                                       | EXT-04                 | ORG-004                     |
| EXT-06 | open     | Registry hosting, trust-key rotation and recovery. Test an authorized rotation, revoked/unknown key rejection and recovery with independently distributed artifacts.                                                           | EXT-01                 | STORE-003                   |
| EXT-07 | open     | Complete fifth-module proof: scaffold, custom UI/service implementation, check, test, build, review, publish, install and update through public contracts without editing host source.                                         | EXT-04, SDK-02, SDK-03 | Framework acceptance        |

## 2. Typed SDK and runtime

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                                    | After  | Coverage                           |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------- |
| SDK-01 | ready  | Migrate Orders/Inventory trusted raw-transaction bridges to scoped public SDK capabilities. Retain atomic reservation/fulfillment, audit, outbox and retry behavior; deny undeclared cross-module access.              | —      | CORE-004, BACK-002                 |
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

| ID     | Status | Deliverable and acceptance required                                                                                                                                                                                                | After                                                                                       | Coverage                               |
| ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------- |
| OPS-01 | ready  | LAN peer exchange, bounded scan coordination and full SDK relay flow. Native tests cover three-port fallback, heartbeat/rescan cadence, partitions, permissions and tenant rejection; only the server finalizes corporate effects. | SDK-05                                                                                      | DESK-002, SEC-001                      |
| OPS-02 | open   | Dashboards and alerts for sync failure, queue age, conflicts, install/update failures, entitlement drift and server rejections. Induced failures surface actionable alerts and recovery signals.                                   | —                                                                                           | Operations acceptance                  |
| OPS-03 | open   | Hosted backup/restore, recovery runbooks and staging exercises against declared RPO/RTO. Verify business consistency, tenant isolation, pending work and service restoration, including managed recovery where configured.         | —                                                                                           | Operations acceptance                  |
| OPS-04 | open   | Signed/notarized packaged installation and real update across macOS, Windows and Linux. Exercise credential storage, offline work, crash recovery, invalid updates and preserved data on supported target machines.                | EXT-04, ID-03                                                                               | CORE-001, DESK-001, Release acceptance |
| OPS-05 | open   | Production-like TLS, certificate/credential rotation, registry and identity/billing configuration acceptance. Validate short-lived credentials, recovery and environment isolation with no secrets in artifacts/logs.              | EXT-06, ID-01, GOV-05                                                                       | AUTH-001, STORE-003, SEC-001           |
| OPS-06 | open   | Final requirement audit and full acceptance run on the candidate release. Every original ID has evidence/replacement/approved deferral; no required open work or production-facing placeholders remain.                            | EXT-07, OFF-03, OFF-04, ID-04, GOV-06, UI-03, UI-04, OPS-01, OPS-02, OPS-03, OPS-04, OPS-05 | All requirements and gates             |

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
