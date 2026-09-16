# Functional specification coverage audit

Date: 15 September 2026

Historical pre-implementation audit. See [the current requirement ledger](requirement-ledger.md) for subsequent implementation evidence and outstanding gaps.

## Conclusion

**Common implements a substantial hosted Web/Desktop business pilot, but does not implement the platform described by the supplied specification.** The largest differences are architectural and explicitly documented: two first-party modules ship with the application, PostgreSQL owns confirmed business state, and offline work is limited to cached records and local order drafts. The specification instead requires downloadable, individually sealed modules with autonomous local backends, a local service broker, mobile clients, and much broader organization and security capabilities.

The existing product is more than a visual mockup. Its implemented subset has actual APIs, database operations, authorization, stock transactions, persistence, and UI actions. However, several visible features are incomplete, and several specification requirements have no documented disposition.

“Intentional” below means **the current repository documents the alternative or exclusion**. It does not establish that the original specification owner approved that change. Absence alone does not prove intent, so undocumented omissions are identified separately.

## Evidence and verification boundary

- Compared all **29 defined requirement IDs** in the [supplied specification][spec] with the current source, architecture, UI documentation, and recorded verification.
- Inspected the running web interface: Overview, Modules, module configuration, People & access, Roles, Settings, and Notifications. Visually inspected Settings. Inspected the running Electron Overview and shared navigation.
- Traced UI actions into contracts, API handlers, governance, authorization, worker delivery, platform adapters, native storage, and database privileges.
- Did not submit business mutations, change permissions, upload a logo, or change workspace policy. Conditional defects below are source-confirmed unless an actual UI observation is stated.
- Did not rerun CI or the full test suite. The [existing verification record][verification] reports earlier local automated and manual checks; those are historical evidence, not fresh results from this audit.
- Source is the primary baseline. An update-ready control was visible in the web preview, so the already-running client is not proof that every current source change has shipped into its loaded assets.

## 1. Documented intentional departures

| Area                         | Specification                                                                                                             | Current documented product                                                                                                                                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Execution and data ownership | Autonomous frontend/local-backend module bundles; normal interaction independent of a server.                             | Hosted API and PostgreSQL are authoritative. Orders calls Inventory on the server in the same transaction. Offline access is a bounded snapshot plus local drafts. [Architecture][architecture]                                                                                         |
| Module distribution          | Runtime marketplace downloads, signatures/checksums, independent compatibility/versioning, nominative encrypted packages. | First-party modules register at build time and ship together. Enabling changes workspace configuration, not executable code. Third-party executable plugins and independent module versions are excluded. [Boundaries][boundaries]                                                      |
| Supported platforms          | Web, Desktop, Android and iOS.                                                                                            | Web and Electron. Mobile is future work with reusable contracts/domain rules/tokens, not an implemented client. [Deliberate limits][limits]                                                                                                                                             |
| Organizational model         | Visual rank DAG, immutable root, groups, tags and inherited permissions.                                                  | Flat roles, memberships and module assignments. Org charts and groups are excluded; custom roles are restricted to business permissions. [Identity model][identity-model]                                                                                                               |
| Commercial model             | Master licenses, sublicenses, acquisition and distribution through a store.                                               | Operator-granted entitlements and seat limits. Paid billing is excluded. [Entitlements][entitlements]                                                                                                                                                                                   |
| Desktop collaboration        | Local server, LAN discovery, mesh heartbeats, local peer transport.                                                       | LAN discovery and offline peer collaboration are excluded. [Deliberate limits][limits]                                                                                                                                                                                                  |
| Visual design                | Expandable sidebar, account/store at its foot, ten company-enforced archetypes.                                           | Fixed compact rail; account and notifications in the header; Modules in main navigation; one shared visual system with light/dark/system and three workspace accents. The rail/header alternative and limited branding are documented. [UI design][ui-design], [branding scope][limits] |
| Local security architecture  | Hardware-and-PIN-derived encrypted databases and extensive hostile-runtime protections.                                   | OS-backed Electron safeStorage for serialized cache/token files and a constrained native bridge. This is an explicitly documented implementation, but the extra anti-spyware and memory-defense requirements have not been explicitly waived. [Native behavior][native-behavior]        |

These departures cannot all be resolved by completing a few screens. Meeting the original execution, distribution, and security model would require substantial platform work.

## 2. Gaps and incomplete connections

### A. Company logo is accepted and persisted but never displayed

**Classification: likely unintended incomplete feature within the documented pilot.** Relevant to SHELL-001 and workspace branding.

Settings reads and submits `logoDataUrl`; the API validates and stores it; bootstrap returns it. However, the shell switcher always renders the static Common `BrandIcon`. A source-wide search found no use of `logoDataUrl` for rendering an image anywhere in the app. Settings does not preview it either.

This means the save path exists, but the user-facing result of uploading a company logo is missing. Accent changes do have a consumer in the shell. This is stronger evidence of an incomplete connection than a deliberately unavailable future feature.

Evidence: [Settings save][settings-save], [API persistence][logo-api], [bootstrap branding][bootstrap], [static switcher][switcher], [static image][brand]. Not reproduced by uploading into the existing workspace during this read-only audit.

### B. Hidden/unpublished module policy is not implemented

**Classification: confirmed spec mismatch; no explicit rationale found for visibility behavior.** ORG-004 and ORG-006.

- The Modules navigation entry uses `show: true`, so there is no corporate “store blocked and hidden” state.
- Bootstrap returns all workspace module activations, without filtering draft or suspended entries for non-administrators.
- The catalog renders every entry in `bootstrap.modules` without a publication/visibility filter.
- Disabled/non-entitled modules can therefore remain visible; the action may be disabled, or an assigned member may see “Available with your role’s permissions” even when the module is unavailable.

The application does enforce enabled/entitled/assigned conditions for actual module operations. **Visibility is incomplete; this finding does not establish an authorization bypass.** A configuration decision is needed if showing disabled modules is intended.

Evidence: [always-visible catalog navigation][module-nav], [bootstrap query][bootstrap], [catalog rendering][catalog], [server enforcement][authorization]. The current inspected Owner workspace had both modules enabled; the non-admin draft/suspended case is established from source rather than a modified fixture.

### C. Module publication readiness is only a state selector

**Classification: incomplete specification capability, with schema scaffolding.** ORG-006.

The visible configuration dialog contains Module state and Access policy. Enabling checks entitlement and the Inventory dependency for Orders. There is no parameter-entry step, required-settings validation, rank-permission setup, or publish wizard. A module `config` field exists and is seeded with `{}`, but there is no corresponding configuration workflow in the reviewed API/UI.

The existing two modules may not need integration credentials. That does not make this a general module-readiness system.

Evidence: [configuration dialog][module-config], [enable checks][configure-service], [seeded config][provision]. Confirmed the dialog's two controls in the running UI.

### D. Notification delivery is only partially connected

**Classification: real in-app delivery plus unwired native/browser adapters.** NOTIF-001 and ORG-005.

- Server jobs persist actual notifications. The Notifications page polls every 30 seconds while mounted and supports Mark read.
- Native/browser `notify()` implementations exist, but there are no application call sites connecting incoming notifications to them. There is no end-to-end desktop push feature or mobile push client.
- The header badge counts invitations only, not unread system/module notifications or pending approvals. The running UI showed many unread order notifications and no corresponding unread badge.
- Approval notifications direct administrators to Modules. They do not contain Approve/Deny actions or a direct actionable request card.
- Invitations are interactive in a global strip and are fetched with `/me`. That identity query has no periodic invitation refresh or push subscription. A continuously focused idle client can miss a newly issued invitation until identity is refreshed, for example on window focus or reload.

Evidence: [notification page][notifications], [worker delivery][worker-notifications], [browser adapter][browser-notify], [native adapter][native-notify], [header badge][header-notifications], [identity refresh][session]. The native methods are implemented adapters, not empty functions, but their product integration is unfinished.

### E. Personal-first entry does not match the spec

**Classification: source-confirmed mismatch; intent undocumented.** SHELL-001.

The selected workspace is the remembered workspace when available, otherwise the first company, otherwise the first returned workspace. The spec says to start in Personal. A remembered-workspace policy may be desirable, but it needs an explicit disposition rather than being called compliant.

Evidence: [selection fallback][workspace-default].

### F. Module-specific permission inspector is missing

**Classification: absent capability; flat-role simplification is documented, but this inspector's omission is not explicitly justified.** PERM-002.

Permissions are managed in People & access using role cards and a checklist. The Modules dialog only exposes state and access policy. There is no “Permissions and access” view of all roles for a selected module, no module-local permission editor, and no live central/module bidirectional inspector.

Evidence: [role checklist][role-editor], [module dialog][module-config].

### G. UI kit exists, but the full semantic-only contract is incomplete

**Classification: useful implementation subset; incomplete against UI-003/UI-004.**

Shared inputs, selects, number fields, checkboxes, dialogs, menus, feedback, skeletons and pagination are real. However:

- There is no complete catalogue matching the specified advanced DataTable/DataGrid, resizable columns, virtual list, date-range, tree, tag and split-pane primitives.
- Module views still compose raw markup with feature-specific CSS classes and inline styles. Shared component use is not the same as the mandated semantic-only module API.
- The boundary checker enforces import/domain/module boundaries, not a ban on module visual styles.
- No `HostCustomSandbox`, Shadow DOM wrapper, custom-UI manifest declaration or isolated native counterpart exists.

Evidence: [UI library][ui-library], [module markup][module-markup], [boundary checker][boundary-checker]. The `SelectOption` component returning `null` is intentional declarative option data consumed by `Select`; it is not an unfinished control.

## 3. Requirement-by-requirement matrix

“Partial” means meaningful behavior exists, not that the entire numbered requirement passes. Mobile clauses remain unmet wherever mobile is specified. No percentage is given because these requirements have very different scope and several intentionally changed behaviors are not equivalent to the original ones.

| ID        | Current coverage and remaining difference                                                                                                                                                                                                                                                                  | Disposition and evidence                                                                                                                                                                                                                     |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CORE-001  | Shared Web/Electron shell, lazy views, render error boundary, scoped storage and narrow native bridge. No mobile shell, external-module execution sandbox, general event bus or base-integrity startup validation.                                                                                         | Partial; first-party build-time alternative and mobile exclusion documented. [Shell][shell], [boundaries][boundaries]                                                                                                                        |
| CORE-002  | Orders/Inventory use lazy imports and the web shell can be cached. No registry download manager, package signatures/SHA-256 verification, per-module host SemVer negotiation or downloaded-module cache.                                                                                                   | Distribution model intentionally replaced. Lazy importing bundled code does not satisfy a plugin loader. [Shell][shell], [boundaries][boundaries]                                                                                            |
| CORE-003  | Module domain/server/web separation exists, but backends run on the hosted server. Local order drafts and cached subsets exist. No dedicated local worker backend or autonomous offline stock transactions.                                                                                                | Explicit architectural replacement. [Architecture][architecture], [offline behavior][offline]                                                                                                                                                |
| CORE-004  | Orders invokes Inventory's public server service in the same database transaction. No client-local RPC broker, local service registration, or runtime inter-module consent connection.                                                                                                                     | Explicit server-side alternative. [Order service][order-service], [architecture][architecture]                                                                                                                                               |
| AUTH-001  | Hosted identity/session and native PKCE/refresh implementation; MFA checks for company administrators. No device-only accounts, local PIN/password key derivation or independent local authentication.                                                                                                     | Hosted model documented. Live provider acceptance incomplete. Development “local workspace” still logs into the loopback API and is not a spec local account. [README][readme], [native behavior][native-behavior], [acceptance][acceptance] |
| AUTH-002  | Demo-account selector and a single remembered offline identity; hosted signup/login handoff. No saved-profile avatar gallery, profile removal workflow, PIN/biometric unlocking or background privacy blur.                                                                                                | Saved-profile UX absent; intent not explicitly recorded. Demo selector is development infrastructure. [Sign-in][login], [identity storage][platform]                                                                                         |
| SHELL-001 | Personal/company workspaces, switching, scoped queries/cache, permissions and workspace accent. Last/company-first default differs from Personal-first. Saved company logo is not rendered.                                                                                                                | Core context behavior implemented; default undocumented; logo likely incomplete. [Isolation][offline], [selection][workspace-default], [switcher][switcher]                                                                                  |
| SHELL-002 | Workspace switcher, permitted module links, compact rail and narrow-screen drawer. Account is in header, Modules is in main navigation, and no desktop expand-to-labels toggle exists.                                                                                                                     | Documented navigation redesign. Native mobile remains excluded. [UI design][ui-design]                                                                                                                                                       |
| ORG-001   | Entitlements, seat limits, email-targeted invitations, accept/decline and membership revocation. No license purchase system; invitation acceptance consumes a seat rather than reserving one when issued. API authorization checks current membership; offline copies are not immediately erased remotely. | Real simplified licensing/membership model; billing and offline limitations documented. [Identity model][identity-model], [seat display][seat-display], [authorization][authorization]                                                       |
| NOTIF-001 | Persisted workspace notifications, Mark read, interactive invitation strip and workspace addition on acceptance. No unified actionable approval inbox, push delivery, complete unread badge or live invitation subscription.                                                                               | Partial and unwired in places; see D. External invitation email is explicitly deferred, though email itself is not the spec's required push channel. [Notifications][notifications], [worker][worker-notifications]                          |
| ORG-002   | Protected Owner/Administrator roles exist, but no rank graph, directed edges, multiple parents, cycle/orphan validation, canvas, snapping, minimap or auto-layout.                                                                                                                                         | Org chart intentionally excluded. Protected roles are not a substitute for a DAG. [Limits][limits]                                                                                                                                           |
| ORG-003   | No rank groups, tags, bulk group/tag policy propagation or canvas filters.                                                                                                                                                                                                                                 | Groups intentionally excluded; tag mechanics absent with that organizational model. [Limits][limits]                                                                                                                                         |
| ORG-004   | Per-module administrator/approval/self-service access policies and workspace isolation. No global hidden/blocked store policy, mandatory module auto-updates or version pinning.                                                                                                                           | Assignment policies implemented; independent versions intentionally excluded; hidden-store mismatch undocumented. [Catalog][catalog], [module nav][module-nav], [limits][limits]                                                             |
| ORG-005   | Request with optional reason, pending state, cancellation, approval/denial, assignment and server notification. No executable download after approval; approvals live in Modules, not notification cards.                                                                                                  | Workflow implemented with deliberate bundled-code alternative; notification UX incomplete. [Request UI][catalog], [resolution][access-resolution], [worker][worker-notifications]                                                            |
| ORG-006   | Draft/enabled/suspended state, entitlement/dependency checks and runtime suspension. No hidden employee catalogue entries, general required-config validation or publish wizard.                                                                                                                           | Partial; see B/C. An enabled-state selector is not full certification/publication. [Bootstrap][bootstrap], [configuration][configure-service]                                                                                                |
| PERM-001  | Flat role cards/checklists, protected admin roles and business action permissions. No ranks, inherited permissions, cross-role matrix or custom delegation of platform-management permissions.                                                                                                             | Flat roles and business-only custom permissions documented; matrix absent. [Role editor][role-editor], [permission registry][permissions], [identity model][identity-model]                                                                  |
| PERM-002  | No per-module role/permission inspector. Access assignment and role editing occur in separate central screens.                                                                                                                                                                                             | Missing; omission not explicitly justified. [Module dialog][module-config], [role editor][role-editor]                                                                                                                                       |
| BACK-001  | Fixed API composition, authorization, reviewed application-wide migrations and no arbitrary controller upload path. Routes use `/api/v1/workspaces/:workspaceId/...`; tables share `suite`. No certified registry/controller deployment, nominative attestation or per-module migration namespace/role.    | Intentional modular-monolith architecture. Fixed first-party code is a different trust model from certified plugins. [Routes][routes], [DB privileges][db-privileges], [boundaries][boundaries]                                              |
| BACK-002  | Tenant row isolation and public module service boundaries. No database role isolation between individual modules, declared per-table grants, personal consent dialogue or revocable corporate cross-module bridge.                                                                                         | Server service boundary deliberately used; consent/governance layer absent. Tenant isolation does not establish module isolation. [DB privileges][db-privileges], [authorization][authorization], [boundary checker][boundary-checker]       |
| STORE-003 | No per-user/workspace/device module sealing, hardware-attested encrypted bytecode, periodic package verification or package purging on tamper. Application signing/release hooks concern whole desktop builds.                                                                                             | Module distribution intentionally excluded; signing hooks are not this feature. [Boundaries][boundaries], [release acceptance][acceptance]                                                                                                   |
| DESK-001  | Constrained Electron runtime and storage-status checks. No keylogger/hook/injection detector, threat lockdown UI, administrator-only rescue or corresponding forensic-event pipeline.                                                                                                                      | Absent; no explicit rationale found for dropping this requirement. `securityStatus` is not threat detection. [Native status][native-notify], [native security][native-security]                                                              |
| DESK-002  | No embedded peer service, three-port fallback, coordinated discovery, heartbeat/re-scan loops or mesh status/transport SDK.                                                                                                                                                                                | Explicitly excluded. The server job worker is not a desktop peer worker. [Limits][limits]                                                                                                                                                    |
| SEC-001   | HTTPS deployment configuration and normal HTTP/API transport. No fixed-frame padding/CSPRNG noise layer or P2P Noise/Curve25519 protocol. No verified deployed TLS 1.3 configuration in this audit.                                                                                                        | Conventional hosted transport documented; extra traffic-analysis protections absent without an explicit waiver. [Operations][operations], [routes][routes]                                                                                   |
| SEC-002   | Electron encrypts serialized token/cache data into files using safeStorage. No encrypted local business database, Argon2id-plus-hardware combined key, explicit TPM/Secure Enclave integration or mobile implementation.                                                                                   | Storage architecture deliberately different. OS-backed encryption is not evidence of the specified hardware-and-PIN database scheme. [Native storage][native-storage]                                                                        |
| SEC-003   | Native tokens kept out of the renderer; provider refresh implementation and logout cleanup. Tokens are ordinary runtime values, with no explicit zeroization, locked memory, anti-debugging or cross-process memory defense. Live reuse detection depends on provider setup.                               | Partial conventional credential hygiene; stronger memory protections absent with intent undocumented. [Token storage][tokens], [operations][operations]                                                                                      |
| UI-001    | Workspace admin chooses accent/logo; user chooses light/dark/system on the current browser/app. No mandatory organization archetype or personal archetype freedom; theme stored globally for the app, not per profile/context; logo consumer missing.                                                      | Narrow branding/theme alternative documented; logo likely unintended. [Settings][settings], [theme persistence][theme], [limits][limits]                                                                                                     |
| UI-002    | One design system, three appearance modes, three accent palettes, OS contrast/forced-color CSS. No ten archetypes, explicit high-contrast mode for each or evidence of complete WCAG AAA conformance.                                                                                                      | Limited visual system documented; archetype catalogue absent. Existing A/AA checks do not establish AAA. [UI design][ui-design], [contrast CSS][contrast], [verification][verification]                                                      |
| UI-003    | Real shared component subset and consistent interaction primitives. Many specified advanced controls absent; modules use custom layout/markup/classes and some inline styles. No enforcement of a semantic-only module UI contract.                                                                        | Partial; see G. [UI library][ui-library], [module markup][module-markup]                                                                                                                                                                     |
| UI-004    | No custom visual sandbox, bidirectional Shadow DOM isolation or custom-UI declaration in a publication manifest.                                                                                                                                                                                           | Absent; consistent with no external-plugin system, but no explicit decision for this individual requirement. [Boundaries][boundaries], [UI library][ui-library]                                                                              |

## 4. What is real, what is a placeholder, and what still needs acceptance

### Real implementation

The reviewed UI is connected to actual workspace/membership/module governance, server-backed Orders and Inventory, audited stock transitions, access-request processing, snapshots and draft persistence. The Overview and order activity read module services; they do not inject fabricated metrics. Shared controls have implemented interactions. Development test records visible in the running preview are stored fixture data, not hardcoded chart values.

The historic [verification record][verification] reports 24 domain/PostgreSQL tests, nine browser workflows and two Electron tests, plus builds and local operational checks. It explicitly limits what those results establish.

### Genuine scaffolding or incomplete integration

- Company logo: stored value without a display consumer.
- Browser/native notifications: implemented adapters without application delivery wiring.
- General module configuration: a persisted config field without an editor/readiness contract.
- Mobile: reusable shared layers but no mobile application or adapter.
- Hosted distribution/authentication: implementation and release configuration hooks exist, but some behavior cannot be claimed working end to end in the current environment.

The demo login and honest unconfigured-login screen are deliberately separate development states. They should not be counted as production multi-profile authentication. Loading skeletons, input placeholders, empty states, and declarative `SelectOption` data are normal UI implementation, not unfinished features by themselves.

### External acceptance still outstanding

As explicitly recorded by the project: live Auth0 enrollment/MFA/callback/refresh behavior; signed/notarized releases; a real hosted update between releases preserving drafts; Windows/Ubuntu installed-runtime acceptance; private hosted exports, HTTPS/managed database/monitoring configuration; managed backup/full restore acceptance; and manual assistive-technology validation. Outbound invitation email is separately deferred product work. [Acceptance record][acceptance]

## 5. Specification issues and recommended disposition

The supplied document references **STORE-001 and STORE-002 but does not define either section**. STORE-003 is defined. Store behavior can be assessed through CORE and ORG clauses, but a complete marketplace acceptance checklist cannot be reconstructed without those missing definitions.

Recommended order:

1. Record whether the hosted first-party pilot formally replaces the original offline/plugin/mobile platform scope. Preserve the original IDs with an explicit accepted/deferred/replaced disposition.
2. Fix or explicitly remove incomplete promises already exposed by the product: logo rendering, notification delivery/badges, publication visibility/readiness, and the initial-workspace rule.
3. Decide the missing UX scope: saved profiles, module-local permission inspector, full semantic component kit and visual archetypes.
4. Treat local runtimes, plugin distribution, cross-module consent, organizational graphs, mobile and advanced security as separately scoped platform projects if the original requirements remain mandatory.
5. Complete the documented deployment/platform acceptance gates before describing the current pilot as production-ready.

No implementation changes were made by this audit.

[spec]: /Users/mateo/.codex/attachments/6296b83e-97e1-4055-8153-5ad2ec968011/pasted-text.txt
[readme]: /Users/mateo/Documents/ChatGPT/gabs/README.md:1
[architecture]: /Users/mateo/Documents/ChatGPT/gabs/docs/architecture.md:5
[boundaries]: /Users/mateo/Documents/ChatGPT/gabs/docs/architecture.md:25
[identity-model]: /Users/mateo/Documents/ChatGPT/gabs/docs/architecture.md:33
[limits]: /Users/mateo/Documents/ChatGPT/gabs/docs/architecture.md:65
[offline]: /Users/mateo/Documents/ChatGPT/gabs/docs/architecture.md:53
[native-behavior]: /Users/mateo/Documents/ChatGPT/gabs/docs/architecture.md:61
[ui-design]: /Users/mateo/Documents/ChatGPT/gabs/docs/ui.md:5
[verification]: /Users/mateo/Documents/ChatGPT/gabs/docs/verification/README.md:1
[acceptance]: /Users/mateo/Documents/ChatGPT/gabs/docs/verification/README.md:45
[entitlements]: /Users/mateo/Documents/ChatGPT/gabs/docs/operations.md:41
[operations]: /Users/mateo/Documents/ChatGPT/gabs/docs/operations.md:19
[shell]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/index.tsx:68
[settings]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:1019
[settings-save]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:1101
[logo-api]: /Users/mateo/Documents/ChatGPT/gabs/apps/api/src/app.ts:875
[bootstrap]: /Users/mateo/Documents/ChatGPT/gabs/packages/server-core/src/governance.ts:7
[switcher]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/workspace-breadcrumb.tsx:50
[brand]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/brand.tsx:5
[module-nav]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/index.tsx:414
[catalog]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:620
[authorization]: /Users/mateo/Documents/ChatGPT/gabs/packages/server-core/src/authorization.ts:21
[module-config]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:786
[configure-service]: /Users/mateo/Documents/ChatGPT/gabs/packages/server-core/src/governance.ts:580
[provision]: /Users/mateo/Documents/ChatGPT/gabs/packages/server-core/src/provision.ts:55
[notifications]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:966
[worker-notifications]: /Users/mateo/Documents/ChatGPT/gabs/apps/worker/src/worker.ts:128
[browser-notify]: /Users/mateo/Documents/ChatGPT/gabs/packages/platform/src/browser.ts:57
[native-notify]: /Users/mateo/Documents/ChatGPT/gabs/apps/desktop/src/main.ts:425
[header-notifications]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/index.tsx:585
[session]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/index.tsx:829
[workspace-default]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/index.tsx:863
[role-editor]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:546
[ui-library]: /Users/mateo/Documents/ChatGPT/gabs/packages/ui-web/src/index.tsx:26
[module-markup]: /Users/mateo/Documents/ChatGPT/gabs/modules/orders/web/index.tsx:693
[boundary-checker]: /Users/mateo/Documents/ChatGPT/gabs/tooling/check-boundaries.mjs:22
[order-service]: /Users/mateo/Documents/ChatGPT/gabs/modules/orders/server/index.ts:211
[login]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/login.tsx:1
[platform]: /Users/mateo/Documents/ChatGPT/gabs/packages/platform/src/index.ts:36
[seat-display]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/admin.tsx:147
[access-resolution]: /Users/mateo/Documents/ChatGPT/gabs/packages/server-core/src/governance.ts:724
[permissions]: /Users/mateo/Documents/ChatGPT/gabs/packages/contracts/src/index.ts:42
[routes]: /Users/mateo/Documents/ChatGPT/gabs/packages/contracts/src/index.ts:308
[db-privileges]: /Users/mateo/Documents/ChatGPT/gabs/packages/server-core/migrations/001_initial.sql:139
[native-security]: /Users/mateo/Documents/ChatGPT/gabs/apps/desktop/src/security.ts:42
[native-storage]: /Users/mateo/Documents/ChatGPT/gabs/apps/desktop/src/main.ts:78
[tokens]: /Users/mateo/Documents/ChatGPT/gabs/apps/desktop/src/main.ts:134
[theme]: /Users/mateo/Documents/ChatGPT/gabs/packages/app-web/src/index.tsx:225
[contrast]: /Users/mateo/Documents/ChatGPT/gabs/packages/design-tokens/src/tokens.css:91
