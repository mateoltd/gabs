# Administration with unavailable releases

Scope: **GOV-01**, **ORG-003**, **PERM-001/PERM-002** and module lifecycle recovery. This follows [reviewed policy releases](../module-policy-releases/README.md).

## Ownership and behavior

The SDK defines the release-issue contract. Server registry services own selection, verified permission history and release-policy validation. Governance owns activation and suspension; API routes retain transaction and transport orchestration. The shell renders recovery using existing host controls. A feature-local 20px gap separates recovery cards from the ordinary grid, and availability badges keep their content width. Historical declarations never become executable fallback modules.

Known missing or incompatible release selections remain visible separately from current executable definitions. Administrators can edit permissions declared in verified published history, suspend an unavailable module and repair one pin while an independent module remains unavailable. Unknown permissions, forged metadata and invalid target releases remain rejected. Healthy dependent releases and accepted clients must stay compatible.

The snapshot and mutation share the workspace lock. Configuration changes preserve validation for previously healthy enabled rollouts; only pre-existing selection failures are isolated. Enabling a module and supplying configuration still require a valid current contract. Unavailable configured pins and rollouts return an explicit empty accepted-version list, so a fresh bootstrap cannot accidentally permit every installed release. Existing disconnected leases retain their documented expiry.

Persisted activations stay visible even if registry metadata disappears. A new host obtains display names from verified signed history; if all history is missing, the stable module ID is the only available identity. Permission history supplies administration choices, never a replacement executable contract.

The current physical hierarchy remains `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and root `composition`. Public package identifiers and signed artifacts remain stable.

## Checkpoint and review

Checkpoint `c901094` and pushed tag `checkpoint/release-recovery-architecture-2026-09-20` preserve the unfinished implementation before the requested Sol xhigh review. The checkpoint contains a known suspension regression; it is not a verified release. The delegate corrected administration validation and recovery metadata. The parent independently reviewed the source, required lock-before-snapshot ordering and restrictive handling for legacy pins, corrected the fault fixture, and added fresh-catalog and activation-only acceptance.

## Verification

Local acceptance on 20 September 2026:

- Strict root/browser/Node/preload/worker checks, dependency/copy checks and all four fresh builds passed: `/tmp/gabs-release-recovery-build.log`.
- **41 focused tests passed**, including the new recovery integration and all 14 architecture-boundary fixtures: `/tmp/gabs-release-recovery-focused-final.log`. The final regression below includes the subsequent fresh-catalog, missing-metadata and verified-history assertions.
- **All 1,017 tests across 133 files passed** before the final layout-only correction: `/tmp/gabs-release-recovery-regression-accepted.log`. Strict checks passed: `/tmp/gabs-release-recovery-types-final.log`. Final strict checks, dependency/copy checks and all four fresh builds passed again after the layout correction: `/tmp/gabs-release-recovery-layout-build.log`.
- The new headless recovery journey passed: `/tmp/gabs-release-recovery-web-layout.log`. The existing policy-release regression passed in `/tmp/gabs-release-recovery-web.log`.
- Both new recovery and existing policy-release native journeys passed: `/tmp/gabs-release-recovery-native-final.log`. The recovery-only final capture run is `/tmp/gabs-release-recovery-native-layout.log`. The tests assert every window remains unfocused and hidden or minimized.
- Scoped Axe and narrow dialog/page overflow checks passed. The final recovery-only reruns additionally assert visible separation between the recovery region and healthy module cards. All eight final captures below were visually inspected after those runs. Every disposable test database was removed.

The integration covers historical role grants and organization tags, invented-permission rejection, unavailable execution rejection, suspension, failed enablement, invalid pin rollback, independent repair, optimistic concurrency, exact retry and duplicate-free audit. Both real clients exercise keyboard permission editing, suspension, invalid-pin error feedback, independent repairs and persistence after reload.

Parent visual review caught adjoining recovery and normal module cards. The final feature-local gap fixes that defect without changing existing component styles or themes.

The initial product fixture attempted to publish a release with an impossible dependency range. Registry review correctly rejected it before the UI journey. The corrected fixture publishes a globally resolvable dependency that conflicts with the workspace's unavailable pin. The first full regression also exposed an outdated permission-catalog query mock and a missing entitlement in the activation-only fixture. Both fixtures were corrected; all final regression checks pass. No publication, foreign-key or runtime guard was relaxed.

## Captures

| Surface                         | Web                                    | Desktop                                    |
| ------------------------------- | -------------------------------------- | ------------------------------------------ |
| Unavailable selections          | [Modules](web-unavailable.png)         | [Modules](desktop-unavailable.png)         |
| Historical permission edit      | [Matrix](web-permissions.png)          | [Matrix](desktop-permissions.png)          |
| Rejected pin and next selection | [Narrow review](web-review-narrow.png) | [Narrow review](desktop-review-narrow.png) |
| Repaired selections             | [Modules](web-repaired.png)            | [Modules](desktop-repaired.png)            |

## Acceptance boundaries

The local fixture publishes reviewed, signed registry-only modules, pins a release through the API and removes that pinned version while retaining another candidate. This is controlled fault injection in a disposable database, not a production registry withdrawal workflow. Identity and signing providers are local development providers. Compiled desktop acceptance does not establish signed distribution, physical durability or actual-provider acceptance.

GOV-01 remains active for classification filters/autocomplete, broader employee/group administration, scale and remaining release/provider acceptance. Registry signature corruption and trust-key recovery remain distinct operational concerns; invalid signatures fail closed. Full parity and the later UI-refinement goal remain open. These checks do not imply final UI-polish approval.
