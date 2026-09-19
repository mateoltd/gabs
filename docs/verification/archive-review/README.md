# Explicit archive review

Status: OFF-01-ARCHIVE scoped local acceptance verified. Full OFF-01 and parity remain open.

A failed queued archive previously used the generated create/update review handler and opened an empty **New record** form. The real browser baseline reproduced that behavior against the previous built client: `/tmp/gabs-archive-before.log`. The original archive input remains unchanged; this was a review-flow defect, not an accepted business effect.

The new review shows original target/version and a fresh server snapshot. Confirmation settles the original identity first. Accepted originals recover their verified receipt; cancelled originals permit a new durable archive using the explicitly reviewed version. Interrupted replacement preserves the cancellation and original request. Current read/write access and exact installed release are checked before and after settlement and in the final enqueue transaction. Uncertain requests and submitted direct dependents cannot be replaced here.

## Final verification, 19 September 2026

Checkpoint `222ac15` preserves the implementation before the requested Sol xhigh architecture review. The checkpoint is a recovery snapshot, not acceptance.

- Final production source passed strict root/browser/Node/preload/worker checks, dependency/copy enforcement and four fresh builds: `/tmp/gabs-archive-acceptance-build.log`.
- The final post-review `pnpm build` also passed fresh strict/boundary checks and reused the four valid Turbo build artifacts: `/tmp/gabs-archive-architecture-final-build.log`. Changed-source formatting, diff checks, documentation links, all 29 original requirement IDs and tracker dependencies passed.
- All 575 unit/PostgreSQL tests across 89 files passed, including the eight new archive recovery cases and nine architecture fixtures: `/tmp/gabs-archive-regression.log`.
- Eight headless browser journeys passed: `/tmp/gabs-archive-web-reviewed.log`. The preceding run passed six and exposed a fixture selector that matched several independently published modules with the same display name. The corrected selector also requires the exact published version; no acceptance criterion was relaxed.
- Eight hidden/minimized, unfocused Electron journeys passed: `/tmp/gabs-archive-native-reviewed.log`. Both platforms cover the two archive-review cases, command-to-create/update/archive continuation, accepted/cancelled submitted archives and resource recovery after uninstall.
- Scoped Axe and overflow assertions passed. All twelve final captures in this directory were inspected: review and already-archived states at wide/narrow widths, revoked access at narrow width and the accepted archive list. The current record is expanded by default in this confirmation; existing `ResourceValue` callers retain their previous behavior. This is scoped functional presentation acceptance, not approval of the entire UI or full accessibility conformance.

The journeys use actual SDK capture, signed releases, server updates and permission changes. They preserve the original archive through offline reload/process restart, a held settlement response during write revocation and a lost settlement reply. A successful reviewed replacement uses the current version, leaves the unselected sibling untouched, and produces exactly one archive effect and audit entry. An already-archived target offers explicit original-outcome resolution without creating another archive.

Existing presentation components are reused without style changes. This does not implement archive target reassignment after failed-create collisions, nor complete other legacy/profile/release gates.


Subsequent [archive collision target acceptance](../collision-archives/README.md) separately implements explicit target reassignment for never-submitted descendants. Its verification and remaining boundaries are recorded there.
