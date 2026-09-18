# Administrator capability review

18 September 2026. SDK-05 administrator review is locally verified. This extends PERM-001/PERM-002 and CORE-001/BACK-002 evidence; it does not complete wider governance, release or UI acceptance.

## Behavior and authority

- The module-local review selects an exact published, compatible release and verifies its signed package through the existing registry resolver. It shows declared effects, required permissions, online-only behavior and the workspace's effective offline lease limit. Inspection does not install a release, issue a lease or grant access.
- The read-only API uses a repeatable-read workspace transaction and the same `effectivePermissions` evaluator as execution. It reports inherited/direct grants and explicit denials. Foreign workspaces, revoked review permissions and altered signed metadata fail closed. Module administrators without `roles.manage` can inspect declarations but receive no role details.
- The central matrix and module-local review share decision presentation. The review uses saved server policy; the matrix can preview unsaved organization edits. Ordinary grants overridden by a denial remain visible. The existing matrix owns edits; no second grant store was introduced.
- Queries are scoped by account, workspace, module, release and known policy revision. Failed/offline review does not expose a successful current decision. The tested uncached company locks its administrative surface offline and revalidates on reconnect.
- Desktop IPC accepts the bounded release selector only for `moduleCapabilityReview`. Invalid selectors and use on unrelated operations remain rejected.

## Defect corrected and new gap retained

The real saved-policy integration initially failed because `OrganizationSchema` used UUID `format` constraints with the portable validator, which has no registered formats. Organization IDs now use explicit UUID patterns. Valid inheritance/group-denial saves pass, malformed identifiers remain rejected, and actual execution follows the resulting decision.

The general SDK format problem is **not fixed by that endpoint correction**. A direct checked-out SDK reproduction with valid UUID, email, URI and date strings returned `Unknown format` for all four. Generated form code already recognizes email, URI and date formats. SDK-04 is therefore reopened as **SDK-04-FMT**, with a [follow-up acceptance gate](../../sdk-04-acceptance.md#reopened-standard-format-validation-18-september-2026). Log: `/tmp/gabs-sdk-format-reproduction.log`. Do not count the earlier SDK-04 acceptance as proof of these formats.

## Verification

| Check                                                                                   | Result                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Root and browser/Node/preload/worker types, boundaries, copy checks and all four builds | Passed. Final build log `/tmp/gabs-capability-review-build-final.log`; API artifacts regenerated in `/tmp/gabs-capability-review-api-final.log`.                                                                                                                                                                     |
| Full unit/PostgreSQL suite on a temporary migrated/seeded database                      | 316 tests across 67 files passed. `/tmp/gabs-capability-review-unit.log`.                                                                                                                                                                                                                                            |
| Final native selector hardening                                                         | Seven focused domain/guard tests passed, including valid exact selectors and malformed/unrelated-operation rejection. `/tmp/gabs-capability-review-native-validator.log`.                                                                                                                                            |
| Browser platform and review acceptance                                                  | 13 distinct headless journeys passed. The full 13-case run preceded the final matrix-markup preservation; the affected review/matrix journey passed again afterward. The lease journey then passed its final focused rerun.                                                                                          |
| Hidden native acceptance                                                                | Final three-case run passed both boundary journeys and the real administrator review/matrix flow. `/tmp/gabs-capability-review-native-final.log`.                                                                                                                                                                    |
| Accessibility and visual checks                                                         | Scoped browser wide/narrow and native dialog Axe checks passed. Six captures were inspected: wide, narrow, native, web/native matrix and the scrolled lease-policy section. The dialog was tightened after inspection initially found the key decision below the visible area. Existing matrix sizing was preserved. |

Browser logs: `/tmp/gabs-capability-review-browser-acceptance.log`, `/tmp/gabs-capability-review-browser-final-layout.log`, `/tmp/gabs-capability-review-lease-capture-final.log`. Earlier fixtures were corrected to wait for asynchronous checkbox saves, assert the actual offline lock, and retry bounded scrolling when policy delivery replaces the reviewed DOM. The initial native run exposed the missing IPC query allowance; the final run verifies its correction. No acceptance assertion or authority boundary was removed to make a run pass.

Tests use disposable databases and hidden/unfocused desktop profiles. Historical captures and shared preview/development data were preserved. No real OS notification, production publication or whole-product accessibility approval is claimed.

## Handoff

SDK-04-FMT is the next ready correction. SDK-05 retains positive native LAN/relay/tenant/partition acceptance and its linked notification/profile/recovery gates. GOV-01/GOV-02/GOV-03 retain bulk policy, full DAG, readiness and publication acceptance; this is not a substitute for those requirements. Full parity and the separately queued UI refinement goal remain open.
