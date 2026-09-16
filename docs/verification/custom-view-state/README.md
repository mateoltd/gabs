# Typed custom-view input across releases

16 September 2026. EXT-05 continuation; the broader lifecycle and parity goals remain active.

## Implementation

A view declares its editable schema and state version once in the signed manifest. The three-argument `defineView` overload infers read-only values, saves and conversion output from that schema. The host validates bounded JSON checkpoints, owns an immutable copy and isolates them to the mounted account/workspace/module session. Stateful bundles use the explicit `suite-view-v2` ABI; stateless v1 views retain their existing behavior.

The existing update dialog offers **Update and keep input**. The candidate is verified and preloaded before it can replace the old component. Same-version input must validate against the target schema; a state-version change requires a publisher conversion whose result is also validated. Active custom writes block replacement. Invalid conversion keeps the current component/input. An initial render failure restores the previous executable and its checkpoint. Once the candidate renders successfully, the handoff is complete. The explicit discard fallback remains available for views without this contract.

[Public authoring guide](../../module-view-state.md) and [example source](../../../tests/fixtures/editable-notes/view.tsx).

## Evidence

- SDK tests check inferred view identifiers, field types, required fields, read-only values and conversion output. They build the v2 bundle, hydrate transported schemas, reject ABI/metadata mismatches and validate successful/invalid version conversion. Cyclic, lossy, oversized and invalid input fail without altering the original snapshot.
- The browser publishes five independent releases through CLI build, review, stage and publish. It verifies a held successful write prevents replacement; a compatible update retains input; invalid conversion leaves the original input; an initial render crash rolls back; and a corrective release converts a renamed field and submits the retained input through its own server operation. Two deliberate saves leave exactly two records and receipts.
- The native journey installs independent signed releases in real Electron, retains input through a failed conversion and then successfully converts/saves through the bounded IPC. Exactly one record and receipt remain. The workspace and grants are isolated fixtures, not additional administrator-journey evidence.
- Browser update dialogs have zero detected Axe WCAG A/AA violations. Wide/narrow input and failure screens were inspected. Native rendering and input preservation were inspected in a minimized runtime.

[Failed conversion](failed-conversion.png), [failed initial render](failed-render.png), [restored fields](restored.png), [narrow view](narrow.png), [Electron restored fields](electron-restored.png).

Verification: all 79 unit/PostgreSQL tests and four production build tasks passed. The broader browser regression passed 26 of 27 journeys and exposed an uninstall race. After the fix, all seven affected editor, rollout and recovery journeys passed, including the previously failing recovery test. This provides 27 distinct selected browser passes across the candidate iterations; the full browser suite was not rerun locally. All nine real Electron journeys passed again after the uninstall fix, with every test window minimized and unfocused. Formatting passed. Screenshots of both friendly failure states and restored input were inspected.

## Uninstall race found by regression

A background installer could wait behind an explicit uninstall while retaining a stale platform snapshot, then reinstall the removed module. It now rechecks the authoritative device removal state inside the lifecycle lock before beginning background installation. Explicit reinstall and resuming a previously explicit install remain supported. The PostgreSQL regression verifies that a stale background caller leaves the device removed, adds no installation audit and creates no pending install; the subsequent explicit reinstall succeeds. The real browser recovery/uninstall journey passes after the fix.

## Test execution corrections

The browser initially clicked a previously pending candidate before the next release appeared; it now waits for the exact release notice. The held-write scenario uses the real focus refresh because advancing 31 seconds would correctly expire that request's 20-second HTTP timeout. The native test installs its controlled clock before creating the view's polling timers. These corrections retain the behavior assertions and do not relax product checks. One earlier native-suite workspace-selector timeout did not recur in the focused rerun or the complete minimized run.

At the user's request, browser tests run headless and native tests start minimized without taking focus or showing a Dock window. The native boundary journey asserts minimized/unfocused windows. Unpackaged test rendering disables background throttling so verification continues; packaged/default application behavior is unchanged. This is not evidence for real OS focus/privacy behavior.

## Limits

Only declared state transfers. Arbitrary React state, ongoing workers, focus and side effects are not captured automatically. These checkpoints are in memory and do not establish crash persistence, navigation/profile-removal recovery or durable custom-operation recovery. A publisher still has to handle uncertain business results correctly; saved editing input is not an acceptance receipt. Initial-render recovery does not claim recovery from every later effect or arbitrary publisher bug.

Generated native unsaved-editor handoff, rollout progress/failure reporting and connected suspension delivery remain EXT-05 work. Signed installed-runtime acceptance on every OS, external providers and the separately queued final UI-refinement goal remain unfinished.

## Previous remote candidates

Run `35095394975` for `3118da9` passed all 64 browser journeys, code/build checks, three unsigned packaging jobs and logical restore. Read p95 was 761 ms and confirmation 763 ms. Run `35095892425` for `2986647` also passed browser/build/packaging/restore but failed reads at 640 ms (confirmation 723 ms). The 500/1000 ms targets are unchanged, so OPS-07 remains open. These are prior candidates, not verification of this state-transfer implementation.
