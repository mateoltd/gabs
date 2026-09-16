# Connected suspension and offline lease acceptance

16 September 2026. EXT-05 continuation.

## Implementation

Workspace governance changes increment a tenant-scoped policy revision in the same PostgreSQL transaction. Changes to module activation, assignments, entitlements, membership, roles, organization settings and workspace policy wake connected API readers. Long polling uses the ordinary typed client and protected Electron IPC. Each API instance keeps one database listener and bounds pending readers; waits release transactions and end after 15 seconds even if a notification was missed.

Readers subscribe before inspecting the durable revision, and the server checks authentication and current authorization again before completing a wait. Revision and bootstrap reads share a policy lock. Migration 022 backfills existing workspaces and seeds new revisions in the workspace-creation transaction, ensuring a lockable row exists even before the first membership or policy change. Notifications carry only the workspace identifier; they are a signal to read current state, never a grant. Rollbacks produce neither a committed revision nor an update. This follows PostgreSQL's documented [transactional notification behavior](https://www.postgresql.org/docs/current/sql-notify.html) and [LISTEN setup ordering](https://www.postgresql.org/docs/current/sql-listen.html).

Clients compare decimal revisions without JavaScript number truncation. A delayed older reply cannot restore earlier permissions or a longer lease. A fresh check is required before reconnection resumes synchronization. Policy delivery continues while installation queries refresh, so a slow download cannot delay the next suspension. Failed delivery retries with bounded delay; a fresh revision catches changes missed while disconnected. The existing periodic bootstrap refresh remains a fallback.

The module gate hides paused content immediately after receiving policy, including dialogs and other UI-kit portals. React [Activity](https://react.dev/reference/react/Activity) retains the mounted editor's state while cleaning up effects. Portals stay inside the preserved surface so they cannot remain visible outside the hidden ancestor. Restoring access restores the open editor. These are live-session guarantees: navigating away, closing the application or removing a profile still depends on durable draft/journal recovery. Arbitrary custom code is reviewed application code, not a hostile-code sandbox.

A disconnected device retains its previously authorized working set until its lease expires. Expiry hides corporate content and the open editor, while preserving durable queued work. Reconnection to a still-suspended module does not flush that work; reauthorization permits normal server validation and synchronization. Snapshot writes are serialized, and received revocation updates the in-memory lease before asynchronous persistence. No claim is made that suspension erases a disconnected device or overrides its existing lease remotely.

## Regression corrections

Preserving surfaces adds a structural wrapper. Orders layout and motion selectors explicitly cross that wrapper so the inspector, table and pagination retain their existing geometry. The broad UI run caught this before acceptance.

Fast successive archetype choices exposed concurrent saves with the same setting version. The selector now skips its current value and remains disabled until the save and refresh finish. Contrast thresholds are unchanged.

An earlier remote run failed the pagination motion test on a 0.00003 CSS-pixel difference. Its geometry assertion now allows only rounding below 0.005 pixels; retained-row, viewport, opacity, accessibility and paging assertions remain intact.

A subsequent full run exposed an installation check retaining its older policy closure after reauthorization. Installation query keys now include the durable policy revision. Delayed checks cannot overwrite the restored revision's result. Cache completion handlers also discard results from an earlier policy epoch. A disk snapshot that finishes loading after a fresh policy response receives that newer policy and lease before use. Neither an older asynchronous write nor a delayed startup read can restore a prior in-memory lease.

## Verification

All 88 unit/PostgreSQL tests passed, including committed notification delivery across connections, rollback, cross-workspace isolation, missed revisions, membership revocation, logout during a pending watch, ordinary bootstrap revisions, existing-workspace backfill, revision seeding before memberships and stale-response/lease ordering. After the final cache-ordering refinement, all three focused policy tests passed again, along with strict types, boundaries, copy checks and four production builds.

The first full headless browser selection passed 65/67, revealing the two UI issues described above. The connected-suspension journey passed: a separate administrator suspends an open Contacts editor, dependent navigation disappears, restoration recovers its input, offline capture remains available during its lease, expiry locks the view, pending work survives and restoration synchronizes it. Server permissions are never inferred from the retained editor.

The next complete browser run passed 66/67 and exposed the stale installation check described above. After its correction, the suspension journey passed three consecutive runs with a deliberately delayed pre-restoration response, and all eight affected activation, update, custom-state and receipt-recovery journeys passed. After the final cache-ordering refinement, all six selected suspension, offline reload/reconnect, draft identity, workspace-switching and failed-storage journeys passed. The delayed-response test initially queried navigation that the restored modal correctly hid from the accessibility tree; its intermediate DOM assertion now accounts for that, while the visible editor and retained input assertions remain unchanged. This is 67 distinct browser journeys passing across iterations, not a fresh all-67 pass after the last fix.

All 12 real Electron journeys passed on the final application build. The new journey verifies connected suspension, retained editor input, offline capture, lease expiry, protected native cache retention, blocked synchronization while suspended and acceptance after restored authorization. It also rejects an invalid policy revision through IPC. Every native window remained hidden or minimized and unfocused; no Dock windows were opened. This verifies the local macOS Electron runtime, not signed installed acceptance on all target operating systems.

Inspected [paused connected view](connected.png), [narrow layout](narrow.png), [expired lease](expired.png), [recovered work](recovered.png), [native restored editor](native-restored.png) and [native expired lease](native-expired.png). The corrected Orders light layout was also inspected. The paused browser view had zero detected Axe WCAG A/AA violations. These checks preserve the engineering baseline; they do not establish final UI polish or whole-product accessibility.

## Scope still open outside this milestone

Durable custom-operation recovery, profile removal/revocation recovery, complete working-set selection, web push, hosted operations and signed installed-runtime acceptance across all target operating systems remain separate tracker items. The later UI-refinement goal has not started.
