# SDK-02: local module controls and durable operation recovery

16 September 2026. Users can open **Local profiles** from the account menu, install an authorized standalone module from their personal workspace, configure it separately and execute its declared local operations. Company records and configuration are not copied. Existing profile/resource screens retain their geometry and UI primitives; new controls use the existing toolbar and dialogs. This is an engineering milestone, not final UI approval.

## Behavior and boundaries

- **Manage local modules** lists bundled standalone defaults and installed releases. **Browse personal modules** shows enabled, entitled and assigned modules from the signed-in user's personal workspace. Download rechecks server access; changing entitlement after the list loads still denies installation. The official trust key comes from the authenticated host API, never a user-supplied package key.
- Installation verifies signed bytes and runtime compatibility through the existing local worker path, then stores code/configuration in the encrypted profile. Configuration editing and data-preserving uninstall work offline. Reinstallation retains the prior local configuration and records. This does not copy a corporate workspace or authorize corporate operations.
- **Local actions** derives operation choices and input fields from installed module definitions. Before execution, the host durably records the exact request key, input, release and configuration. The completed state, records and retry receipt commit together. User cancellation, worker loss or profile lock cannot partially commit the worker's changes.
- Pending, interrupted, rejected and accepted requests remain distinguishable. Retrying uses the saved input and stable key. Known business/validation failures are rejected; worker/storage interruptions remain recoverable. Dismissing a recovery request preserves accepted records and receipts. Release/configuration changes are refused when they would strand unresolved work.
- Browser reload or native application restart preserves the encrypted pending request. Unlocking exposes recovery controls. Requests belonging to removed modules remain stored and require reinstalling their release before retry. Complete profile-removal/sign-out/export recovery remains OFF-03.
- Bundled local definitions are now a fixed catalog separate from runtime registrations. Loading a corporate module release cannot silently replace local defaults or introduce an uninstalled local module.

## Verification

- **141 unit/PostgreSQL tests across 27 files**, strict TypeScript, boundary/copy checks and all four builds passed. The added catalog test registers a different corporate Contacts release and confirms the local default remains unchanged.
- **Four headless Chromium cases** passed: the new complete interface journey, both existing local-worker/package acceptance cases and the corrected device-fleet journey. The new journey verifies current entitlement checks, local configuration, cancellation and retry, rejected work without records, blocked configuration changes during unresolved work, restart recovery, exact record counts and uninstall/reinstall preservation.
- **Three minimized/unfocused Electron cases** passed: installation and interrupted-operation recovery through the actual UI, packaged worker signature/exact receipt recovery and the existing local resource editing flow. They use isolated profiles and assert minimized/unfocused windows. No interactive foreground launch is required.
- Axe found no tested WCAG A/AA violations in the local actions dialog. Wide/narrow action and module dialogs and the native resource screen were visually inspected; narrow layouts do not overflow the viewport. This is not whole-product accessibility or theme approval.

Captures: [action form](actions.png), [request recovery](recovery.png), [narrow recovery](recovery-narrow.png), [modules](modules.png), [narrow modules](modules-narrow.png), [native recovered record](desktop.png).

## Limits and next work

SDK-02 remains active. Local schema migration/recovery, coordinated dependency installation/update, offline reactivation of retained modules, richer custom local views and broader operation input schemas still need work; full schema-driven UI is also tracked by SDK-04. Local-profile installations are retained within the profile; unified server fleet reporting for these profile installations is not implemented. Corporate import, full-file native encryption, complete identity recovery and trust rotation remain separate open items. Existing module dependency validation rejects incompatible active sets; the local interface does not yet provide an automatic dependency installation wizard.

## Remote checkpoint

Commit `78206ad`, [CI 35139112513](https://github.com/mateoltd/gabs/actions/runs/35139112513), passed code/build, all three unsigned packaging jobs and 71 of 72 browser cases. The fleet test read an earlier **Downloading** report before the second device's failure acknowledgement, then timed out before its 30-second refresh. Its assertions now wait for the relevant server-acknowledged reports before querying the fleet, including recovery and removal. The corrected case passes locally. That remote run skipped load and restore; OPS-07 remains open.
