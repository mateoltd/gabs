# Retired command recovery

OFF-01 scoped acceptance, 18 September 2026. Full parity and final UI refinement remain open.

## Behavior

- Saved commands whose operation was removed or reclassified remain inspectable under the retained signed original contract. The original permission is required; if the operation still exists, its current permission is also required. Account/workspace, module availability, view permission, offline consent and lease checks continue to apply.
- Original input, retry identity, release, prerequisites, accepted output and a separately saved review retain their original schemas and versions. A retired command cannot be retried or corrected through the installed release. No review is silently reinterpreted or submitted.
- Explicit resolution asks the server for the original accepted receipt or an authoritative cancellation. Never-submitted, rejected and conflicting command entries can be resolved without replacing their identities or dependent bodies. A lost response leaves the original available for recovery after restart.
- Settlement of an original public command remains possible when today's operation is service-only, under both permissions. Settlement invokes neither handler. Current service-only execution and settlement requests are still denied to a direct client.
- Generated resource screens synchronize resource edits, leaving custom commands to the owning custom-view host. This closes a route that could otherwise dispatch commands without that host's original/current contract checks.

## Acceptance

- Strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh production builds passed (`/tmp/gabs-command-retirement-build-final2.log`). The final `pnpm build` rechecked all source/test types and boundaries, then reused four valid cached build tasks (`/tmp/gabs-command-retirement-build-verified.log`). Existing bundle-size warnings remain.
- All 506 unit/PostgreSQL tests across 84 files passed on a freshly migrated/seeded isolated database (`/tmp/gabs-command-retirement-full.log`). Focused storage/host/correction coverage passed 70 checks (`/tmp/gabs-command-retirement-unit2.log`).
- Eleven headless browser cases passed: eight correction modes, public SDK queue/preview and generated-resource settlement (`/tmp/gabs-command-retirement-web-final.log`). Both expanded resource-isolation/lost-reply journeys passed with the final harness (`/tmp/gabs-command-retirement-web-final2.log`).
- All ten hidden/unfocused Electron cases passed, including the two expanded retirement journeys and earlier queue/correction/settlement regressions (`/tmp/gabs-command-retirement-native.log`). Each command journey verifies that every remaining window is hidden or minimized and unfocused.
- Scoped Axe, overflow checks, offline-disabled controls, Escape/reopen interaction and expanded original-input/review displays pass in the new journeys. Eight representative recovery captures were visually inspected for preserved structure and bounded content. Fifty-three modified historical captures were restored; sixteen new milestone captures are retained. No stylesheet changed.

### Harness corrections

The first service-only fixture omitted `public: true`, which the SDK correctly requires for module-to-module services. The fixture was corrected without changing validation. The expanded Contacts check initially matched both its sidebar link and breadcrumb; it now scopes to Main navigation. A later recovery run restarted before observing the intentionally lost response: the pre-existing accepted receipt and unchanged local rejection were insufficient synchronization. The test now waits for the visible failure before offline restart. The final native and focused browser runs both use the corrected wait. The focused unit fixture also replaced a too-short test retry key with a valid opaque identifier. No timeouts, acceptance criteria or product rules were weakened.

The shared real-browser/native journey creates three commands offline, receives a server rejection, saves a distinct correction and restarts. It then installs a separately signed release removing the command or changing it to an online module-to-module service. Missing original/current grants deny historical access and server settlement. Authorized offline restart exposes original input and review read-only. Explicit outcome recovery survives an intentionally lost reply and a further restart, preserving the exact graph. In the service case, another original-version request committed before the upgrade: recovery returns that result without an additional effect. One never-submitted child is explicitly cancelled; the other remains unsubmitted. A Contacts edit then synchronizes independently without dispatching the retired command. Real records, cancellation audit counts, stable attempts, original bodies, reviews and prerequisite arrays are checked.

Unit coverage also exercises original policy changes to online, local, query and service-only, absent contracts and version/module mismatches. Those additional classifications have focused contract coverage; the full browser/native journeys exercise removal and online service-only reclassification.

## Visual evidence

| Case | Browser | Hidden desktop |
| --- | --- | --- |
| Removed command, original input and review | [Read-only](web-removed-readonly-narrow.png) | [Read-only](native-removed-readonly-narrow.png) |
| Removed command, cancellation retained | [Recovered](web-removed-recovered-narrow.png) | [Recovered](native-removed-recovered-narrow.png) |
| Reclassified command, original input and review | [Read-only](web-service-only-readonly-narrow.png) | [Read-only](native-service-only-readonly-narrow.png) |
| Reclassified command, original accepted receipt | [Recovered](web-service-only-recovered-narrow.png) | [Recovered](native-service-only-recovered-narrow.png) |

## Limits and continuation

- The host recovery surface currently requires an available installed custom view. Recovery after uninstall, removal of the whole view/navigation, suspension, permanent revocation, and a module-independent recovery inbox remain required.
- Command recovery export and administrator assignment of historical permission identifiers remain required. Test setup changes real database grants; it does not establish the administrator UI for historical grants.
- Dispatch remains owned by mounted module views. A general workspace scheduler must preserve these boundaries when introduced; this milestone does not establish background execution with every module view closed.
- Further schema transitions, three-release reviews, cross-module/resource continuations, submitted-child outcomes, reference-aware correction editors, profile/sign-out behavior, history retention and broader offline/release gates remain open.
- The earlier linked-create dialog-close reliability concern and concurrent Orders draft server error remain unestablished, as documented in [upgrade acceptance](../command-upgrade/README.md). Passing regressions do not establish their causes or fixes.
- No production release, hosted/provider acceptance, UI redesign, stylesheet change or full AAA conformance is claimed.
