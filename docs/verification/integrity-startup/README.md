# Desktop startup integrity gate

Scope: the first implementation slice of **ID-04**. Startup asset checks and local incident/recovery records are implemented. ID-04 remains **active**: continuous runtime response, support recovery tools and signed-platform acceptance remain unfinished.

## Implemented behavior

- The desktop build inventories the generated preload, utility worker, renderer and native SQLite assets, then embeds SHA-256 digests and lengths in main before packaging. Main is anchored by the executable/package trust chain; it cannot hash itself as its own independent trust root.
- Startup checks the built inventory before reading remembered credentials, beginning storage maintenance, loading the native database utility or creating a renderer. Missing, changed, unexpected, unreadable and symbolic-link assets prevent admission. Reads are streamed and expected file sizes are bounded.
- Packaged macOS checks the complete bundle with `/usr/bin/codesign --verify --deep --strict`. Native binaries are signed after bundling, so their final bytes use the verified bundle seal rather than their pre-sign digest. Other assets still require exact build digests. Failure to verify the bundle does not exempt native bytes.
- A failed check writes an incident under the application profile's `integrity/` directory and refuses startup. The native error explains repair/reinstall and preservation of application data. Minimized tests and storage-maintenance commands report a fixed reason without opening an error window.
- State and event files are written through synced temporary files, atomic rename and directory flush where supported. Retrying a blocked installation retains one incident. Successful validation repairs interrupted audit publication, removes the previous global refresh credential and remembered identity, writes one recovery event and then clears the incident. Failed session cleanup leaves recovery pending. Saved profiles, encrypted business data and pending work are not deleted.
- Invalid or unwritable integrity records prevent admission and remain available for diagnosis. The audit contains release/time/reason and known build-asset names, not credentials or business input. These local files are operational evidence, not tamper-proof remote audit records.

## Verification, 20 September 2026

- Eight focused tests passed: exact native-byte modification; missing/injected/link/traversal cases; signature failure; post-sign native treatment without exempting preload; repeated incident/recovery; interrupted audit publication; corrupt-record preservation; recovery blocked until session cleanup succeeds. `/tmp/gabs-integrity-unit-final.log`.
- Strict root/browser/Node/preload/worker checks, boundary/copy checks and four build targets passed. The initial complete build rebuilt all four applications. After adding session invalidation, the final build rebuilt desktop and reused three cached targets. `/tmp/gabs-integrity-build.log`, `/tmp/gabs-integrity-build-final.log`.
- The [compiled desktop fixture](../../../tests/desktop/integrity.spec.ts) copies the real build, modifies its utility worker, verifies two rejected launches with no storage/window admission, restores the original asset and verifies successful window creation and one recovery event. Existing opaque work bytes remain exact; old credential/identity files are removed only after successful repair. This fixture disables OS-protected storage and terminates at window creation: it is startup-gate acceptance, not real sign-in or encrypted-database recovery acceptance.
- Existing [native backup/restore journeys](../../../tests/desktop/local-backup.spec.ts) exercise real encrypted profile creation, record edits, maintenance export and independent restoration, including interruption after commit. They use controlled OS providers and preserve the hidden/minimized configuration.

The initial typecheck found a fixture environment typing error, corrected before the passing build. The first native gate and both backup regressions passed; the final combined native run includes the strengthened credential-removal assertions. The final combined run passed all three native cases; its disposable database was removed. `/tmp/gabs-integrity-native-final.log`. No application stylesheet or renderer UI was edited. No interactive foreground window, real provider acceptance or new screenshot inspection is claimed.

## Remaining gates and boundaries

1. Continuous runtime monitoring and supported-signal response, including fencing in-flight capability/IPC calls, closing privileged sessions, preserving committed and uncommitted work, and requiring fresh authority after recovery.
2. Inspect/export of integrity evidence and an explicit, data-preserving repair path for unreadable audit state; false-positive operational journeys. Current error handling retains the records and requires filesystem repair; it does not yet provide that support workflow.
3. Real signed/installed macOS and Windows acceptance, Linux release trust, actual signing/provider success/failure and physical durability. A failed `codesign` fixture is not proof of a valid distribution signature.
4. Whole-product operational audit/monitoring acceptance and fresh real authentication after repair. Local receipts do not establish server-side audit delivery.

Electron's [ASAR integrity documentation](https://www.electronjs.org/docs/latest/tutorial/asar-integrity) states macOS and Windows support and describes process termination on archive-header failure. Such a failure can occur before main executes, so this application-level journal cannot record it. Existing packaging fuses remain enabled. Asset checks do not establish universal spyware detection, process-memory integrity, protection against replacement of the trust anchor or a compromised operating system.
