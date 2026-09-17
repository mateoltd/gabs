# SDK-04: tuple and map editors

17 September 2026. Scoped framework acceptance, not completion of SDK-04 or approval of the product's visual design.

## Behavior

- Fixed tuple positions use recursive editors and authorized reference pickers. Drafts preserve declared literals/defaults without inventing quantities or resource IDs.
- Record maps and typed additional properties support add, rename and remove. Renaming preserves the value and updates escaped reference paths. Duplicate keys, fixed-field collisions, unmatched patterns and the transport-reserved `__proto__` key are refused. Property-count bounds constrain the controls.
- Pending key additions/renames block native submission and custom-view validity. Enter applies the edit; Escape cancels it without closing its containing dialog. The dialog's capture-phase Escape handling explicitly yields to an input with an unfinished edit.
- Tuple/map JSON mode preserves invalid input across unrelated edits, blocks saving and requires an explicit discard before returning to the last parsed structured value. Overlapping pattern constraints retain an intersection through the public `objectPropertySchema` helper.
- New standalone records use the SDK draft builder, including nested defaults. Default initialization errors stay visible without opening a broken editor.

The independent `tests/fixtures/map-tuple` package imports only public SDK/host contracts. It is built, signed, reviewed and installed without editing host routing, module unions or navigation. The same form runs in development preview and installed web/Electron views. The web journey also installs it into an encrypted local profile and creates linked records while offline.

## Test and environment evidence

All **207 unit/PostgreSQL tests in 42 files passed** in 50.20 seconds against a freshly migrated and seeded temporary database. The database was removed after the run; the existing development database was preserved. The original shared-database run passed 206 tests but timed out in the existing lifecycle test at its unchanged 30-second limit; a focused retry reproduced that timeout. Diagnostic tracing showed progress through its final upgrade sequence. Fresh-database acceptance passes the same test without changing its assertions or timeout. Larger-catalog performance and test-fixture isolation still need attention under OPS-07.

## Verified interface evidence

- Three final headless form journeys passed in 32.2 seconds: development preview, installed corporate/offline generated forms, and the existing structured-form regression.
- Five additional headless local-worker journeys passed in 45.8 seconds, covering receipts, restart/lock recovery, signed upgrades/migrations, coordinated dependencies and interrupted downloads.
- Three hidden/unfocused native journeys passed in 38.3 seconds: the independent tuple/map view, existing structured form, and encrypted local-profile restart. Native tests retained minimized mode; the new view explicitly verifies hidden/minimized and unfocused state before and after interaction.
- The tuple/map form selects target 105 through bounded search, rejects duplicate/reserved key edits, preserves renamed reference values, checks minimum/maximum entries, edits an escaped `a/b~c` key and rejects malformed map/extra-slot tuple JSON. PostgreSQL assertions check the exact accepted corporate record. The offline journey verifies unchanged corporate record count, pending-key native validity, canceled rename preservation and loaded defaults.
- Scoped Axe A/AA and 390px overflow checks passed. The existing form regression retains its malformed JSON check through the now-explicit JSON toggle. Strict TypeScript, dependency/copy checks and all four production builds passed.

### Corrections found during acceptance

An invalid fixture default (`{}` with a required minimum entry) was corrected rather than weakening validation. A locator was corrected to search within its picker. The server correctly rejected a reserved JSON key; the structured editor now explains that constraint without changing the server parser. Offline testing exposed capture-phase Escape dismissal and missing local schema defaults; both were fixed and exercised by the final passing journey. Initial offscreen element screenshots were replaced by viewport captures suitable for hidden windows.

### Captures

- [Wide form](wide.png)
- [Wide map controls](wide-map.png)
- [Narrow map controls](narrow.png)
- [Narrow tuple controls](narrow-pair.png)
- [Hidden Electron form](electron.png)
- [Saved standalone record](local.png)

Existing layout, theme tokens and host controls were reused; no CSS was changed. The standalone table capture exposes remaining raw structured-value formatting (`[object Object]` and unresolved tuple IDs). That is explicitly retained as the next SDK-04 table task, not accepted as polished UI. All six new captures were inspected. Historical regression captures were restored.

## Limits and next work

Specialized editors for every intersection/variadic tuple construct remain open; validated JSON provides explicit fallback. Raw JSON must still pass the protected server JSON parser. The public property-schema helper resolves value contracts, not transport authorization. Cross-module local lookup, nested/off-page table labels, local structured-value formatting, richer filters/sorting and broader composition remain unfinished. Scoped Axe does not replace manual assistive-technology or full theme acceptance. Hidden development Electron is not signed installed release acceptance.

Logs: `/tmp/gabs-map-tuple-build9.log`, `/tmp/gabs-map-tuple-browser9.log`, `/tmp/gabs-map-tuple-local-regression.log`, `/tmp/gabs-map-tuple-native.log`, `/tmp/gabs-map-tuple-isolated-full.log`. Earlier correction logs are retained under `/tmp/gabs-map-tuple-*`.
