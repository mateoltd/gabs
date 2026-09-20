# Group and tag module assignment

Scope: **GOV-01**, **ORG-003**, **ORG-001**, **ORG-006** and server authorization. This milestone supplies persistent module policies to groups and role tags, with independent direct member grants. Broader employee management, chart classification filters, large-organization behavior and release/provider acceptance remain open.

## Behavior

- The SDK's schema-derived group/tag contracts accept optional module IDs. The shared evaluator uses direct role selection and opt-in inheritance. Module access and permission to perform business operations remain separate checks.
- A policy follows current membership. Organization edits, member edits and invitation acceptance reconcile dependencies, assignments and seat limits in the same transaction as the existing audit/idempotency result. Insufficient seats roll back interactive changes, including invitation acceptance.
- Migration `031_assignment_sources.sql` preserves existing assignments as direct. Derived assignments carry a separate flag within the existing tenant keys, RLS and policy-invalidation triggers. Removing one source retains any other policy source or independent direct grant.
- Older organization clients preserve optional module policies by group/tag identity when omitting the field. An explicit empty list removes that source. Older member editors cannot accidentally convert echoed derived access into direct grants; current clients use the typed `directModules` field.
- Changing assignment policies requires module administration in addition to organization administration. Member and organization updates recheck authority after acquiring the workspace serialization lock. Server execution and bootstrap also recheck current policy provenance, so stale derived rows alone cannot grant access.
- Intended policies can precede publication or survive suspension. Derived runtime assignments require every dependency to be entitled and enabled. Publication/configuration and billing reconciliation admit available assignments in deterministic membership order without overselling. Pending sources remain explainable in People & access. Billing failure removes current derived access while retaining policy intent for recovery.
- The existing organization editor now offers module selection on groups and tags. People & access separates direct grants from saved role-policy sources. Changes use existing host controls, with no style/theme modification.

## Verification

Verified locally on 20 September 2026:

- **1,015 tests across 131 files passed** against an isolated, migrated PostgreSQL database: `/tmp/gabs-policy-modules-regression.log`. This includes overlapping direct/group/tag grants, dependency seats, legacy-client preservation, role changes, revocation, duplicate requests, transactional audit, invitation rollback/retry, billing shrink/recovery and stale-derived-row refusal. Domain tests cover opt-in inheritance and prototype-property module names. Earlier focused runs passed 46 and then 49 checks as coverage grew.
- Strict root/browser/Node/preload/worker checks, dependency boundaries and copy checks passed. **All four build targets rebuilt successfully**, with existing bundle-size warnings: `/tmp/gabs-policy-modules-final-build.log`.
- **Two final headless browser journeys passed**: the new group/tag module-policy flow and the existing permission-tag regression. Log: `/tmp/gabs-policy-modules-web-final.log`.
- **Two final hidden/minimized native journeys passed**, including assertions that windows remain unfocused and hidden/minimized: `/tmp/gabs-policy-modules-native-recheck.log`. All disposable acceptance databases were removed.
- Both clients exercise tag module selection, dependencies, draft isolation, reload persistence, source explanations, independent direct grants, role removal/restoration, overlapping group policy, and deletion of tag/group sources without deleting direct access. Scoped Axe A/AA checks and narrow overflow assertions passed. All eight new captures below were inspected; incidental historical role-tag capture changes were restored.
- A populated schema-030 database was upgraded using the actual migration 031. Existing assignment identities survived with `direct=true`; an old-style insert after upgrade also defaulted to direct. The disposable database was removed: `/tmp/gabs-policy-modules-upgrade.log` (exercise: `/tmp/gabs-assignment-upgrade.mjs`).
- Scoped formatting, whitespace and documentation links passed. The ledger retains 29 original requirement IDs and the tracker 106 stable IDs.

The initial new browser fixture used an incorrect navigation label; the corrected journey passed. The first native fixture attempted Axe's unsupported extra-page scan; it now uses the existing Electron-compatible `setLegacyMode(native)` pattern. No product guard, timeout or visibility constraint was weakened. Native acceptance uses development authentication and compiled Electron output, not a signed production release or a real billing/identity provider.

## Inspected captures

These are actual scrollable viewport positions, not staged full-page composites.

| Surface | Web | Desktop |
| --- | --- | --- |
| Tag module policy | [Wide](web-policy.png) | [Wide](desktop-policy.png) |
| Tag module policy, narrow | [Narrow](web-policy-narrow.png) | [Narrow](desktop-policy-narrow.png) |
| Member sources and direct grants | [Member](web-member.png) | [Member](desktop-member.png) |
| Group module policy | [Group](web-group.png) | [Group](desktop-group.png) |

## Remaining acceptance

GOV-01 remains active for classification filters/autocomplete and broader employee/group administration. Dependency changes across released/pinned versions now have [follow-up acceptance](../module-policy-releases/README.md), including pending admission and connected People refresh. Large organizations, unavailable-registry permission editing, actual provider events and full rollout/recovery acceptance remain separate requirements. This milestone does not establish whole-product parity, all-theme accessibility or final UI approval.
