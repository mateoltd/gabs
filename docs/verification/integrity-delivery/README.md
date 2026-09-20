# Authenticated integrity observations

Scope: **ID-04**, company-scoped receipt, deduplication and operational visibility for desktop integrity events. These are authenticated client observations, not device attestation. Corporate permissions and business effects still require normal server authority.

## Ownership and behavior

- Public diagnostic schemas live in `packages/contracts/src/identity/integrity.ts`. The desktop integrity subsystem owns capture, retained local evidence and receipt delivery. Main composes authentication, profile locking and lifecycle hooks.
- A runtime incident captures its last confirmed company/account scope before lockdown clears identity. Historical/unattributed incidents remain local. After fresh sign-in, only the original account/company can deliver its captured events; local profile changes and obsolete requests cannot assign another owner.
- The journal retains original events. Successful receipts are written durably under an account/company/content hash. Missing, malformed or interrupted local acknowledgement causes an exact retry.
- The server rechecks current membership, binds the actor and commits each unique report with its audit entry. A changed payload under the same event identity is rejected. Reports are tenant-isolated and readable through `audit.read`.
- Explicit audit repair retains valid original events. Its synthetic recovery does not assert that a corrupted original incident recovered. Server summaries therefore may retain an unresolved original observation.
- The worker reads only cross-company aggregates through a restricted function. Client timestamps affect reported delay; never-received events cannot be measured. See the [operations procedure](../../operations.md#desktop-integrity-observations).

## Acceptance

- **45 focused tests passed** across architecture boundaries, PostgreSQL receipt handling, delivery, support, installation and runtime integrity: `/tmp/gabs-delivery-architecture-final-tests.log`. Real PostgreSQL checks include concurrent duplicate receipts, revoked membership, workspace isolation, bounded pagination, out-of-order reports, aggregate privileges and rollback of the report when its audit insert fails.
- The parent reproduced starvation after 50 rejected events before the fix: `/tmp/gabs-delivery-fairness-before.log`. A per-scope retry cursor now lets subsequent passes attempt later events while retaining exact retries and all original evidence. This scheduling cursor is process-local; restarting resets its position, while durable events and receipts remain intact.
- Frozen offline dependency installation, strict root/browser/Node/preload/worker checks, dependency/copy checks and **four fresh builds** passed: `/tmp/gabs-delivery-install.log` and `/tmp/gabs-delivery-architecture-build.log`. Existing bundle-size warnings remain.
- **Ten hidden/minimized native cases passed together** on the awake rerun: `/tmp/gabs-delivery-architecture-native-awake.log` (53.3 seconds). The support command sequence, three process-exit repair boundaries, offline/accepted/audit-repaired work, startup/runtime admission and lost diagnostic acknowledgement all pass. The lost-reply case terminates the actual process after server acceptance, then retries after fresh authentication with exactly one receipt and audit entry per original event.
- The original `/tmp/gabs-delivery-architecture-native.log` had six passes and four timeouts during repeated Mac sleep/dark-wake cycles with its lid closed. Its failures are superseded by the clean ten-case run, not waived or hidden. No timeout limit or product guard was relaxed.
- All recovery captures were inspected; scoped Axe and narrow overflow assertions passed. Historical regenerated capture differences were discarded. The new retained captures show the accepted request and separate draft after restart, plus both received events in Audit history. The screenshot fixture explicitly scrolls each event into the viewport; its final lost-reply rerun passed in `/tmp/gabs-delivery-audit-captures.log` after that capture-only adjustment. Final root TypeScript checks also passed (`/tmp/gabs-delivery-final-types.log`). All disposable databases were removed.

The requested architecture review is recorded [separately](../architecture/README.md#integrity-delivery-checkpoint-review-20-september-2026). No renderer or style changes were made.

| Evidence | Capture |
| --- | --- |
| Retained accepted request and separate draft | [Wide](recovered-accepted.png), [narrow](recovered-accepted-narrow.png) |
| Reported lockdown in Audit history | [Lockdown report](audit-locked.png) |
| Reported recovery in Audit history | [Recovery report](audit-recovered.png) |

Actual identity/OS providers, signed installed releases, physical durability, hosted monitoring destinations and foreground native support dialogs remain separate required gates. This slice does not establish full parity or approve UI quality.
