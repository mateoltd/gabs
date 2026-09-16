# Preserving open editors during module updates

16 September 2026. EXT-05 remains active; this closes specific live-editor loss paths. Subsequent [typed custom-state transfer acceptance](../custom-view-state/README.md) supersedes the custom checkpoint/restore gap described in this historical milestone.

## Generated forms

A generated view retains its React state across a verified package update within the same account, workspace and module. Open forms keep their input, resource, record ID, base version and any uncertain request identity. The new schema is applied without closing the dialog. A recovery section identifies the update, exposes the input from before it and exports that original input on request. This works without enabling persistent offline storage; the live state stays in memory.

Removed fields remain visible and require explicit removal from the edit before saving against the new schema. Their original values remain in the recoverable snapshot. If the selected resource disappears, the old editor remains available for recovery, new saves are disabled, and closing it returns to an available resource. Recovery JSON includes account/workspace, module release, resource and original record/base version. It distinguishes unsaved input from an unconfirmed request; the latter also retains the exact original request and idempotency key. Neither status establishes server acceptance or authorizes an import.

An uncertain request is retried with its original input and release. A newly required field does not prevent recovering that earlier receipt. Current server authorization and receipt hashing continue to apply. A failed background installation keeps the previously verified view mounted with a retry control; authentication and authorization errors still deny access.

## Custom views

The host keeps the running custom component and its input when a newer package arrives. It displays an update action and requires an explicit discard-and-update choice before remounting arbitrary custom code. Keeping the current view preserves its input; the server still rejects new old-version effects after a mandatory update. This is a safe fallback, not automatic transfer of a publisher's arbitrary React state. A typed checkpoint/restore contract for custom views remains work to complete.

## Evidence

`tests/e2e/module-editor-update.spec.ts` publishes independent signed releases and exercises:

- An existing record edited across a failed download, recovery, a required field addition and field removal while offline storage is disabled. The dialog and input survive; the exported file retains the original record/base version and removed value. The eventual save updates one existing record once.
- Removal of the edited resource. The input remains visible and exportable, saving is blocked and closing returns to the remaining resource.
- A real accepted update whose HTTP reply is dropped before a mandatory schema update. The retry recovers the original receipt despite a new required field, leaving one update and one audit entry.
- A separately built custom view with unsaved input. A new release is installed while the old component remains open; the server rejects an attempted old-version write. Keeping the old view preserves input; explicit discard loads the new view and its save succeeds.

The tests advance browser polling timers while using the real API, registry, installation storage and PostgreSQL. The generated recovery dialog has zero detected Axe WCAG A/AA violations. [Preserved input](preserved.png), [narrow dialog](narrow.png), [removed resource](removed-resource.png), [recovered uncertain request](uncertain-recovered.png) and [staged custom update](custom-staged.png) were inspected in the real rendered interface.

Local milestone checks passed: 76 unit/PostgreSQL tests with strict types and dependency/copy checks; 27 distinct selected browser journeys (26 rollout, lifecycle, executable-module and workflow regressions plus the focused stock-filter journey); all six Electron journeys; all four builds. After adding the recovery export schema and native file support, all three new browser journeys and all six Electron journeys were rerun successfully. The final neutral recovery-status wording was rebuilt and the three browser journeys rerun to refresh their visual evidence. Formatting and diff checks also passed. This is selected regression coverage, not a new full-browser or signed-release acceptance run.

The desktop export boundary accepts only the existing Orders CSV format or a bounded, schema-validated module recovery JSON document under a generated filename. The renderer cannot supply a filesystem path. The native bridge test selects a temporary destination instead of showing the OS picker, then verifies real IPC validation and file bytes; traversal, arbitrary filenames, malformed recovery documents and incomplete/mismatched pending requests are rejected. This does not establish manual OS-dialog or native live-editor handoff acceptance.

## Limits

These are live-view checks, not a promise of crash persistence when offline storage is disabled. Broader sign-out, profile removal, revoked-access and crash recovery remain OFF-03. Automatic typed custom-view state transfer, native mixed-version editing/transport interruption, fleet progress, partial-failure reporting and connected emergency suspension delivery remain EXT-05 work. Existing Electron regression journeys do not establish that new mixed-version native acceptance. The UI refinement goal remains queued after parity.

The preceding commit's remote run `35092809379` passed code/build and all three unsigned packaging jobs, with 60 of 61 browser journeys passing. Its stock-filter test read the previous rows before the result set settled; the captured failure snapshot already contains only low-stock rows. The test now waits for the real result region's `aria-busy=false` before applying its unchanged row assertions. Load and restore were skipped by that run, so OPS-07 remains open with the last measured remote read p95 of 637 ms.
