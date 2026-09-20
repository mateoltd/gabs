# Invitation pagination and architecture review

Scope: **GOV-01**, **ORG-001** and **ORG-003**. This covers complete invitation browsing and search in the existing People interface. Broader employee administration, actual provider/platform acceptance and full parity remain open.

## Ownership and behavior

Checkpoint `9d2832e`, preserved by pushed tag `checkpoint/invitation-pages-architecture-2026-09-21`, saves the unfinished implementation before the requested Sol xhigh review. The delegate moved invitation schemas and derived types into `contracts/src/workspaces/invitations.ts`, retaining the public root exports. Parent review accepted this cohesive ownership and retained the existing responsibility-based package hierarchy. No package identifiers, styles or signed artifacts change.

GET invitations now returns `items`, `nextCursor`, matched `total`, `workspaceTotal` and nonexpired `pendingTotal`. This intentionally replaces the old latest-100 array in the undeployed product; repository callers and generated API contracts are updated. A page defaults to 20 items and is bounded at 100. Search is a case-insensitive literal email substring across the workspace, including records beyond the former cap. The server rejects invalid limits, cursors and oversized search strings.

Server governance owns the query, workspace lock, fresh permission check and counts. PostgreSQL compares `(created_at, id)` directly, preserving microseconds and stable ordering during tied timestamps. Newer insertions do not shift continuation pages. Counts are current per request, not a frozen cross-request snapshot; missing or foreign cursor anchors fail explicitly. Reads do not change invitation authority, seats or business state.

People uses the existing pagination controls and scoped query cache. Search resets page history; creating an invitation returns to the unfiltered first page so the accepted result is visible. Failed reads offer retry or first-page recovery and do not display a false empty workspace. Unknown transport failures use plain recovery instructions. Workspace totals and pending summaries come from the server rather than the visible page.

## Acceptance coverage

Four real PostgreSQL cases exercise 125 historical rows, tied microsecond timestamps, insertion between pages, complete traversal without duplicates, search beyond the old cap, literal wildcard characters, expiry-aware summaries, validation, workspace isolation and revoked authorization after a workspace-lock wait.

Shared web/native journeys browse seven pages, use keyboard activation, search and revoke the oldest invitation, verify global pending counts, create while filtered, recover a failed page read, check narrow overflow and run scoped Axe A/AA. Existing lost-reply creation/revocation journeys exercise the changed page response too. Native windows remain hidden/minimized and unfocused.

## Verification results

- **1,038 regression tests across 137 files passed**, including the new four pagination cases and all architecture boundary fixtures: `/tmp/gabs-invitation-page-regression.log`.
- Regenerated OpenAPI JSON and generated API declarations are byte-identical to the checkpoint after the contracts extraction: `/tmp/gabs-invitation-page-generated.log`.
- Final strict root/browser/Node/preload/worker, dependency and copy checks and **all four fresh builds passed**: `/tmp/gabs-invitation-page-final-build.log`. Existing bundle-size warnings remain.
- **Four final headless browser journeys passed**: invitation pages, invitation retries, member edits and role edits. `/tmp/gabs-invitation-page-final-web.log`.
- **Four final hidden/minimized native journeys passed**, covering the same flows with unfocused-window assertions: `/tmp/gabs-invitation-page-final-native.log`.
- All eight new captures were inspected, including the final plain read-error copy. Scoped accessibility, keyboard activation and narrow overflow checks pass. This is functional visual continuity, not final design approval.
- Source formatting and diff checks pass. Documentation links and all 29 original requirement IDs/106 tracker IDs are preserved. Isolated databases were removed and incidental historical captures restored.

Local development authentication, controlled network interruption and local PostgreSQL do not establish actual identity providers, hosted scale, signed releases, whole-product accessibility or final UI-polish approval.

## Captures

| Client  | Last page                     | Narrow search                       | Failed read                          | First page                      |
| ------- | ----------------------------- | ----------------------------------- | ------------------------------------ | ------------------------------- |
| Web     | [Last](web-last-page.png)     | [Search](web-search-narrow.png)     | [Recovery](web-read-failure.png)     | [First](web-first-page.png)     |
| Desktop | [Last](desktop-last-page.png) | [Search](desktop-search-narrow.png) | [Recovery](desktop-read-failure.png) | [First](desktop-first-page.png) |
