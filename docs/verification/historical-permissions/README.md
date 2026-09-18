# Administration of historical permissions

OFF-01 / PERM-001 scoped acceptance, 18 September 2026. Locally verified within the scope below. Full parity and UI refinement remain open.

## Implemented behavior

- People and the central permission matrix use the same server catalogue as role and organization-policy validation. It combines selected module contracts with verified, signed published releases; removed permission identifiers remain available to administrators.
- Declarations retain each module's contributing release versions, including when multiple modules share a permission identifier. Matrix filtering follows these declared module sources, with the existing prefix fallback only for older servers. Selected declarations are distinguished from declarations that only exist in other releases. This is a catalogue of available permissions, not the actor's effective grants.
- The UI identifies other-release permissions and explains that they can authorize saved-work recovery and supported older clients. A grant does not activate a module, bypass current permissions, or override explicit denials. "Other releases" also accommodates version pins and downgrades; it is not a claim that every listed version is chronologically older or executable.
- The server derives historical identifiers from verified artifact content, never an unsigned manifest summary or caller-supplied name. Platform-management permissions remain excluded from custom business roles. Unknown identifiers fail. The signed-content cache is bounded and keyed by exact bytes and trust key; it does not cache workspace policy or grants.
- Only actors with `roles.manage` receive the administration catalogue in platform state. Older clients can ignore the additive field; current clients retain their existing selected-contract fallback for older servers.

## Verification

- All 507 unit/PostgreSQL tests across 85 files passed in a freshly migrated and seeded isolated database before the final matrix-filter-only UI change; server/SDK source remained unchanged: `/tmp/gabs-historical-permissions-full.log`.
- Focused signed-catalogue coverage passed, including changed artifact bytes, changed trust key, excluded platform grants and separate attribution for shared identifiers: `/tmp/gabs-historical-permissions-unit2.log`.
- Strict TypeScript, browser/Node/preload/worker environments, boundary/copy checks and four fresh production builds passed: `/tmp/gabs-historical-permissions-build2.log`. A final strict build after the source-based matrix filter also passed four fresh builds (`/tmp/gabs-historical-permissions-build-final.log`). The existing bundle-size warning remains.
- Both focused headless journeys passed: `/tmp/gabs-historical-permissions-web4.log`. All thirteen broader browser cases passed, including prior correction modes, independent activation, protected-role/member interaction and list geometry/theme/audit regressions (`/tmp/gabs-historical-permissions-web-final.log`). All eight hidden/unfocused Electron correction cases passed on final product source, including historical-role administration and the cross-namespace shared-permission matrix filter (`/tmp/gabs-historical-permissions-native.log`). Both final focused browser journeys passed the same source-based filter and administration checks (`/tmp/gabs-historical-permissions-web-filter.log`).

The shared journey installs a separately signed release that removes or reclassifies an operation. After denial without the historical grant, the administrator creates a business role in People, assigns it to the member, and uses Space in the permission matrix to revoke and restore it. The real settlement API rejects the revoked grant. Exactly three role-save audit entries correspond to creation/revocation/restoration. Invalid and platform permission submissions fail. The filtered matrix also displays a permission declared by both Contacts and the independently published fixture, despite its different namespace. The remaining command journey then recovers saved input/reviews through offline restart and lost settlement replies, with exact original outcomes, dependency graphs and record/audit counts. Direct database edits establish the initial missing-grant scenario; restoration and assignment use the real application interfaces.

### Corrections during acceptance

An initial `aria-label` combined with the checkbox's implicit label, repeating its accessible name and including version metadata. The description now sits outside the label and is associated using `aria-describedby`. The test's scoped descendant locator was corrected to select that description's parent. Matrix toggles wait for server-confirmed state rather than requiring an immediate optimistic state change. No timeout or authorization requirement was weakened. Code review also corrected provenance merging for permission identifiers declared by multiple modules.

## Visual and interaction evidence

Eight new captures retain the narrow role editor and wide permission matrix for removal/reclassification in both clients. The source/version description stays readable within the existing scrollable editor. Checkbox names remain distinct from descriptions. Keyboard Space changes are verified against server-confirmed grants and real settlement denial. Scoped dialog Axe and overflow checks pass. No stylesheet changed; historical regression captures were restored. This is continuity evidence, not approval of the interface as final polish.

| Case | Browser | Hidden desktop |
| --- | --- | --- |
| Removed permission, role editor | [Narrow](web-removed-role-narrow.png) | [Narrow](native-removed-role-narrow.png) |
| Removed permission, matrix | [Matrix](web-removed-matrix.png) | [Matrix](native-removed-matrix.png) |
| Reclassified permission, role editor | [Narrow](web-service-only-role-narrow.png) | [Narrow](native-service-only-role-narrow.png) |
| Reclassified permission, matrix | [Matrix](web-service-only-matrix.png) | [Matrix](native-service-only-matrix.png) |

## Remaining work

- Recovery after removal of the whole custom view or installation, command exports, a module-independent inbox, and general workspace scheduling remain required. This milestone does not complete OFF-01, PERM-001, PERM-002 or the full governance experience.
- Three-release reviews, broader schema transitions, cross-module/resource continuations, submitted children, profile/sign-out recovery, permanent revocation and history retention remain required.
- Historical declarations may grant execution to an explicitly supported older client. They are not special recovery-only grants. Actual execution still requires current module/workspace authority and declared rollout compatibility.
- Large production registry/history performance and hosted/provider acceptance remain operational gates. No production release or final UI approval is claimed.
- The earlier linked-create dialog-close concern and concurrent Orders draft error remain unresolved. Passing regressions do not establish their causes or fixes; see [the prior evidence](../command-upgrade/README.md).
