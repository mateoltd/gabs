# Native queued work across mandatory updates

16 September 2026. EXT-05 acceptance milestone on the local macOS arm64 Electron runtime. This extends, rather than replaces, the browser rollout and receipt-recovery evidence.

## Verified behavior

`tests/desktop/module-rollout.spec.ts` publishes two signed releases of an independent resource module. An isolated company is provisioned as a test fixture; this does not represent administration acceptance. The actual native UI installs version 1.0, explicitly enables protected offline storage and captures a queued record while disconnected. The stored journal identifies the account, workspace, original release, record and request key.

The two journeys then exercise different server outcomes:

1. **Request never accepted:** main-process transport fails before sending the create. A mandatory 1.1 policy is accepted by the real server. Electron closes and a new process opens the same profile; the original request survives unchanged. Once transport recovers, the server rejects the old release. The real UI shows a conflict. Explicit review uses the current form and a new request key while retaining the original record ID and supersession link. Exactly one record, one create audit entry and one receipt exist.
2. **Reply lost after acceptance:** main-process transport sends the request, reads the successful server response and drops it before IPC can report success. After the same policy change and complete process restart, the pending request retains its exact original key, input and 1.0 release. Retrying recovers the committed receipt without requiring a new edit. There is no superseding request and no duplicate record, audit entry or receipt.

Fault injection replaces only the main-process transport result. Renderer, preload, installer, journal, protected storage and server execution remain real. The test requires available OS-protected storage and does not silently skip that prerequisite. After restart, transport is initially blocked so persisted pending state can be inspected before delivery.

## Checks and visual evidence

Both native journeys passed, including a rerun after making transport completion waits explicit. TypeScript passed. The preceding implementation candidate passed 76 unit/PostgreSQL tests, 27 selected browser journeys, the other six distinct Electron journeys and all builds. These two tests bring the distinct local native acceptance journeys to eight; this test-only milestone does not introduce a new product bundle.

Inspected the actual Electron screens: [preserved conflict](preserved-conflict.png), [explicitly reviewed request](reviewed-request.png), [recovered original receipt](recovered-receipt.png). The tests verify the new release's form in the reopened native process, durable journal contents, actual request keys and authoritative database effects.

## Limits and remaining work

This proves an orderly full-process restart with a durable pending journal, not abrupt power loss, offline cold authentication, expired leases, profile removal or revoked-access recovery. Those broader recovery cases remain tracked. It does not establish signed installed-runtime acceptance on Windows or Linux, automatic transfer of arbitrary custom component state, or unsaved native editor handoff. Device-wide rollout progress, partial-failure reporting and connected suspension delivery remain EXT-05 work. Final UI refinement is still a separate later goal.
