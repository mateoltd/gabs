# UI reconciliation

Status: reconciliation implemented and verified, 16 September 2026. Feature expansion remains paused at the user's request. This is a reconstructed design baseline, not a claim of exact historical pixel recovery or user sign-off.

## Baseline and limits

The repository has no committed baseline. The first audit in this task already described the compact rail, header account menu and shared visual system. The surviving [UI specification](ui.md), existing component-design tests, original branding/artwork and unchanged Orders/Overview compositions provide reconstruction evidence. Later platform screenshots are evidence of the regressions, not an approved design reference. No exact historical pixel snapshot is claimed.

Before editing, source was archived locally at `.local/ui-reconciliation/source-before.tar.gz`. Before/after screenshots live in `docs/verification/ui-reconciliation`. Preserve functional platform work while restoring the existing visual language.

## Confirmed discrepancies

| Finding                                                                                                              | Evidence                                                                                                                          | Correction                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Default archetype overrides pill buttons and rounded panels with 3px corners                                         | `index.tsx` and `platform-admin.tsx` default to executive-serious; late stylesheet overrides; before Modules/Settings screenshots | Unconfigured workspaces retain the established default. Explicitly chosen archetypes remain supported.                            |
| All module links use the same stacked icon; Organization duplicates People                                           | Navigation construction discarded Orders/Inventory icons                                                                          | Restore distinct existing navigation silhouettes and appropriate icons for new destinations; keep generic module fallback.        |
| New generated resource tabs/tables/forms use different hierarchy and spacing                                         | ModuleView markup and late CSS, including undefined active-tab tokens and unspaced fieldset contents                              | Reuse existing controls, resource tabs, search, quiet tables, form spacing and page-action hierarchy.                             |
| Module catalog is a stack of paragraphs and equally weighted actions, with store selector touching cards             | Before Modules screenshot                                                                                                         | Restore balanced cards, compact installation metadata, separate policy toolbar and orderly actions.                               |
| Organization has competing controls in one row, touching panels, raw policy identifiers and uncontrolled wide tables | Before Organization screenshot and markup                                                                                         | Group controls by task, separate sections, constrain matrix scrolling and make labels readable without changing policy semantics. |
| Settings additions sit separately from the existing card grid                                                        | Current route composition and Settings markup                                                                                     | Integrate corporate appearance, billing and desktop networking into the existing settings layout.                                 |
| Local profile view uses an unrelated bare page                                                                       | LocalWorkspace markup                                                                                                             | Carry the existing brand, spacing, shared controls and clear empty states into local work.                                        |

## Acceptance

- Inspect actual sign-in, Overview, Orders, Inventory, Contacts, Projects, Modules, Organization, People, Notifications, Audit, Settings and local-profile screens.
- Capture wide and narrow layouts, dark/light/high-contrast/system preferences and all archetype controls. Preserve the established default geometry and styles during workspace switching.
- Inspect representative dialogs, selects, menus, populated/empty states and keyboard focus. New routes must not overflow the viewport; wide data may scroll inside a clearly bounded region.
- Exercise observable workflows and existing design regression checks. Run the actual Electron runtime and inspect native screenshots, including title-bar spacing.
- Record exact verification scope, screenshots, remaining limitations and a reproducible source checkpoint. Do not claim the broader parity goal is complete.

## Completion and durable evidence

All discrepancies above were corrected. Source recovered from the first audit also confirmed the original navigation order: Overview, Orders, Inventory. That order is restored, subsequent modules remain discoverable, and Organization belongs with People and Audit under Administration.

The final visual review additionally caught unreadable wrapping in narrow generated tables, invisible local-profile fields against their card, and a transparent standalone canvas in Electron. Tables now retain readable columns inside their scroll region; local profiles have distinct fields, an opaque canvas and space for native window controls.

See the [verification report and screenshot gallery](verification/ui-reconciliation/README.md) for the actual scope, test results and limitations. Before/after source archives and a checksum manifest establish a recovery point without relying on Git history. The preservation rules in [the UI specification](ui.md#preserving-the-established-interface) apply to future work.

The parity backlog is unchanged. Resume feature expansion only on user direction; do not treat this reconciliation as permission to resume it automatically.

## UI-R02: shared list redesign, 16 September 2026

The user explicitly requested a follow-up redesign of People, Inventory and Audit, sharing the corrected Orders foundation. Implemented a single table primitive and shared list geometry across native and generated tables, plus borderless notification/export and virtual-list rows. Added useful workspace summaries, consistent identities/statuses/toolbars, searchable People views, and clearer Audit information without changing authorization or stock commands.

Verified in Chromium and actual Electron. See [UI-R02 evidence](verification/people-inventory/README.md). This intentionally updates list presentation from the reconstructed baseline; the broader parity backlog remains paused. No provider or release acceptance gate is closed by this work.
