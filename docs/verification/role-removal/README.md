# Role removal

Scope: GOV-02 / ORG-002, with supporting GOV-01, ORG-001, ORG-003 and permission guarantees. Scoped local product acceptance is recorded below. Broader assistive-technology and release acceptance remain open.

## Behavior and ownership

The typed `roleRemove` operation requires the reviewed role revision, organization version and a stable idempotency key. The server rechecks current authority under the workspace lock, including accepted receipt replays. Protected platform roles and the Administrador root cannot be removed. Members (including inactive members), live pending invitations and child reporting relationships must be explicitly reassigned or resolved first. Removal does not choose replacement access for people.

The transaction removes the rank and its group/tag references, retains other policy content, marks the role retired, and commits audit, outgoing event and receipt together. Changes to module-policy membership require module administration. There is no path for an older organization draft to restore retired ranks. Active role lists, grants, capability review, new invitations, member edits and upgrade reviews exclude retired identities. Historical invitations retain the role ID/name; names can be reused by a new role with a new identity.

The Organization dialog provides confirmation, actionable blockers, stale-review reload and exact-request retry after an uncertain response. Accepted removal followed by a failed view refresh remains an accepted removal, with a separate refresh action. Unsaved organization drafts must be saved or explicitly reloaded first. The existing host UI is retained.

## Migration and operation

Migration `033_role_retirement.sql` adds nullable retirement metadata, protects built-in roles, and scopes name uniqueness to active roles. It preserves historical foreign keys. Deploy the migration before the new server; enable removal only after all serving instances use the retirement-aware code. Do not roll back to an executable that treats retired roles as active after retirement has been used. Hosted rollout and recovery acceptance remain separate release gates.

## Verification

- Strict TypeScript across all five environments, boundary/copy checks, and four fresh application builds passed on final source.
- Five final headless browser journeys passed: role removal, role edits, invitation pages, organization diagnostics and the 500-role chart.
- Four final hidden/minimized native journeys passed: removal, role edits, invitation pages and diagnostics. The new native journey confirms no window becomes focused.
- All eight final removal captures were inspected. Scoped Axe A/AA checks, narrow overflow and keyboard focus restoration pass. No new visual system or placeholder was introduced.
- Full isolated unit/PostgreSQL regression: all 1,056 tests across 140 files passed on final source.
- Populated local upgrade: pending migrations 028–033 applied successfully. Before/after comparisons preserved 29,263 roles, 6,225 role assignments, 266 invitations and 4,677 platform settings, excluding only the added retirement field from the role comparison. The migration retired zero roles. This was a local development database, not production.

The first focused backend run passed 14 tests across removal, role edits, tags and policy invalidation. Two additional adversarial cases and a deterministic-order regression were then added. The first native batch passed three of four cases; its diagnostics failure identified the query-order dependency below. The final corrected batch passes all four.

The active-name index changed the order returned by an unordered role query. The existing native diagnostics test correctly rejected the changed tab order. Initial charts now use the injected product-preset order, with deterministic name/ID ordering for remaining roles. Saved organization ranks and positions are preserved. This correction keeps default chart order independent of database query plans.

Browser/native journeys cover blockers, stale role review, a real accepted-response loss, same-key retry, retained history, keyboard focus, narrow layouts and scoped Axe A/AA checks. Backend tests cover workspace isolation, protected roles, stale preconditions, assignment/invitation/child blockers, duplicate-free effects, old-chart resurrection attempts, module-policy authority and current authority after lock waits.

## Limits

This does not complete full parity, wider governance/provider acceptance, or the later UI refinement goal. Whole-product accessibility and actual assistive-technology acceptance remain tracked separately from scoped automated checks.


## Captures and reproducibility

| State | Web | Hidden desktop |
| --- | --- | --- |
| Blocked by a pending invitation | [Capture](web-blocked.png) | [Capture](desktop-blocked.png) |
| Stale review | [Capture](web-stale-narrow.png) | [Capture](desktop-stale-narrow.png) |
| Lost committed reply | [Capture](web-retry-narrow.png) | [Capture](desktop-retry-narrow.png) |
| Preserved invitation history | [Capture](web-history.png) | [Capture](desktop-history.png) |

The shared journey is `tests/support/role-removal-journey.ts`; authoritative integration checks are in `tests/integration/role-removal.test.ts`. Ephemeral local logs: `/tmp/gabs-role-removal-accepted-build.log`, `/tmp/gabs-role-removal-web-final.log`, `/tmp/gabs-role-removal-native-final.log`, `/tmp/gabs-role-removal-upgrade.log` and `/tmp/gabs-role-removal-regression.log`.
