# Member access concurrency and retry recovery

Scope: **GOV-01**, **ORG-003**, with supporting **PERM-001** authority evidence. This covers stale member edits and uncertain replies. Broader employee administration, combined organization scale and provider/platform acceptance remain open.

## Behavior and ownership

`MemberEditSchema` is the canonical request contract. Member reads include an opaque revision over workspace/member identity, active status, sorted role IDs and sorted direct module assignments. The revision describes editable state; it is neither an authorization token nor a monotonic event counter. Changes through other assignment writers invalidate it without a schema migration. Returning to identical editable state returns the same revision. Inherited policy and role definitions retain independent current-server validation.

Reads and edits use the shared workspace lock and fresh authorization. A stale edit returns `MEMBER_CHANGED` before mutation. Accepted member PATCH requests require an idempotency key; the effect, audit and receipt commit together. An unchanged retry returns the original result without overwriting later access or duplicating audit. The host API now requires both revision and retry key; all repository callers and generated API declarations are updated. Older unversioned calls fail validation.

The People editor retains unsaved choices on conflict. Explicit Reload current access replaces those choices with current state and returns keyboard focus to the first role. Inputs are disabled while saving; a failed unchanged attempt retains its key. The accepted-reply-loss test passes through a real committed server response before dropping it, then verifies the same key is retried and the audit remains singular. It does not substitute a fake success response.

Member reading, editing and the private revision calculation live together in `server/governance/members.ts`. Contracts own schemas, API owns transport orchestration, server governance owns authority and mutations, and the shell owns draft/retry presentation. Existing UI components and styles remain in use. The [architecture review](../architecture/README.md#member-access-checkpoint-review-21-september-2026) records the requested checkpoint, Sol xhigh delegation and parent review.

## Verification

The initial concurrency reproduction accepted both competing writes; `/tmp/gabs-member-edits-before.log` records the failing-before result. The checkpoint regression then passed **1,022 tests** across 134 files. Parent review additionally reproduced accepted replay bypassing the workspace lock in `/tmp/gabs-member-replay-before.log`; the final correction passes both workspace-wait and receipt-wait revocation cases without duplicate audit.

Product acceptance exercises a real competing API edit against an open UI draft, explicit reload, accepted correction, actual lost reply, same-key retry, audit counts and persisted state after reload. True simultaneous competing writes are covered by PostgreSQL integration tests. The UI case does not claim two separate browser sessions.

The affected browser suite passed **22 cases**, comprising 21 headless browser cases and one hidden/minimized desktop restoration case: `/tmp/gabs-member-architecture-web.log`. Coverage includes module policies/releases, all platform journeys, profile authority, offline policy and corporate restoration revocation. Three hidden/minimized native administration cases passed: `/tmp/gabs-member-architecture-native.log`. These runs precede the final server extraction/replay correction.

Scoped Axe A/AA, narrow-overflow and keyboard-focus assertions passed. All six member-editor captures were inspected. Native assertions verify unfocused, hidden or minimized windows. Incidental historical screenshots were restored. These local development-authentication checks do not establish actual identity/OS providers, signed releases, whole-product accessibility, final UI approval or full parity.

## Final review verification

Verified locally on 21 September 2026:

- **20 focused checks** passed: six member-access integration tests and 14 architecture checks. `/tmp/gabs-member-architecture-focused.log`.
- **1,023 regression tests across 134 files** passed on the final source. `/tmp/gabs-member-architecture-regression.log`.
- Strict root/browser/Node/preload/worker checks, dependency/copy checks and **all four fresh build targets** passed. `/tmp/gabs-member-architecture-build.log`. Existing bundle-size warnings remain.
- Scope includes true concurrent writes, stale direct grants, stable ordering, exact replay after a later edit, changed-input key reuse, required key/revision, foreign scope, last-owner protection, and fresh authority after GET/PATCH/replay waits. Revocation fixtures use real PostgreSQL lock waits and controlled privileged membership changes; they do not establish an end-user ability to remove the final administrator.
- **Three final headless browser and three final hidden/minimized native journeys** passed after the extraction/replay correction: member editing, module policies and policy releases. Logs: `/tmp/gabs-member-architecture-final-web.log` and `/tmp/gabs-member-architecture-final-native.log`. Final captures were inspected or matched the inspected images byte for byte.
- Source formatting, whitespace and documentation links pass. The ledger retains 29 original requirements and the tracker 106 stable IDs. Test databases were removed and incidental historical captures restored. No additional business schema migration or UI style change is introduced by the architecture review.

## Inspected captures

| Client | Conflict | Narrow conflict | Accepted access |
| --- | --- | --- | --- |
| Web | [Wide](web-conflict.png) | [Narrow](web-conflict-narrow.png) | [Accepted](web-accepted.png) |
| Desktop | [Wide](desktop-conflict.png) | [Narrow](desktop-conflict-narrow.png) | [Accepted](desktop-accepted.png) |
