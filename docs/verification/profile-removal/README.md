# Removed standalone profiles and session ownership

19 September 2026. Tracker: **OFF-03-LOCAL-REMOVAL**, contributing to **OFF-03 / OFF-02-LEASES**. Original mappings: **CORE-003, SHELL-001, AUTH-002**.

## Behavior and ownership

Removing a standalone profile hides it from the active profile list and locks its open sessions. Its encrypted vault, records, original requests and uncertain device outcomes remain on the device. Removed profiles can be restored only with their original passphrase. The interface explicitly describes this retention; it does not claim to erase the device's data.

The client identity layer owns vault encryption, transactional removal/restoration and revision checks. Removal and restoration each advance the durable revision without rewriting ciphertext. Stale unlocked writers cannot commit, simultaneous restorations have one winner, and profile-change notifications lock sessions across tabs. Session locking releases its subscription, closes local execution and device processing, and drops the session's references to decrypted data. This does not promise JavaScript memory erasure.

The shell owns presentation and the lifetime of the session it displays. It synchronously takes ownership of returned sessions, closes late sessions after navigation or background locking, and prevents an older unlock from replacing a newly restored profile. Recovery dialogs cancel pending restoration when closed or hidden. No stylesheet, public package identity or signed release changed.

## Review and checkpoint

Checkpoint `8602fbd0bf99c03cee8329eac697e43232aa5f2a`, on local branch `checkpoint/architecture-profile-review-d82129a`, preserves the entire unfinished checkout before the requested delegation. It is a recovery snapshot, not acceptance of the unrelated collision work.

The explicitly requested **gpt-5.6-sol / xhigh** subagent reviewed package ownership, depth and these lifecycle boundaries. The existing directory migration already provides `sdk`, `client`, `server`, `shell`, `ui/web`, `ui/tokens` and outermost product composition. No repeat migration was justified. The subagent found and corrected late-session ownership, out-of-order list refreshes, missing creation notifications and duplicate pending submissions. Parent review additionally fenced competing selection/unlock/restoration transitions and verified the final changes.

## Acceptance evidence

- Nine architecture boundary fixtures passed: `/tmp/gabs-architecture-profile-tests.log`.
- Strict root/browser/Node/preload/worker types, dependency/copy checks and four fresh production builds passed: `/tmp/gabs-profile-removal-final-build.log`. The final test sources also passed TypeScript and formatting checks. Existing bundle-size warnings remain.
- Eight headless browser journeys passed: `/tmp/gabs-profile-removal-final-web.log`. Five new cases cover delayed create/unlock after navigation, competing unlock/restoration, cross-tab removal plus offline restoration, and real IndexedDB/WebCrypto races. Three affected device-consent, signed-worker/device-request and local-service regressions also passed.
- The delayed-unlock/navigation regression failed against the pre-fix bundle because its session channel remained alive: `/tmp/gabs-profile-unmount-before.log`. Both delayed-create and delayed-unlock cases pass after the ownership fix. These deterministic tests hold actual WebCrypto derivation; they do not replace the production session or vault with a mock.
- The encrypted-vault case verifies exact ciphertext and retained input, rejects stale writers before and after restoration, rejects a wrong passphrase and an aborted restore, and permits only one simultaneous restoration. The signed-worker regression additionally restores a real interrupted device request and proves that its uncertain effect cannot run automatically or duplicate its saved business record.
- The real Electron journey creates a Contact through the standalone UI, removes its profile, closes the process, restarts with the same device directory and restores exactly one copy of the Contact. Explicit window checks verify that both processes stay hidden/minimized and unfocused. The first fixture omitted required Contact fields; selecting kind and relationship corrected that setup. No authentication, protected-storage bypass or foreground interaction was used.
- Wide/narrow recovery dialogs and the restored native record are captured in this directory. Narrow overflow and scoped dialog Axe checks passed. Screenshots were inspected; native capture disables transient animations. A capture-only rerun initially required a closed Select popup to be removed from the DOM, although the hidden renderer retained it during its exit. The final fixture verifies the already-selected resource without reopening its picker and uses the standard animation-disabled capture. Historical screenshots overwritten by regression runs were restored.

The final isolated unit/PostgreSQL regression passed **661 tests across 97 files**, `/tmp/gabs-profile-removal-final-unit.log`; its database was removed. The native journey passed in `/tmp/gabs-profile-removal-native-final.log`; the settled capture rerun is recorded in `/tmp/gabs-profile-removal-native-capture-final.log`.

## Required follow-up

This closes the scoped standalone removal/restoration journey. It does not complete saved corporate profile administration, irreversible local erasure, passphrase-loss recovery, native biometrics, corporate protected-storage sign-out/restart acceptance, real-provider flows or broader workspace/release transitions. Those remain explicit identity/offline gates. The successful standalone passphrase flow does not substitute for Keychain-backed corporate acceptance.

All four business applications, full feature parity and the separately authorized later UI-refinement goal retain their existing acceptance requirements. These captures demonstrate functional continuity, not final approval of the UI.
