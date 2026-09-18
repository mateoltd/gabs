# Corporate offline workflow acceptance

OFF-01 is active. Durable capture, dependency sequencing and conflict review must work together; this document keeps their acceptance boundaries explicit.

## Dependent creates

Generated queued resource forms keep client-generated record identifiers stable. The resource's exact verified schema determines references, including nested structures. Enqueueing records their prerequisite journal identifiers atomically with the request and retained response contract. Related work waits for accepted prerequisites; unrelated work continues after a definitive rejection. An uncertain reply retains the original retry identity. Newly unblocked dependents run in the same pass even when a reviewed prerequisite is newer than they are; each request is attempted at most once per pass, after current authorization checks.

Offline reference pickers include same-account/workspace pending creates and mark them **pending** or **needs review**. They remain separate from accepted server pages. Resource permission and the corporate lease are required. Cross-module pending choices also require a previously successful online lookup for that target; an undeclared or never-authorized target gains no offline choices. The authoritative server rechecks grants, record existence and business rules on submission.

Reviewed replacement of a rejected/conflicting request preserves its record target and existing prerequisites. The journal reconnects dependents atomically. Replacing uncertain work, reusing a retry identifier for different content, or introducing circular prerequisites fails without deleting the draft.

## Successive edits to one record

New queued resource writes wait for unresolved writes to the same scoped record. Request and dependency edges commit together; concurrent enqueues use the storage lock. A reviewed replacement retains its original place and reconnects later edits without creating a cycle. Distinct records remain independent. Existing input, retry identities and recorded server versions are preserved.

Each captured edit uses an actual downloaded server snapshot, not a provisional version. The server merges disjoint changes; overlapping changes require explicit review even when the preceding edit came from the same device. Pending rows expose a keyboard-accessible **View saved change** disclosure with original/saved field values and capture time. These values remain separate from accepted table rows.

[Same-record acceptance](verification/record-order/README.md) verifies offline capture, browser reload/native offline restart, uncertainty, overlapping conflict, explicit review, dependent continuation and unrelated progress with exact server state/audit assertions. [Legacy ordering recovery](verification/legacy-order/README.md) now repairs missing local same-record edges while preserving existing dependency paths and exact original calls. Unknown delivery requires explicit outcome resolution; known unsent work on that record waits, while unrelated records proceed. Repairs are durable before dispatch. Accepted receipts release work; cancellation retains rejected input for review. Previously committed effects are not retroactively reordered. Corrupt cycles, colliding-create same-record descendants and arbitrary commands retain separate required gates.

## Failed-create collisions

A conflicting create can be reviewed as a separate record after an explicit server outcome check. A confirmed cancellation fences the old request; the parent and eligible unsubmitted resource dependents then receive fresh request keys in one local transaction. The parent receives a fresh record ID and declared links follow it. Existing corporate records, original request bodies, child base snapshots and unrelated work remain intact. Lost settlement replies can be recovered after reload or process restart. An accepted original receipt never creates a second record.

The client preserves input and blocks graph replacement if a child may have been submitted, a dependency is cyclic, a saved draft is ambiguous, or affected permissions are unavailable. Unsent ordinary drafts, same-record edits and custom commands are not silently rewritten. See [journaled collision evidence](verification/create-collisions/README.md) and [direct online/no-cache collision evidence](verification/direct-create-collisions/README.md).

## Conflict comparison

Generated updates retain the original values with the queued request. Review compares them with the attempted edit and a freshly fetched server record. Disjoint server changes remain in the proposed result; each overlapping top-level field needs an explicit local/server choice before the form or save action is enabled. Objects and arrays are reviewed as complete fields, matching the server's merge granularity. Older queued updates without original values require explicit choices for all differing fields.

Review choices, the compared server version and subsequent form edits are saved independently for each reviewed request. Queued and direct reviews use distinct slots; submitting one consumes only that review, preserving other reviews and the ordinary draft. Legacy shared slots are promoted without overwriting an existing review. Resume uses that labeled server snapshot; saving always revalidates against current server state. [Independent review acceptance](verification/review-drafts/README.md) covers two queued and two online-only comparisons across browser reload/native restart and offline resumption with caching enabled. A later overlapping server edit creates another visible conflict. The editor permits a new reviewed request for journal entries marked rejected/conflicting, preserves the record target and atomically replaces the prior entry. Denial after earlier uncertainty keeps the original entry pending, as described below.

[Structured comparison acceptance](verification/structured-conflicts/README.md) now verifies whole-field choices for nested objects, arrays, keyed tuples, union branches and removal, including partly completed choices through browser reload/native restart and offline resumption. Comparisons use the same schema-scoped label resolution as tables. Actual target-read revocation hides and removes downloaded labels without losing choices; restored authority reacquires labels. Late disjoint server edits are preserved. [Cross-module capture acceptance](verification/cross-capture/README.md) separately verifies nested references under explicit grants, real revocation/regrant, restart, lost replies and collision remapping.

## Uncertain delivery

The journal durably records dispatch before invoking transport. Failure to persist dispatch prevents submission; a crash after submission leaves the original identity marked uncertain. Transport errors, timeouts, malformed acknowledgements and later denials cannot turn that uncertainty into a confirmed rejection. Legacy pending entries without delivery metadata also remain conservative: the old attempt counter did not record lost replies, so even zero attempts cannot establish non-delivery.

New, provably unsubmitted requests can still receive ordinary first-attempt rejection/conflict outcomes. An uncertain request and its dependents stay pending while unrelated authorized work proceeds after a permission denial. Current permissions remain mandatory. Once restored, retry uses the same key and original response contract to recover the committed receipt, without creating another record or audit event. Browser reload and protected desktop process restart have [scoped acceptance](verification/journal-delivery/README.md).

### Authoritative settlement

Generated resource journals expose an explicit **Resolve outcome** action. The server locks the original account/workspace/retry key, rechecks current authority after waiting, and compares the exact operation and original versioned input fingerprint. An existing accepted receipt is returned; otherwise the same transaction writes a permanent cancellation and its audit. Every later execution using that key is blocked. A missing receipt alone never authorizes a correction.

The client verifies the returned identity and, for acceptance, the original signed response contract before changing local state. Lost or malformed settlement replies leave the request uncertain and can be retried after restart. Confirmed cancellations retain their input as rejected work; ordinary review creates a fresh, validated request and atomically reconnects its dependents. Resolving also resumes unrelated synchronization immediately. See [settlement evidence](verification/attempt-settlement/README.md).

Migration 029 preserves historical accepted receipts and adds explicit outcome metadata. Executable server rollback must retain cancellation-aware receipt handling; a server predating this protocol is not an accepted rollback target once cancellation rows exist. Hosted rollout/rollback acceptance remains part of release readiness.

### Direct online attempts

Generated direct editors and archive controls now use the same verified settlement contract. They retain the original key and execution mode through later denial or conflict, recover accepted receipts, and allow correction only after confirmed cancellation. Cancelled updates and definitive first-attempt conflicts show explicit comparison with the current server record. The [direct acceptance journey](verification/direct-recovery/README.md) verifies duplicate-safe creates, update correction and both archive outcomes in headless web and hidden Electron.

[Direct-create collision acceptance](verification/direct-create-collisions/README.md) now covers definitive collisions, cancellation after uncertain delivery, lost settlement/replacement replies and repeated replacement collisions. The editor keeps each failed original until authoritative outcome recovery; an explicitly approved separate record uses a fresh identity/key and remains direct until accepted. A lost replacement reply keeps that replacement uncertain instead of permitting another identity change. Existing records and retry audit counts are verified in web and hidden Electron.

With offline storage disabled, direct pending input remains in the mounted editor's memory. Disconnection hides the corporate surface; reconnecting and reauthorizing restores that in-memory input without writing drafts or journal entries. This milestone does not silently persist corporate data or establish direct process-exit/sign-out/profile recovery. Permanent revocation, received relay recovery controls and durable arbitrary custom-operation journals retain their separate gates. The server supports settlement of declared corporate commands, but these generated client journeys establish resource recovery only.

### Archived input and archive preflight

[Archived-input acceptance](verification/archived-input/README.md) now covers queued and direct edits whose target was archived. Review keeps the original input, module version and captured base version, offers a read-only export and never writes the archived record. Cached reviews survive offline browser reload/native restart. Uncertain update exports retain the exact original request and base snapshot. A new archive checks known unresolved local edits first; current server validation still decides business effects. Archive recovery checks the original resource's permissions even after changing tabs.

[Scoped recovery-export acceptance](verification/recovery-export/README.md) now verifies native account/workspace/module binding, current read and dependency authority before and after delayed dialogs, denial of unscoped writes and renderer-forged policy, protected offline restart, expiry and logout. Browser export verifies current identity/policy, persists received denial, cancels stale views and checks retained offline policy. Neither path turns exported input into an accepted business change. Broader profile/sign-out recovery remains OFF-03.

## Remaining OFF-01 work

- Scoped recovery-export authority now has separate browser/native acceptance. Preserve direct restart/sign-out/profile recovery under OFF-03; exporting input alone does not satisfy those journeys. Permanently revoked access and received relay recovery controls retain separate acceptance.
- Nested/reference-field comparisons and journaled/direct failed-create collisions now have scoped browser/native recovery evidence. Ambiguous drafts, same-record descendants of colliding creates and custom descendants retain separate required work.
- Nested cross-module capture and rejected-parent continuation now have scoped [browser/native acceptance](verification/cross-capture/README.md), including explicit grants, revocation/regrant, lost replies, collision remapping and unrelated progress. Ambiguous drafts, same-record descendants of colliding creates and custom descendants remain separate gates.
- New same-record queued edits now have scoped ordering and saved-input inspection acceptance. Archive preflight and archived-input recovery now have separate scoped acceptance. Legacy same-record journals now have separate [browser/native recovery evidence](verification/legacy-order/README.md), including an original committed request whose receipt is recovered without resending. Arbitrary command journals and destructive cycle repair are not established by that acceptance.
- Align retry-key validation across desktop submissions and relay receipt lookups with server-accepted formats; those older paths still use narrower character rules than execution and the new settlement endpoint.
- Re-audit durable queued custom operations, archive behavior and recovery controls against operation policies; retain missing implementation in the tracker rather than treating generated CRUD coverage as full SDK coverage.

Broader working-set management is OFF-02. Explicit sign-out/profile-removal recovery is OFF-03. Personal-to-company import is OFF-04. These required gates are not completed by a browser reload or a desktop process restart.
