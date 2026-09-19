# Reviewed resource descendants and stable SDK retries

Status: OFF-01-DESC verified for the scope below on 19 September 2026. OFF-01 and full parity remain active.

## Correction

An approved continuation changes which parent must finish before a dependent can execute. The previous implementation also used that changed prerequisite list to validate repeats of the original SDK capture. A caller repeating the original key, input and dependency arguments was incorrectly rejected after approval.

Journal entries now distinguish immutable `captureDependencies` from current explicit `requestedDependencies` and the complete scheduling `dependencies`. Exact capture retries compare the original arguments. Explicit review may remap execution prerequisites without rewriting those arguments or the server request. A later correction of the child uses its current approved prerequisites, not the stopped original parent. New entries record both lists; a first reviewed continuation snapshots known older explicit metadata before changing it. An older client may already have remapped its only explicit list; the earliest caller arguments cannot then be reconstructed. That missing history is not invented or silently rewritten.

Development simulation retains the same metadata. Saved-work recovery files preserve the optional capture list alongside current prerequisites; original call, permissions, release verification, server settlement and authoritative business validation remain unchanged.

## Real client acceptance

Two independently signed SDK modules are installed. The parent command rejects. For both update and archive, the child module downloads real version-1 records and captures two dependent changes while offline using the public resource queue.

The review displays original target identities, update data/bases or archive versions. A selected child and unselected child survive offline restart. Child write permission is revoked while parent settlement is held: the original identities/review remain and no replacement is approved. After reauthorization, only the selected child continues. Its original target, base version, input and retry identity stay exact.

The selected target becomes version 2; the unselected target remains unchanged at version 1. Repeating the accepted HTTP request and the original public SDK capture leaves one selected update/archive audit. An independent corrected parent is recorded once. The existing command-to-create journey also repeats its original SDK capture after continuation and retains the complete subsequent update/archive lifecycle.

## Verification

- Baseline command and create/update/archive capture retries all failed after real recovery-kernel remapping: `/tmp/gabs-descendant-before.log` (4 failures, 12 passes).
- The initial correction passed 37 focused tests before the later legacy-metadata and second-correction cases: `/tmp/gabs-descendant-unit.log`.
- The first browser run passed command-to-create but interrupted the parent request by disconnecting too soon in the new update/archive setup. The harness now waits for definitive parent rejection before capturing child work; business criteria and retry behavior are unchanged.
- Both repaired update/archive browser journeys passed: `/tmp/gabs-descendant-web-repair.log`.
- Final strict root/browser/Node/preload/worker checks, package boundary/copy checks and four fresh builds passed: `/tmp/gabs-descendant-final-build.log`. The existing large-web-chunk warning remains.
- The full unit/PostgreSQL run passed 543 tests in 88 files; the remaining 20 integration tests did not execute because their setup hit a PostgreSQL connection timeout. The exact integration file then passed all 20 tests in an isolated database, without changing timeouts or restarting PostgreSQL. Thus all 563 distinct tests across 89 files passed across two runs, not one uninterrupted green run: `/tmp/gabs-descendant-regression.log` and `/tmp/gabs-descendant-integration-recheck.log`.
- Final headless Chromium: 5/5 journeys passed (command-to-create/update/archive and command/resource uninstalled recovery exports), `/tmp/gabs-descendant-web-acceptance.log`.
- Final hidden/minimized, unfocused Electron: the same 5/5 journeys passed, `/tmp/gabs-descendant-native-acceptance.log`. No foreground acceptance or signed-release claim is made.
- Scoped dialog Axe and overflow assertions passed in the journeys. Eight final captures were inspected: update wide review/actions narrow and archive wide review/revoked narrow, on both web and desktop. Long update reviews scroll within the dialog; action rows remain reachable at narrow widths, and unavailable selections retain their warning and disabled continuation. This is continuity evidence, not whole-product accessibility or final design approval.
- Parent source review checked retry identity, execution remapping, later child correction, optional export schema compatibility and bounded legacy fallback. Historical captures overwritten by regression were restored; the two new capture directories retain this milestone's evidence.

Captures are in [update continuation](../resource-update-continuation/) and [archive continuation](../resource-archive-continuation/). Production styles and layout are unchanged.

## Remaining scope

Current and known legacy unit cases verify capture metadata through command/create/update/archive continuation. Existing recovery tests preserve and exclude submitted/uncertain children from approval. Complete real-client submitted-child outcome recovery, remaining legacy/source-contract transitions, broader working sets, profile/sign-out recovery and release/provider gates remain required. This milestone does not close OFF-01 or full parity.
