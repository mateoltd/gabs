# UI reconciliation evidence

Completed 16 September 2026 on macOS arm64, Node 24 and pnpm 12. This closes the UI regression reconciliation against the recovered design evidence. Feature-parity implementation remains paused.

## What was restored

- Established rounded controls, panels, typography, spacing and quiet tables. Unconfigured workspaces no longer inherit the square executive preset or cache that accidental default.
- Original Overview, Orders, Inventory navigation order and distinct icons. Organization now sits with administration; newly discovered modules still appear automatically.
- Shared generated-module tabs, search, page actions, form spacing and keyboard behavior. Narrow tables scroll with readable columns instead of splitting names and emails into fragments.
- Module catalog action hierarchy, corporate-store controls, organization sections and permission matrix, and a unified Settings grid.
- Sign-in's original hierarchy and branded local-profile screens, with distinct input surfaces and an opaque standalone canvas. Native macOS controls have reserved space.

The backend, module lifecycle, policy and synchronization implementations were preserved. No release was published and no production service was changed.

## Baseline and confidence

There are no committed repository revisions to roll back to. The reconstruction uses [the surviving UI specification](../../ui.md), original navigation source recovered from this task's first audit, shared component tests, supplied artwork and existing Overview/Orders compositions. The `before` images show the regressed state at the start of this work, not a user-approved original. This is not an exact historical pixel restoration or a claim that the user has approved every screen.

## Verification

| Check                   | Result and scope                                                                                                                                                                                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source checks           | Strict TypeScript, dependency boundaries and UI-copy rules pass. All four application builds succeed.                                                                                                                                                            |
| Unit/integration suite  | [59 tests across 8 files pass](results/check.txt). No business-service source was changed after this run.                                                                                                                                                        |
| Full Chromium suite     | [50 tests pass](results/browser.txt), covering existing business, lifecycle, offline, policy, keyboard and design workflows.                                                                                                                                     |
| Navigation follow-up    | [20 focused tests pass](results/browser-followup.txt) after restoring original ordering and administration grouping. These overlap the full suite; they are not 20 additional unique tests.                                                                      |
| Native desktop          | [3 tests pass](results/electron.txt) in actual Electron, including renderer boundaries, unconfigured authentication, native screen navigation and a saved contact. The final run includes local-profile field/canvas assertions.                                 |
| Visual matrix           | 66 captures: 11 destinations, dark/light/high contrast, 1440×960 and 390×844. [Inspection data](after/inspection.json) records no page overflow or runtime errors. Additional automated layout checks cover 768px and 320px.                                     |
| Preferences and details | All 10 archetype controls captured in dark and light; system light/dark, dialogs, selects, menus, local profiles, populated business views and desktop screens also reviewed. [Supplemental inspection](after/detail-inspection.json) records no runtime errors. |
| Accessibility           | Automated WCAG A/AA checks pass on the tested module, organization, settings and contact views/dialog. Keyboard tabs, dialog focus, mobile navigation and existing reduced-motion tests pass. High-contrast token tests cover all archetypes.                    |

The final screenshot review found two issues beyond the automated matrix: indistinguishable local-profile inputs and desktop canvas transparency. Both were corrected, recaptured and checked in Electron. The first full-suite attempt also exposed a catalog-label regression, which was corrected, and a sign-in setup timeout under concurrent capture activity; the isolated full rerun passed without increasing its timeout. Tests are supporting evidence, not a substitute for inspecting the rendered interface.

## Visual review

These are real rendered application captures. Contact sheets arrange those captures for review; their gray outer canvas and filename labels are not application UI.

| Review area                          | Evidence                                                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default wide screens                 | [Dark](after/sheet-wide-dark.png), [light](after/sheet-wide-light.png)                                                                                                                      |
| Narrow screens                       | [Dark](after/sheet-narrow-dark.png), [light](after/sheet-narrow-light.png)                                                                                                                  |
| High contrast                        | [Screen comparison](after/sheet-contrast.png)                                                                                                                                               |
| Dialogs and populated business views | [Forms and populated Orders/Inventory](after/sheet-dialogs.png), [organization, task, search, account and order inspection](after/sheet-details.png)                                        |
| Local profiles                       | [Web and native comparison](after/sheet-local.png)                                                                                                                                          |
| All archetype controls               | [Dark](after/sheet-archetypes-dark.png), [light](after/sheet-archetypes-light.png)                                                                                                          |
| Actual Electron                      | [Orders](after/electron-orders.png), [Contacts](after/electron-contacts.png), [Settings light](after/electron-settings-light.png), [local profile](after/electron-local-profile-narrow.png) |

### Selected before/after

| Screen         | Start of reconciliation           | Reconciled                                |
| -------------- | --------------------------------- | ----------------------------------------- |
| Module catalog | [Before](before/modules.png)      | [After](after/modules-dark-1440.png)      |
| Organization   | [Before](before/organization.png) | [After](after/organization-dark-1440.png) |
| Settings       | [Before](before/settings.png)     | [After](after/settings-dark-1440.png)     |

Fixture data and workspaces differ between some captures. The review compares layout and styling; it does not claim deterministic pixel equality across those datasets. Contacts and Projects were unassigned in the old Northline fixture, so the new populated records were verified in a separate local review company. Browser and native test profiles are isolated from the user's ordinary sign-in session.

## Keeping this baseline

- [UI preservation contract](../../ui.md#preserving-the-established-interface).
- [Browser regression checks](../../../tests/e2e/ui-reconciliation.spec.ts) and [native regression checks](../../../tests/desktop/ui-reconciliation.spec.ts).
- [Source checksums](source-manifest.json) identify the changed source/test files. The `archive` entries identify local before/after recovery archives in `.local/ui-reconciliation`.
- Capture helpers remain in `.local/ui-reconciliation`; the final source archive also includes them. The normal browser/native tests are independently runnable through the repository commands.

To recover, first extract an archive into a temporary directory and compare the relevant files. Restore only the intended changes; do not unpack over the current repository or discard subsequent unrelated work. These local archives are a recovery checkpoint, not a remote backup or a Git commit.

## Remaining limits

This pass verifies UI reconciliation, not the entire ERP plan. Ten selectable archetypes are not ten completed independent design systems. Whole-product AAA conformance, comprehensive assistive-technology testing, live authentication/payment providers, Windows/Linux desktop acceptance and signed/notarized release distribution remain outside this result. Electron screenshots/tests use the built native development runtime with isolated profiles; they do not establish production release acceptance. The [parity tracker](../../parity-tracker.md) retains those gates and stays paused pending user direction.
