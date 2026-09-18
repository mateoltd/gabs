# Host-owned command recovery

18 September 2026. Scoped OFF-01 work; full parity and final UI refinement remain open.

## Behavior

Settings > Offline work on this device exposes saved command recovery independently of module navigation, custom views and device installation. It shares the existing journal, original/review schema verification, permission gates and authoritative settlement implementation.

- Opening recovery cannot capture, synchronize or correct commands. Explicit settlement recovers an accepted receipt or fences the original request. Original input, identities, reviews and dependencies remain unchanged.
- Online inspection uses the workspace's current server-selected contracts. Offline inspection uses verified downloaded contracts, current cached grants and the existing bounded authorization lease. Uninstall retains the last signed device contract separately from original input contracts; retained packages do not become executable installations.
- Original and current operation permissions apply. The old view's permission is not a recovery requirement. Suspension, missing module access and expired authority still deny recovery. No permanently revoked-workspace recovery exception is introduced.
- Missing or damaged contracts never fall back to an arbitrary historical schema. Unrelated recoverable modules can remain available.
- Existing Settings layout and shared dialogs are reused; no stylesheet change.

## Acceptance

Final product source passed:

| Check | Result | Local log |
| --- | --- | --- |
| Full unit/PostgreSQL regression | 508/508, 85 files | `/tmp/gabs-host-recovery-full.log` |
| Strict checks, boundary/copy checks and builds | Passed, four fresh builds | `/tmp/gabs-host-recovery-build-final.log` |
| Headless browser regression | 14/14: ten command cases and four list/administration cases | `/tmp/gabs-host-recovery-web-regression.log` |
| Hidden/unfocused Electron regression | 10/10, including process restart and window visibility/focus assertions | `/tmp/gabs-host-recovery-native.log` |
| Final expanded-harness strict TypeScript check | Passed after the final test-only expansion | `/tmp/gabs-host-recovery-typecheck-final.log` |

The earlier focused storage/lifecycle run passed 53 tests. The first two new browser cases also passed before strengthening the viewless case with a still-public command and independent unsent request. Those preliminary runs are not substituted for the final expanded regression above.

The passing shared journey covers signed view removal and device uninstall, original/current grant denial, module suspension, loss of the old view permission, offline restart, lost settlement replies, accepted/cancelled outcomes, exact original reviews/graphs and independent Contacts progress. The expanded viewless case retains a still-public queued command and an independent unsent request; its dispatch count remains zero through Settings recovery and unrelated resource synchronization. The uninstall case recovers an earlier accepted receipt and verifies the module remains uninstalled. Permission denial/suspension setup uses fixture SQL; the uninstall case retains the real historical role creation/assignment/matrix journey.

The initial browser run failed because an unscoped Settings locator also matched the current-page breadcrumb. The locator now targets the Preferences navigation. No timeout or acceptance requirement was weakened.

## Visual review

Twenty new captures were inspected: pre-upgrade saved reviews at wide/narrow sizes, Settings entry points, offline original-input/review inspection and final recovered outcomes on both clients. The recovery list scrolls vertically at narrow widths; labels and expanded values remain readable. Scoped dialog Axe and overflow checks passed. An initial Settings screenshot exposed unnecessary inherited form spacing; the final container uses normal document spacing without stylesheet changes.

| Surface | Settings | Offline inspection | Recovered outcome |
| --- | --- | --- | --- |
| Browser, view removed | [Entry](web-viewless-settings.png) | [Original and review](web-viewless-readonly-narrow.png) | [Cancellation](web-viewless-recovered-narrow.png) |
| Browser, uninstalled | [Entry](web-uninstalled-settings.png) | [Original and review](web-uninstalled-readonly-narrow.png) | [Accepted result](web-uninstalled-recovered-narrow.png) |
| Desktop, view removed | [Entry](native-viewless-settings.png) | [Original and review](native-viewless-readonly-narrow.png) | [Cancellation](native-viewless-recovered-narrow.png) |
| Desktop, uninstalled | [Entry](native-uninstalled-settings.png) | [Original and review](native-uninstalled-readonly-narrow.png) | [Accepted result](native-uninstalled-recovered-narrow.png) |

Eighty-five historical tracked captures were restored after the regression. These are scoped preservation/readability checks, not final UI approval or whole-product accessibility acceptance.

## Remaining work

This surface covers corporate saved commands. Host-owned resource/draft recovery after losing their views, command export, general background scheduling, cross-module/resource dependents, submitted-child outcomes, profile/sign-out recovery and the remaining offline workflow map are still required. Offline inspection uses the last downloaded contract within its lease; connected server validation remains authoritative. Hosted trust rotation and signed installed-platform acceptance retain their release gates.

The earlier linked-dialog close and concurrent Orders draft reliability concerns remain open; passing these journeys does not establish their causes.
