# Organization classification filters

Scope: **GOV-01** and **ORG-003**. This record covers group/tag search and live chart highlighting; broader employee/group administration, large organizations and provider/platform acceptance remain open.

## Behavior and ownership

The shared UI kit owns `SearchSelect`, a typed finite-choice control. Organization-specific labels, selection and membership interpretation remain in the shell's administration feature. The server policy and SDK schemas are unchanged. Group and tag identities are namespaced so equal identifiers and names remain distinct choices.

Choosing a classification highlights its roles in the chart and minimap without hiding other roles or changing reporting relationships. A count, visible marker and accessible description supplement color. Membership and name edits update the preview immediately; only Save organization submits policy changes. Removing the selected tag clears the highlight. The Role tags editor uses the same searchable control.

## Review checkpoint

Checkpoint `f100f92`, preserved by `checkpoint/classification-architecture-2026-09-20`, saves the unfinished implementation before the requested Sol xhigh review. It includes a partial capture and known failed popup accessibility check; it is not acceptance evidence. The existing physical hierarchy remains `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and outer `composition`. Public package names remain stable contracts.

The delegate corrected the popup accessibility failure using the installed library's supported nonmodal composition: an external trigger and a search input inside the popup. No dependency patch, suppressed accessibility rule or custom focus trap was added. Parent review required explicit Escape/Tab and live-label checks, reliable native cleanup, and removal of empty live-region padding while leaving the announcement region mounted.

## Final verification

Verified locally on 20 September 2026:

- **26 focused tests across four files** passed: architecture boundaries, SDK role tags, PostgreSQL tag admission and module policies. Log: `/tmp/gabs-classification-review-tests.log`.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and **four fresh build targets** passed after the final CSS correction. Log: `/tmp/gabs-classification-reviewed-build.log`. Existing bundle-size warnings remain.
- **Two final headless browser and two hidden/minimized native journeys** passed: classification and the existing role-tag policy journey on each client. Logs: `/tmp/gabs-classification-reviewed-web.log` and `/tmp/gabs-classification-reviewed-native.log`. All disposable databases were removed. Native assertions verify no window is focused and every window is hidden or minimized.
- The two existing browser controls journeys also passed with the new control composition, before the final search-popup spacing-only change. Log: `/tmp/gabs-classification-final-web.log`.
- The classification journey covers equal group/tag identifiers and names, distinct highlights, zero-match membership, unknown search text, Enter selection, Escape focus return, Tab exit, clearing, live draft membership and name edits, explicit save, removal and reload. Filtering leaves the server policy and Save organization state unchanged; saved edits preserve the hierarchy exactly.
- Whole-page Axe WCAG A/AA assertions pass while the classification popup is open, along with scoped tag-editor accessibility and narrow overflow checks. These checks do not establish whole-product accessibility conformance.
- All **eight** wide/narrow captures below were inspected. Tag-editor captures were copied from the final regression runs; historical role-tag captures were restored. Scoped formatting, whitespace and documentation checks passed.

The checkpoint's external-input combobox failed `aria-hidden-focus`; the corrected supported popup composition passes without exemptions. Earlier object-valued search reset failures and a stale preview run are not final acceptance evidence. Native journeys use development authentication; actual identity providers, signed target platforms and physical durability are outside this slice. GOV-01 remains active. The current UI is not approved as polished and the separate UI-refinement goal has not started.

## Inspected captures

| Client | Chart | Search popup, narrow | Tag editor | Tag editor, narrow |
| --- | --- | --- | --- | --- |
| Web | [Chart](web-chart.png) | [Search](web-autocomplete-narrow.png) | [Editor](web-tags-top.png) | [Editor](web-tags-narrow-top.png) |
| Desktop | [Chart](desktop-chart.png) | [Search](desktop-autocomplete-narrow.png) | [Editor](desktop-tags-top.png) | [Editor](desktop-tags-narrow-top.png) |
