# Custom commands after create collisions

OFF-01-COLLISION-COMMAND, 19 September 2026. Scoped acceptance verified; OFF-01 and full parity remain open.

## Problem and implementation

Never-submitted custom commands blocked the entire failed-create recovery graph. A real SDK/browser reproduction against the prior client confirmed the parent dialog remained open with “Linked custom work requires explicit review before changing this record identity.” The baseline log is `/tmp/gabs-collision-command-before.log`.

The client now retains each command's original call and capture identity, reconnects its execution prerequisites atomically with the replacement create, and holds the command as a conflict. Original SDK capture prerequisites remain immutable. Recovery metadata records the original and replacement record identities separately. Accepting the parent or restarting does not execute the command or rewrite its reference fields.

The existing command review displays that context and lets the user save an independent correction. Submission requires accepted prerequisites, a review saved against the current recovery context, both original/current permissions and authoritative settlement of the original command. Repeated parent collisions preserve the saved review but require its context to be reviewed again. Explicitly selected later command reviews keep waiting for their own confirmation. Resource/archive review rewiring preserves immutable capture prerequisites while updating execution prerequisites.

The generated resource view now exposes the existing Saved commands inbox in its heading actions. Its parent-collision path uses the shared verified command-continuation authorization service, including original/current operation grants, installed release/dependency verification and storage-transaction checks. Retired commands and missing authority do not gain execution access. No stylesheet changed.

## Verification

Focused storage/command/portable-export verification passed 111 cases across four files. The isolated full regression passed 592 tests across 89 files. The full run preceded the final query-refresh correction in the shell; client storage and server behavior were unchanged afterward. Final strict environment checks, boundary checks and four fresh builds passed. Acceptance covers nine distinct headless browser and nine hidden/minimized, unfocused Electron journeys. Five command cases per client passed on the final refresh implementation; the four archive cases passed before that query-only correction.

- `/tmp/gabs-collision-command-regression-isolated.log`: 592 tests, 89 files.
- `/tmp/gabs-collision-command-build-final.log`: strict checks and four fresh builds.
- `/tmp/gabs-collision-command-web-before-refresh.log` and `/tmp/gabs-collision-command-native-before-refresh.log`: six cases per client, including four archive regressions.
- `/tmp/gabs-collision-command-web-final.log` and `/tmp/gabs-collision-command-native-final.log`: both new destinations, cross-module command continuation and rejected-command correction, four cases per client on final source.
- `/tmp/gabs-collision-command-web-receipt.log` and `/tmp/gabs-collision-command-native-receipt.log`: late accepted-original recovery, one case per client on final source.

The initial browser runs also exposed the resource-only authorization callback and missing generated-view inbox launcher; both were fixed. A subsequent journey reached the correct business effect but queried the wrong audit action. The fixture now asserts three resource-create audits for the existing record, separate parent and single command effect, plus exact original cancellation and accepted retry outcomes. The final separate-target journey also revokes command access, restarts offline, restores access and resumes the retained review.

A full regression was mistakenly launched against the shared development database and stopped after integration failures. It is not acceptance evidence. `/tmp/gabs-collision-command-regression.log` retains that diagnostic run; the established disposable-database runner is used for final acceptance. No timeout or acceptance criterion was relaxed.

## Scope and remaining work

The real journeys cover both existing and separate targets, independently signed releases, offline capture/restart, provisional state, saved reviews, a lost settlement reply and duplicate-free server effects. Storage checks additionally cover repeated parent collisions, stale review context, revoked/uncertain/attempted/legacy children, command chains, archive prerequisites and portable recovery metadata.

Already-submitted collision descendants and additional legacy/source-contract transitions remain required, along with broader profile, working-set and release acceptance. These journeys do not establish every cross-module collision combination or whole-product accessibility. The later UI-refinement goal remains separate.

## Visible resource refresh

Visual review found that the accepted command receipt did not refresh the generated resource table: the database contained the effect, but the table still displayed only the two prior records. The added visible-row assertion reproduced this failure in `/tmp/gabs-collision-command-refresh-before.log`. Explicit command synchronization now invalidates the active workspace query cache after dispatch, matching background synchronization. Receipt recovery also refreshes queries. Final journeys require the effect row to appear without reloading after closing the inbox. This is distinct from backend duplicate-effect assertions.

## Visual and code review

All twelve final captures were inspected: offline wide/narrow reviews and the accepted table, for both destinations in both clients. Original and separate record IDs remain distinct, modal content fits, disabled offline submission remains visible, and the accepted table contains the new effect. Scoped dialog Axe and overflow checks passed. This is not a full-theme or assistive-technology sweep and does not approve the product's final design.

Review covered client-owned graph changes and server settlement, immutable capture prerequisites, repeated-collision context, original/current authorization, installed-release transaction checks, portable export schemas, generated-view reachability and query invalidation. Changed-source formatting and diff checks passed. Historical captures overwritten by regression journeys were restored; the twelve new milestone captures are retained.
