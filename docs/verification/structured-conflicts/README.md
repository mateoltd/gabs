# Structured conflict comparison

OFF-01, 18 September 2026. This extends the [original conflict journey](../conflict-review/README.md) and [independent saved reviews](../review-drafts/README.md).

## Behavior

Conflict comparisons now resolve schema-declared reference labels through the same scoped, bounded loader as resource tables. Original, local and server snapshots share deduplicated target lookups. Nested arrays, objects, map keys, tuples and active union branches keep their own reference paths. Plain text is not interpreted as a reference. Missing labels remain explicit; failed lookups offer a retry. Changed loader authority invalidates previous results.

The editor explains that each choice replaces a whole field, including its nested values. This retains the server's top-level merge contract: it does not silently combine array positions, map entries or union branches. Choosing a removed optional field deletes it; selecting an array or map does not retain extra entries from the other side. Disjoint server fields continue to merge at submission.

A real target-read revocation exposed an early-denial cache gap. Refreshed bootstrap permissions already blocked label display, but their local denial path retained downloaded options. The same target invalidation now runs for both local permission denial and server 403/404 responses. It removes current and legacy target labels while preserving review input, choices and pending request history.

## Acceptance journey

`tests/support/structured-conflict-journey.ts` uses an independently signed generated module from `tests/fixtures/conflict-review` against isolated PostgreSQL. The fixture is installed by test setup; it does not establish registry-hosting or fifth-module release acceptance.

- Edit an object, a reference inside an array, a tuple inside a map with an escaped pointer key, a discriminated union and an optional object while offline.
- Create competing authoritative changes, including a longer array, an extra map entry, a different union branch and a disjoint name change.
- Expand the original/local/server comparisons and verify visible authorized reference labels. Saving remains disabled while choices are incomplete.
- Persist two choices, reload the browser or restart hidden Electron, and resume offline with the remaining choices still required.
- Choose whole fields, including deletion, and check narrow overflow and scoped Axe. Retain the edited reference values rather than deriving writes from their display labels.
- Revoke actual target-read permission in PostgreSQL, reconnect, and verify the comparison hides labels and clears their cache. Disconnect while revoked, then restore authority and verify connected labels recover without losing choices.
- Change another disjoint server field after the saved snapshot, submit the reviewed change and verify the exact final record, version, supersession links and three update audits. The unused server array/map entries and removed optional object do not reappear.

## Verification

- Strict root and browser/Node/preload/worker checks, boundary/copy checks and all four production builds passed: `/tmp/gabs-structured-build-final.log`.
- Seven headless browser journeys passed: `/tmp/gabs-structured-web-final.log`.
- Four hidden/minimized, unfocused desktop journeys passed: `/tmp/gabs-structured-native-final.log`.
- Full unit/PostgreSQL regression passed 442 tests across 79 files: `/tmp/gabs-structured-full.log`.

Product source remained frozen during the serialized final acceptance runs. The new browser/native journeys verify the actual PostgreSQL result and audits, not only rendered success messages.

The first draft test queried expandable content before the asynchronously opened review was visible, so hidden text assertions passed without expanding it. The corrected test waits for the review, expands visible summaries sequentially and asserts visible labels. Its next run exposed the real cache invalidation gap described above.

## Visual evidence and limits

[Web expanded comparison](web-comparison.png), [web narrow comparison](web-narrow.png), [web result](web-recovered.png). [Native expanded comparison](native-comparison.png), [native narrow comparison](native-narrow.png), [native result](native-recovered.png). All six captures were inspected. Expanded comparisons remain within the dialog; narrow values stack and scroll. Native images use physical device pixels.

Existing dialog, details, fieldset and responsive styles are reused; no stylesheet changes. This is scoped functionality/accessibility acceptance, not final UI polish or whole-product accessibility conformance.

Cross-module dependent capture under explicit grants, same-record ordering, ambiguous drafts, archived-input recovery, arbitrary queued commands, direct process/sign-out/profile recovery and the remaining [offline workflow map](../../offline-workflows.md) remain required. OFF-01 and full parity stay open.
