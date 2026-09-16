# SDK-02: resumable local module installation

16 September 2026. A local installation now saves its verified package, host trust key and configuration into the encrypted profile before migration starts. After interruption, the user can unlock the profile and resume from those retained bytes while offline. The previous installed module and records remain available until the replacement commits.

## Recovery contract

- Signature, standalone capability, configuration, active dependencies, immutable version bytes and outstanding operation requests are checked before staging the attempt. Recovery repeats these checks against the current profile state, then the worker independently verifies the signed executable again.
- A stable attempt identifier distinguishes the installation from a new request. Completed attempts retain compact metadata rather than another copy of the executable package. Pending, interrupted, failed and accepted states are durable. Cancelled work can resume; failures retain their explanation. Storage failure while recording an error preserves the original pending request.
- Acceptance, selected executable, migrated records and migration history commit in the same encrypted compare-and-swap transaction. Retrying an accepted identifier does nothing, including after a newer release has been installed. It cannot silently roll back executable code or repeat a migration.
- An unresolved attempt blocks replacing its candidate/configuration or uninstalling that module. **Discard installation** explicitly removes the recovery request while preserving the installed module and records. Other modules and ordinary local work remain usable; recovery validates against their current state.
- **Unfinished installations** appears in the existing local module dialog. **Resume installation** works offline and supports cancellation. The candidate is preserved across browser navigation and native application termination without a new registry download.

## Verification

- Strict types/boundaries/copy checks, **147 unit/PostgreSQL tests in 28 files**, formatting and all four production builds passed.
- **Four focused headless Chromium cases** passed. They cover durable failure/interruption states, refusal to replace an unfinished candidate, explicit discard, concurrent-session rejection, exact acceptance replay, historical operation receipts and existing local worker isolation. The UI journey cancels an upgrade, discards it without removing the installed version, starts it again, reloads while its worker is running, unlocks offline and resumes from retained code. A subsequent operation proves the saved configuration is still in effect.
- **Three minimized/unfocused Electron cases** passed. The expanded package case terminates the native application during an unfinished schema upgrade, relaunches, unlocks through the actual interface, resumes offline and verifies migrated records. It then checks accepted-attempt replay and exact historical operation receipts against the real packaged worker, retaining one migration-history entry. The native window state is asserted minimized and unfocused.
- The first interface test incorrectly expected an online account menu after an offline reload. The actual offline start screen exposes **Open local profiles**; the test now follows that real path and passes. This was a test-navigation correction, not a reconnect requirement.
- Visual review caught horizontally clipped recovery buttons in the initial table. The recovery section now uses a semantic list and wrapping controls. A focused final browser run checks both buttons' bounds at 390px, passes the scoped Axe A/AA checks and completes recovery. The final native interface run also passes. Modal captures wait for the visible opening state.
- Inspected [wide recovery](pending.png), [narrow recovery](pending-narrow.png), [new work after recovery](recovered-narrow.png), [native pending installation](desktop-pending.png) and [native recovered records](desktop-recovered.png). This is scoped functional/visual verification, not whole-product accessibility or final UI approval.

## Limits

The downloaded package must have reached profile staging. A network interruption before that point still requires another download; partially transferred byte ranges are not persisted by this profile installer. Coordinated dependency downloads/updates, profile fleet reporting, a general retained-release rollback interface and full-file native SQLite encryption remain open. Independent local authority does not authorize corporate actions or copy company data.

## Remote checkpoint

Prior commit `0112be1`, [CI 35143593433](https://github.com/mateoltd/gabs/actions/runs/35143593433), was still running its verification job at this checkpoint; unsigned packaging passed on Windows, Linux and macOS. Earlier measured remote load failures remain open under OPS-07. No terminal result or release readiness is inferred from the running job.
