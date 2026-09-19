# Received release policy through offline restart

19 September 2026. **OFF-02-LEASES-RELEASE**, within active **OFF-02-LEASES**. Original mappings: **CORE-002, CORE-003, SHELL-001, UI-004**. Browser acceptance passes; protected native acceptance remains required.

## Correction

Workspace snapshots previously retained assignment and entitlement but not the explicit versions accepted by a received rollout. A device that learned of a mandatory update could fail to download it and reopen the old signed release after an offline restart.

Bootstrap now includes accepted version sets for configured pins and rollouts. Empty pins resolve to the current release. Mandatory policy accepts only the selected version; optional policy also includes the explicitly approved older versions. The existing scoped policy revision, freshness comparison and lease persist these restrictions and reject delayed older policy. Older snapshots without this additive field retain their existing bounded lease until fresh authorization supplies it.

The installation gate verifies the entire installed dependency closure against the received policy, including when offline. Current policy also suppresses stale successful query data while replacement verification runs. Original pending calls and their contracts remain intact for server receipt/conflict recovery after the current release becomes available. The native capability authority independently checks the requested module version against its server-observed policy.

Temporarily hiding a custom view exposed a related input-loss bug: React Activity restarts effects on resume, causing the loader to create a different component type. The view now retains its verified component, keyed by digest and public key, through suspension. Unsaved publisher React state survives; replacement remains an explicit reviewed action. No stylesheet changed.

## Verification

- `/tmp/gabs-release-policy-regression.log`: **667 tests across 98 files** pass against an isolated PostgreSQL database, subsequently removed. This includes the final server bootstrap and native-authority assertions.
- `/tmp/gabs-release-policy-build-reviewed.log`: strict root/browser/Node/preload/worker types, architecture/copy checks and four fresh builds pass. Existing bundle-size warnings remain. The additive API schema was regenerated with `pnpm generate:api`. Final fixture types pass in `/tmp/gabs-release-policy-final-types.log`; the new type-only test import uses the root test project’s relative contract path.
- `/tmp/gabs-release-policy-web-reviewed.log`: all **four editor-update journeys** pass, covering generated input/removed fields, uncertain saves, custom explicit update, typed transfer, invalid conversion and failed-render recovery. That run's rollout cases required the synchronization timing correction below.
- `/tmp/gabs-release-policy-rollout-final.log`: all **three rollout journeys** pass. Optional rollout retains the old supported contract. Mandatory update preserves the original pending envelope. A lost accepted reply recovers the original receipt without duplicate record, audit or idempotency effects. The new case aborts actual package download after receipt of mandatory policy, verifies the persisted accepted set, restarts offline into a closed module gate, and then reconnects, installs, reviews and commits retained work.
- This is **seven distinct passing browser journeys across the final affected runs**, not one uninterrupted seven-case pass. Each isolated database was removed.
- Policy unit coverage preserves mandatory restrictions after restart and an older delayed response. The real signed-package lifecycle integration checks a dependency's optional/mandatory version restrictions without deleting drafts. Server/API integration checks bootstrap values for optional, mandatory and empty pins. Native authority unit coverage checks offline refusal after a policy update and manager restart.
- [Offline module gate](offline-update-required.png) and [preserved custom input](custom-input-preserved.png) were inspected. Existing scoped accessibility checks run within the editor/rollout journeys. These captures verify functional continuity, not final UI approval or whole-product accessibility.

## Failures resolved and limits

The first run exposed custom-view input reset after suspension; the loader correction makes the existing custom-editor acceptance pass. Rollout tests previously expected receipt/conflict reconciliation within five seconds while the old view could still run. The gate now closes that view. The final fixtures preserve the original identities through replacement, then poll the existing 15-second workspace synchronization cadence (25-second assertion limit), retaining the same server-effect and review assertions. They do not insert fake accepted outcomes or bypass version policy.

macOS still reports `CGSSessionScreenIsLocked = Yes`. Real minimized corporate native failed-download/restart/update and protected capability checks remain required; unit authority tests do not establish those gates. No foreground window, OS unlock or protected-storage bypass was used. Undelivered remote policy remains subject to the existing offline lease limit. Broader profile/credential recovery, full parity and the later UI-refinement goal remain open.
