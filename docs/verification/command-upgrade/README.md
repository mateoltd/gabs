# Saved commands across module upgrades

Scoped OFF-01 implementation and acceptance, 18 September 2026. Full parity remains open.

## Behavior

The custom-view host checks the signed original operation and the active installed operation before exposing saved command input/results, preparing corrections, choosing dependents or synchronizing work. Both permission identifiers must be currently granted. Unknown contracts, foreign modules, inherited object properties and unsupported operation policies/kinds fail closed. Permission decisions remain live; only verified definitions are retained in memory.

Saved reviews also retain their own release contract. Saving a review under a newer release rechecks access to the prior review's contract as well as the original request and current command. An obsolete view callback cannot continue after its module version changes. Missing historical contracts leave affected work unavailable without preventing other verified entries from being inspected or synchronized.

The authoritative server already checks original and current release permissions during settlement. This milestone closes the corresponding client saved-input boundary; it does not replace server validation. No stylesheet, SDK public ABI or signed historical package changed.

## Real-client journey

- Capture a parent and two dependent commands offline through the SDK, receive a declared rejection, save a correction and restart offline.
- Publish and review a second signed executable release, configure an explicit compatible rollout and install it through the module UI. The command has a different permission and a new required input field. Resource schema/storage remain compatible.
- Establish old-only permission: new capture is disabled and old saved commands are hidden. Establish new-only permission: new capture is enabled, but historical commands/reviews remain hidden, including after an offline browser reload/native process restart. A direct original-release settlement request receives HTTP 403.
- Restore both grants, reopen the saved review and preserve its original input. Replacement stays disabled until the new required field is supplied. Explicit saving records the current review version while retaining the exact original source call.
- Lose a settlement reply, restart offline again and resume explicitly. The original identity stays cancelled; the replacement uses the new schema/version. The selected dependent retains its old exact body/version under the compatible rollout, and the unselected dependent stays unchanged. Exact replay produces two records and two creation audits, with no duplicate effects.

Permission states are established in the isolated database fixture and read through real server policy/bootstrap responses. This proves the access and recovery boundary, not administrator UI support for regranting a permission removed from the current catalog. That governance/recovery flow remains required.

## Sources

- [Dual-contract permission check](../../../packages/shell/src/features/modules/views/command-permissions.ts), [queue/review host integration](../../../packages/shell/src/features/modules/views/queued-commands.tsx).
- [Focused permission checks](../../../tests/unit/queued-host.test.ts), [shared upgrade journey](../../../tests/support/command-correction-journey.ts), [browser runner](../../../tests/e2e/command-correction.spec.ts), [native runner](../../../tests/desktop/command-correction.spec.ts).

## Verification

- Final `pnpm build` passed strict root/browser/Node/preload/worker checks, architecture/copy checks and four fresh production builds. `/tmp/gabs-command-upgrade-build-final.log`; existing bundle-size warnings remain.
- Focused unit checks passed 17/17 across two files. The final full isolated PostgreSQL/unit run passed **504/504 across 84 files**: `node /tmp/gabs-host-ui-browser-isolated.mjs exec vitest run`, `/tmp/gabs-command-upgrade-full2.log`. The earlier business failure and passing 18-test focused rerun are recorded below, not hidden by the final pass.
- Final headless browser run passed **9/9**: `node /tmp/gabs-host-ui-browser-isolated.mjs exec playwright test tests/e2e/command-correction.spec.ts tests/e2e/queued-commands.spec.ts tests/e2e/review-drafts.spec.ts`; `/tmp/gabs-command-upgrade-web-final3.log`.
- Final hidden/unfocused Electron run passed **8/8**: `node /tmp/gabs-host-ui-browser-isolated.mjs exec playwright test --config playwright.desktop.config.ts tests/desktop/command-correction.spec.ts tests/desktop/queued-commands.spec.ts tests/desktop/review-drafts.spec.ts`; `/tmp/gabs-command-upgrade-native-final.log`.
- These final runs include the operation-specific verified-contract cache correction from parent review. It prevents a missing operation from invalidating another operation's verified definition. Earlier browser/native passes do not substitute for this final-source run.
- Scoped dialog Axe, keyboard and overflow assertions passed. Six representative denial/review/outcome captures below were inspected. Ten new upgrade captures are retained; 44 modified historical regression captures were restored to committed bytes. Layout/style declarations are unchanged; this is continuity evidence, not final UI approval.
- Changed code passed Prettier and `git diff --check`. Runners/builds were serialized, isolated databases removed, and shared development servers preserved.

## Representative visual review

- [Browser denied original permission](web-original-permission-denied.png), [native denied original permission](native-original-permission-denied.png).
- [Browser new-schema review](web-upgraded-review-narrow.png), [native new-schema review](native-upgraded-review-narrow.png).
- [Browser recovered outcome](web-upgrade-result-narrow.png), [native recovered outcome](native-upgrade-result-narrow.png).

## Test setup corrections

The initial isolated case observed enabled capture immediately after installation. The fixture now explicitly establishes the old-only permission state and reloads the installed view before testing that boundary. The isolated upgrade case then passed. The first combined run passed eight cases but its upgrade selector matched six registry cards with the same fixture display name. Fixtures now use unique names; selectors still require the exact target module. No production permission rule, assertion or timeout was relaxed.

## Required continuation

- Read-only recovery for commands removed or reclassified by an upgrade; an unavailable current command currently hides its saved inbox entry. Preserve original work rather than reinterpreting it.
- Administrator recovery/grant workflows for historical permission identifiers no longer listed by the current catalog; three-release review journeys and more disruptive schema transitions.
- Profile/sign-out recovery, permanent revocation, cross-module/resource dependents, submitted-child outcomes, reference-aware review, history retention and full scheduling simulation.
- The earlier intermittent linked-create dialog-close concern remains unresolved. Broad OFF-01, release readiness and final UI refinement remain open.


## Business regression follow-up

The first full run passed 503/504 tests; `tests/integration/module-platform.test.ts` failed while issuing two concurrent Orders drafts, receiving the generic server error at line 691. The complete 18-test business file then passed in an isolated rerun. PostgreSQL logs did not establish the cause of that request error; no server/runtime source changed in this milestone. Retain this reliability concern under APP-02 and final release acceptance. A passing rerun does not establish a fix. Original logs: `/tmp/gabs-command-upgrade-full.log`, `/tmp/gabs-command-upgrade-business-rerun.log`, `/tmp/gabs-command-upgrade-postgres.log`.
