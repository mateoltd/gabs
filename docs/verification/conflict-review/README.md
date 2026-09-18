# Explicit resource conflict review

Status: scoped implementation verified locally, 18 September 2026. OFF-01 remains active.

## Behavior

- Generated update requests retain original field values alongside the original record version. The server continues to use its own historical revisions for authoritative merges; client-provided originals confer no authority.
- Review fetches the current authorized record and compares original, attempted and server values. Disjoint server changes survive in the proposed result. Each overlapping top-level field needs an explicit local/server choice before editing or saving. Objects and arrays use the same whole-field granularity as server merging.
- Legacy requests without original values show that absence and require explicit choices for all differing fields. Missing values, null, false, object values and prototype-named fields retain their distinct meanings. Inherited object properties cannot count as selected choices or alter object prototypes.
- Choices, the compared server version and subsequent form edits persist with the saved draft. Resume shows the retained server snapshot and explains that saving rechecks current server state. Another overlapping server edit creates a new visible conflict; disjoint later server changes still survive.
- Journal replacement preserves the record target, reconnects dependents and clears the saved review atomically with the replacement entry. The duplicate post-save replacement path was removed. Known local journal validation failures carry an explicit error classification so they do not lock the editor as if a server reply were uncertain.

## Executed verification

| Check | Result and evidence |
| --- | --- |
| Initial focused review/storage checks | 8/8 passed before the final prototype-field hardening. `/tmp/gabs-conflict-review-unit.log`. |
| Final full isolated unit/PostgreSQL suite | 405/405 passed across 75 files, including the prototype-name, optional removal, structured value, legacy and journal regression coverage. `/tmp/gabs-conflict-review-full.log`. |
| Strict checks/builds | Root and browser/Node/preload/worker TypeScript, dependency/copy checks and all four production bundles passed on final product source. `/tmp/gabs-conflict-review-build-reviewed.log`. Existing web chunk-size warning remains. |
| Browser regression run | 7/7 passed: current and legacy conflict journeys, malformed-response recovery, retained-version/mandatory-rollout recovery and offline dependent creates. `/tmp/gabs-conflict-review-regressions.log`. |
| Final affected browser run | Both current and legacy journeys passed after prototype-field hardening. `/tmp/gabs-conflict-review-browser-final.log`. |
| Final hidden native run | 2/2 passed after prototype-field hardening: conflict review/process restart and the offline dependency/lost-reply journey. `/tmp/gabs-conflict-review-native-final.log`. |
| Initial hidden native journey | Passed full process restart with saved review choices and additional edits, then a second concurrent conflict and authoritative acceptance. `/tmp/gabs-conflict-review-native.log`. |

The shared browser/native journey changes name and phone offline while another authenticated session changes those same fields and email on the server. It proves the review remains unsavable until explicit choices are made, preserves server email, saves an additional address edit, and resumes those choices/edits after browser reload or full Electron process restart. A second remote name/email change produces another conflict. The final accepted record retains the new server name/email and the user's review-only address edit. The journal contains two superseded conflicts and one accepted replacement; PostgreSQL has exactly the three expected update audits, with no audit for rejected attempts.

The legacy browser journey removes only the unsubmitted draft's original-value metadata to represent an older persisted request. The UI reports unavailable originals, requires an additional explicit email choice, and completes the same real server workflow. The fixture does not forge a server outcome or bypass authorization.

## Interface evidence and limits

Scoped Axe and narrow overflow assertions pass. Captures were inspected for readability, contained scrolling and responsive comparison values: [web](web-comparison.png), [web narrow](web-narrow.png), [legacy web](web-legacy-comparison.png), [legacy narrow](web-legacy-narrow.png), [native](native-comparison.png) and [native narrow](native-narrow.png). The existing host form controls, modal and theme remain in use. This is scoped continuity evidence, not final design approval or whole-product accessibility conformance.

Browser tests were headless. Native windows stayed hidden/minimized and unfocused; no OS picker or notification was opened. Persistence, authentication, PostgreSQL, concurrent requests and server validation were real. Each integration runner created and removed only its own migrated/seeded database. Historical regression screenshots were restored to their committed bytes.

## Remaining work

The [OFF-01 map](../../offline-workflows.md) retains multiple simultaneous review drafts, denial after prior uncertainty, failed-create/rejected-parent recovery, nested/reference decisions, same-record pending edits and queued custom-operation acceptance. The current single draft slot per resource does not establish independent retention of multiple active reviews. The ordinary conflict journeys here do not establish that a later permission denial proves an earlier uncertain request never committed. Those gaps must close before OFF-01 is complete. Full parity and the later UI-refinement goal remain open.
