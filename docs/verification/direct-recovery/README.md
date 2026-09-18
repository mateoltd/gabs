# Direct editor and archive outcome recovery

18 September 2026. Scoped OFF-01 acceptance; full parity remains active.

## Behavior

Direct generated resource writes retain their exact request, original module version and retry identity after an ambiguous reply. A later permission denial or version conflict cannot release that identity. **Resolve outcome** uses the existing authoritative settlement protocol: an accepted receipt is checked against the original response contract, or the server permanently cancels the original key before the editor permits correction. Current server permissions remain mandatory.

An accepted edit closes only after successful validation and any required saved-draft cleanup. A cancelled update fetches the current record and opens explicit original/local/server comparison. Disjoint remote edits survive; overlapping fields require a choice. A definitive first-attempt version conflict opens the same comparison immediately. Cancelled creates retain their original record target and input. Archived records cannot be resubmitted as edits; their retained input can be exported. The archive toolbar distinguishes confirmed acceptance from confirmed cancellation, refreshes the live record, and keeps retries on the original resource permission even if another resource tab is selected.

The shared client settlement helper builds the exact versioned envelope and rejects wrong-key, malformed and invalid accepted results. Journal settlement retains its scoped lock, original signed contract verification and durable commit. Direct review metadata can omit a journal-entry identifier without pretending the direct request was queued. An unresolved attempt retains its original direct/journal mode even if offline preferences change.

## Acceptance evidence

| Check                               | Result                                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict checks and production builds | Root and four environment TypeScript checks, dependency/copy checks and all four bundles passed. `/tmp/gabs-direct-build-final.log`. Existing chunk-size warnings remain.                            |
| Full unit/PostgreSQL suite          | 420/420 tests passed across 78 files, including direct rejection/settlement and durable journal regressions. `/tmp/gabs-direct-full.log`.                                                            |
| Headless browser regressions        | 7/7 passed: direct recovery, authoritative journal settlement, current/legacy conflict review, two malformed-response journeys and uncertain journal delivery. `/tmp/gabs-direct-browser-final.log`. |
| Hidden native regressions           | 4/4 passed: direct recovery, journal settlement/restart, conflict review/restart and uncertain delivery/restart. `/tmp/gabs-direct-native-final.log`.                                                |
| Accessibility and visuals           | Confirmation has scoped Axe A/AA checks at 390 CSS pixels. Escape restores preserved editor input; Tab and Enter confirm with visible focus. Wide/narrow web and native captures inspected.          |

The shared real-interface journey deliberately leaves offline storage disabled. It exercises a committed create whose reply is lost, a retry denied by actual server permission checks, and accepted settlement without duplication. It also exercises an uncommitted update followed by a real concurrent conflict, authoritative cancellation, explicit comparison and a fresh accepted correction with the remote email preserved. A separate fresh conflict opens comparison without falsely claiming an uncertain outcome. Both committed and uncommitted archives receive later denial/conflict; settlement either confirms the archived record or fences the old request while preserving the live record. Late cancelled requests receive `ATTEMPT_CANCELLED` from the real API. PostgreSQL verifies exactly two create audits, five accepted update audits, two archive audits and two cancellation audits for the whole journey.

Transport interruption is controlled by the fixture; business execution, permission denial, conflict checks, receipts and audits use the real server/PostgreSQL. The first browser fixture revoked permission before clicking Retry, so the client correctly disabled the action. That run was stopped and its disposable database removed. The final fixture revokes permission after the retry leaves the interface and before the server receives it, reproducing the relevant race without bypassing UI restrictions.

Visual review caught stacked editor/confirmation dialogs. The final implementation temporarily hides the editor while preserving its state, leaving one active dialog. Both platform regression runs above verify the final source after that correction. Existing host components and styles are preserved; this is scoped continuity evidence, not final UI approval or whole-product accessibility conformance.

Captures: [web confirmation](web-confirmation.png), [web narrow confirmation](web-confirmation-narrow.png), [web narrow comparison](web-comparison-narrow.png), [native confirmation](native-confirmation.png), [native narrow confirmation](native-confirmation-narrow.png), [native narrow comparison](native-comparison-narrow.png).

## Limits and next work

Direct requests in this milestone are retained in the mounted editor's memory. Disabling offline storage does **not** silently enable persistence of corporate records. Direct-attempt recovery after process exit, profile removal or explicit sign-out is not established; those remain required OFF-03 work. Journal reload/native restart evidence belongs to the separate durable journal journeys. Cancelled-create collision handling, archived-record export and tab-change permission routing exist but are not independently accepted by the new direct journey.

OFF-01 remains active for independent simultaneous review drafts, failed-create collisions, same-record sequencing, nested/cross-module choices and durable custom-operation/archive policy coverage. Permanent revocation, received-relay recovery and release/provider/platform gates remain open. No release or deployment was performed. Browser tests were headless; Electron windows remained hidden/minimized and unfocused. Runners and builds were serialized against frozen product source; each integration run created and removed only its own database. Historical regression captures were restored to their committed bytes.
