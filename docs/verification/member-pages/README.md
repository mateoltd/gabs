# Member browsing, search and off-page recovery

Scope: **GOV-01**, **ORG-003**, **PERM-001/PERM-002**. This closes the unbounded People member read and client-only member search. Wider employee-administration acceptance, actual providers/platforms and full parity remain open.

## Contracts and ownership

Member and role contracts now live in `contracts/src/workspaces/members.ts` and `roles.ts`, with existing root exports preserved. The role wire shape and member edit preconditions are unchanged. GET members intentionally replaces the old array with a page in this undeployed product; generated API types and repository callers are updated.

A page contains `items`, `nextCursor`, matched `total`, `workspaceTotal`, `activeTotal` and active `roleCounts`. Default page size is 20, maximum 100. Literal case-insensitive search checks names, email addresses and assigned role names across the workspace. Role matches use an existence query, so multi-role membership does not duplicate rows. Counts remain workspace-wide when search or pagination is active.

Server governance owns the page, current permission check and workspace lock. Member role/module details are loaded only for returned membership IDs; shared policy resolution still supplies inherited-source explanations. Alphabetical ordering uses membership ID as a deterministic tiebreaker. Cursor anchors must belong to the workspace. This is live browsing, not a frozen multi-request export: profile renames, removals or role changes may change subsequent results. Restarting at the first page refreshes the view; no business decision is authorized by a cursor.

GET member by ID supplies the same canonical current detail after fresh authorization under the workspace lock. Stale-edit recovery uses this endpoint, independent of the visible page or search. Missing and foreign IDs return not found; unauthorized workspace access fails. Existing revision, idempotency and final-owner protections remain in force.

## User behavior

People reuses its existing pagination controls, scoped cache, table and search field. Search and tab changes reset page history; inactive tabs cannot send another list's cursor. Members, Invitations and Roles retain their existing layout. The Roles tab uses full-workspace counts, not the current member page. Deactivation refreshes the seat count and role totals.

Failed reads offer retry/first-page recovery and do not pretend the workspace is empty. When member usage cannot be read, seat usage is explicitly unavailable instead of reverting to an older bootstrap value. Unknown transport errors use plain recovery instructions. No styles or theme values change.

## Acceptance coverage

Four PostgreSQL cases cover 126 members, tied names, complete traversal without duplicate rows, bounded pages, global summaries, name/email/role search, literal wildcard characters, empty matches, off-page details, invalid bounds/cursors, foreign IDs and workspace isolation. Both list and detail reads are tested while waiting behind a revocation transaction.

The shared web/native journey browses seven pages, changes tabs, searches an off-page member, performs a real concurrent edit, reloads current detail, deactivates that member and verifies global role/seat counts. It also exercises failed-read recovery, keyboard activation, narrow overflow and scoped Axe A/AA. Native acceptance asserts hidden/minimized, unfocused windows.

Initial focused integration failures came from the bulk fixture treating a UUID as text; an explicit cast fixes the fixture. The first browser suite exposed two older response mocks missing the required actor header. The member-save fixture now passes through to the real API; the audit display fixture takes the actor from the authenticated identity. Production identity checks are unchanged. Visual review caught the stale bootstrap seat-count fallback after a failed page read. The added assertion also caught retained query data after an error; explicit error-state gating now suppresses both sources of obsolete counts.

## Verification

- **17 focused integration tests passed** across member pagination/edits and module-policy persistence/releases: `/tmp/gabs-member-page-focused2.log`.
- The first full run passed 1,038 tests; the four new cases could not start after a PostgreSQL connection-acquisition timeout. Its setup cleanup was hardened; the final rerun passed all cases. `/tmp/gabs-member-page-regression.log`.
- The broader product run passed **28 of 29 cases** before the last seat-count error-state correction. The failing case was the new assertion described above; all policy, profile-authority, offline-revocation, platform and web/native promotion-recovery cases passed. `/tmp/gabs-member-page-final-web.log`.
- **All 1,042 regression tests across 138 files passed on the final source**: `/tmp/gabs-member-page-regression-final.log`. The isolated database was removed after completion.
- Final strict root/browser/Node/preload/worker checks, dependency/copy checks and **all four fresh builds passed**: `/tmp/gabs-member-page-accepted-build.log`.
- **Seven final headless browser cases passed**, including member/invitation pages, stale member edits, theme/geometry/accessibility checks, protected-role/invitation interactions and audit rendering: `/tmp/gabs-member-page-accepted-web.log`.
- **Six final hidden/minimized native cases passed**: member pages/edits, invitation pages, role edits, module policies and reviewed release changes. `/tmp/gabs-member-page-native.log`.
- All **eight new captures** were inspected. Scoped Axe, keyboard activation, narrow overflow and native hidden/unfocused assertions pass. Incidental historical captures were restored. This preserves functional visual continuity; it is not final UI approval.
- Generated API comparison confirms only the member list and member detail path changed; role wire contracts and member-edit contracts remain unchanged. Source formatting and documentation links are checked; all 29 original requirements and 106 tracker IDs are retained. These local PostgreSQL and development-authentication checks do not establish hosted performance, actual identity providers, signed-platform acceptance, whole-product accessibility or final UI-polish approval.

## Captures

| Client  | Last page                     | Narrow member                       | Read recovery                        | First page                      |
| ------- | ----------------------------- | ----------------------------------- | ------------------------------------ | ------------------------------- |
| Web     | [Last](web-last-page.png)     | [Member](web-search-narrow.png)     | [Recovery](web-read-failure.png)     | [First](web-first-page.png)     |
| Desktop | [Last](desktop-last-page.png) | [Member](desktop-search-narrow.png) | [Recovery](desktop-read-failure.png) | [First](desktop-first-page.png) |
