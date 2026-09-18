# Explicit command continuation across modules

Status: locally verified cross-module command continuation, 19 September 2026. OFF-01 and full product parity remain incomplete. [OFF-01-EXPORT](../recovery-metadata-ordering/README.md) was subsequently verified.

## Behavior and ownership

Command review can inspect and select never-submitted direct dependents from other modules, including saved resource writes. It shows the owning module, original signed input, release and retry identity. Selection changes scheduling only: the request body, record target and identity remain exact. Unselected work keeps its original prerequisite. Submitted or otherwise recovery-bound children are excluded.

The shell verifies the child's actual installed dependency graph and original response contract before presenting its input. Both original and installed contracts must still permit queued execution. Original/current command permissions, or resource read/write permissions, are evaluated against the child's module. Every dependency must remain enabled, entitled and assigned. The review's existing account/workspace, view, lease and connection checks still apply.

The client recovery kernel supplies current transaction storage and the selected dependent's journal identity to the authorization callback. This distinguishes continuation authorization from the owning module's normal capture interface, including legacy calls without an embedded request key. Uninstall intent, removal, changed releases/signatures and revoked authority prevent stale approval from committing. If the original has already been fenced, its stopped identity and separate review remain durable. A new replacement and approved prerequisite remaps commit together.

Unavailable selections remain saved. A user must restore access or explicitly remove them; losing permission does not silently convert a review into approval of a different set of work. The server still validates every eventual business request. A scheduling prerequisite does not confer cross-module service/read grants.

## Acceptance scope

The real client journey independently publishes and installs two SDK modules. It captures a rejected parent in one module and selected/unselected dependent commands in the other through public queued APIs. Review and selection survive an offline browser reload or native process restart. The test holds a real settlement response, revokes the child's permission through a policy notification, and requires preserved input, review and journal entries with no replacement. Regrant permits explicit continuation of only the selected child. Repeated accepted calls must leave exactly two records and two corresponding audit entries.

Focused signed-contract/storage tests cover selected cross-module commands and create/update/archive entries, unchanged bodies, unselected and uncertain-child preservation, dependency graph removal, original/current permissions, policy changes, and removal/revocation/signature changes during settlement. They also prevent a same-module child without an embedded key from inheriting parent authorization.

## Remaining gates

This scoped milestone does not complete OFF-01. The later [public queued-resource milestone](../resource-continuation/README.md) adds command-to-create continuation through the SDK and create/update/archive restart/retry journeys. Broader update/archive descendants in rejected-command reviews, submitted-child outcomes, source-schema/legacy combinations and full scheduling simulation remain required. Sign-out/profile recovery, provider/signed-release acceptance and final UI refinement remain open. Earlier intermittent native dialog and concurrent Orders concerns remain tracked independently.

## Verification

- Strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh production builds passed on final product source. Existing bundle-size warnings remain. Log: `/tmp/gabs-continuation-build-final.log`.
- All thirteen headless browser correction journeys passed together on final source. Log: `/tmp/gabs-continuation-web-acceptance.log`.
- The new browser journey passed again after the shared harness explicitly reopened the review following reconnect. Log: `/tmp/gabs-continuation-web-cross-final.log`.
- Eleven native regression cases passed in the full run; the new cross-module case and the resource-uninstalled case passed the focused run. All ran hidden/minimized and unfocused on final product source. Logs: `/tmp/gabs-continuation-native-acceptance.log` and `/tmp/gabs-continuation-native-focused.log`. The failures and unresolved export concern are distinguished below; this is not a clean full-suite native result.
- The complete unit/PostgreSQL regression passed 531 tests across 88 files. Log: `/tmp/gabs-continuation-regression.log`. Final strict checks after the harness correction also passed in `/tmp/gabs-continuation-types-final.log`.
- Ten wide/narrow web/native captures were inspected, including expanded selected/unselected input, reachable scrolled actions, received revocation and read-only late acceptance. Scoped Axe/overflow checks passed. No stylesheet changed; this is continuity evidence, not final UI approval or whole-product AAA conformance.
- 116 historical PNGs overwritten by regression journeys were restored; only this milestone's ten captures are retained. Changed TypeScript formatting, diff checks and documentation links were checked before commit.

## Review and fixture corrections

The final review keeps cross-module continuation authorization separate from normal module capture, and passes actual journal identities for older calls without an embedded key. Unavailable selections cannot be silently dropped or submitted. Read-only reviews after late acceptance no longer show an unavailable-selection recovery action; the active confirmation explains why continuation was disabled after revocation.

Fixture corrections preserved production validation: signing fixtures declare their own module permissions, retry keys meet the existing schema, browser readiness checks the persisted installation version rather than an externalized artifact's inline bytes, and assertions respect the accessibility boundary between a confirmation and the underlying inert review. These intermediate runs are not added to final acceptance totals.

## Native export reliability follow-up: OFF-01-EXPORT

The full native run passed eleven cases but failed the new cross-module case because the harness reloads on reconnect, and separately failed the existing `resource-uninstalled` export journey. The harness now explicitly reopens the saved review after reconnect. Both targeted journeys subsequently passed on unchanged product source in `/tmp/gabs-continuation-native-focused.log`.

The export failure occurred in `resourceHostJourney` after restoring write permission, reloading Settings and restarting offline, during the saved create/update/draft exports. Main returned `Reconnect to authorize recovery export.` No export implementation changed in this milestone, and the unchanged rerun is not a fix. Investigate protected recovery state and late bootstrap/catalog/receipt observations around restoration before closing OFF-01-EXPORT. Stale-response handling is a hypothesis, not an established cause. Preserve actual revocation, scope and lease checks while diagnosing it. The final current-source native coverage consists of eleven successful regression cases plus these two successful focused cases, not a claim that the earlier full suite was green.


Follow-up resolution, 19 September 2026: [OFF-01-EXPORT](../recovery-metadata-ordering/README.md) now has a controlled failing-before/passing-after reproduction and final-source acceptance. Obsolete successful metadata caused the newer native authority to be revoked; that path is fixed while current malformed metadata, actual denials and lease checks remain enforced. The earlier failed runs above remain historical evidence.
