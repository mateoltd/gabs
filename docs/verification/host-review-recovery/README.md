# Saved-review recovery outside module views

18 September 2026. Scoped OFF-01 acceptance; overall parity remains open.

## Behavior and correction

Settings > Offline work on this device > Saved work recovery preserves independent queued and direct reviews, ordinary drafts, original collision-source input and archived review input after device uninstall. Inspection uses retained contracts and existing resource authority. It does not install code or submit a change.

Archived review presentation previously used the later archived target snapshot as the original editing base. The host now derives the original record/version from retained recovery provenance and obtains base values only from a matching original request or collision source. If those values are unavailable, it says so rather than substituting a newer record. The storage regression covers both a retained original request and its absence. Collision reviews also identify the selected record, original record and prerequisite request, with an explicit reminder when target comparison is still required. Reassigned new drafts receive a draft-review instruction instead of referring to a nonexistent selected record.

## Real-client journeys

The [shared host recovery helper](../../../tests/support/host-review-recovery.ts) extends the existing independent-review, collision and archived-input journeys. They capture actual work in generated editors, uninstall through Modules, restart offline, inspect through Settings, reconnect, reinstall and finish the original workflow. Contacts uninstall first removes its installed Projects dependent through the same public UI; both are reinstalled afterward.

The helper asserts exact preservation of journal entries, draft values, targets, reviews and original versions before and after inspection/reinstallation. Settlement controls are disabled offline. The module remains absent throughout offline inspection. The original journeys then verify accepted server records, preserved ordinary drafts and exact audit effects.

- Queued reviews keep two independent comparisons with opposite field choices alongside an ordinary draft.
- Direct online-resource reviews remain distinct from an ordinary saved draft, with no journal settlement action introduced for them.
- Collision-linked ordinary drafts retain their original source, chosen target and parent identity. Reinstallation resumes explicit comparison/correction before submission.
- Archived input shows the original version 1 and values, not the later archived version 2. The archived record remains unchanged while independent active work completes.

Browser restart uses an offline browser context. Native restart denies transport from process startup and opens isolated hidden/minimized, unfocused windows. Keyboard activation, narrow-width overflow and scoped Axe A/AA checks exercise the recovery dialog. Comparison disclosures are opened through both levels to check that the saved choices are visible.

## Verification

The original-base model and unchanged storage/server paths passed all 511 unit/PostgreSQL tests across 85 files. Strict root/browser/Node/preload/worker checks, boundary/copy checks and four fresh build tasks passed after the final collision instruction correction. Ten headless browser cases passed with the expanded visible-choice assertions and the existing host command/resource regression set. After the final ready-draft wording clarification, the affected browser collision journey passed again and all nine hidden/unfocused native cases passed. No model or server code changed after the full unit/database run. All twenty new captures below were inspected, including the final comparison captures after scrolling. Scoped Axe/overflow checks, formatting and diff checks passed. Every isolated test database was removed by its runner; shared local services were preserved.

Initial fixture failures respected a real dependency guard (Projects depends on Contacts), then exposed overly broad navigation and nested locator scoping in the new test helper. The helper now follows the public dependency order and scopes the sidebar/relative heading locators correctly. No product permission or uninstall guard was relaxed. A run waiting on the known incorrect navigation selector was explicitly interrupted; its runner removed the isolated database before the corrected run began.

Visual review prompted opening the nested comparison values through their real disclosure controls. Both saved choices are asserted visible. The comparison capture additionally checks viewport inclusion and waits for two animation frames after scrolling, because an earlier queued-comparison capture did not paint the expected text.

55 modified historical PNGs were restored. The new captures belong only to this milestone. No stylesheet changed.

## Inspected captures

These are scrolled inspection views of the existing dialog. They are evidence of readable recovery data, not approval of the overall UI design.

| Scenario                           | Browser                                      | Native                                          |
| ---------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| Queued reviews, wide               | [Capture](web-queued-reviews.png)            | [Capture](native-queued-reviews.png)            |
| Queued reviews, narrow             | [Capture](web-queued-reviews-narrow.png)     | [Capture](native-queued-reviews-narrow.png)     |
| Queued reviews, comparison choices | [Capture](web-queued-reviews-comparison.png) | [Capture](native-queued-reviews-comparison.png) |
| Direct reviews, wide               | [Capture](web-direct-reviews.png)            | [Capture](native-direct-reviews.png)            |
| Direct reviews, narrow             | [Capture](web-direct-reviews-narrow.png)     | [Capture](native-direct-reviews-narrow.png)     |
| Direct reviews, comparison choices | [Capture](web-direct-reviews-comparison.png) | [Capture](native-direct-reviews-comparison.png) |
| Collision drafts, wide             | [Capture](web-collision-reviews.png)         | [Capture](native-collision-reviews.png)         |
| Collision drafts, narrow           | [Capture](web-collision-reviews-narrow.png)  | [Capture](native-collision-reviews-narrow.png)  |
| Archived input, wide               | [Capture](web-archived-review.png)           | [Capture](native-archived-review.png)           |
| Archived input, narrow             | [Capture](web-archived-review-narrow.png)    | [Capture](native-archived-review-narrow.png)    |

## Limits

This milestone proves the listed uninstall/reinstall journeys. It does not establish every source-schema transition, unknown legacy archive variant, permanently revoked workspace policy or profile/sign-out recovery. Missing original values have focused model evidence, not a complete legacy real-client acceptance matrix. Independent command/record exports, general background scheduling, cross-module/resource dependents, submitted-child outcomes and custom/archive descendants remain required.

The older intermittent native linked-dialog close and concurrent Orders draft server-error concerns remain unresolved; passing regressions do not establish their causes. No broad original requirement closes here, and this is neither final UI approval nor whole-product accessibility conformance. Existing components and styles are retained.
