# Integrity evidence and retained audit recovery

Scope: **ID-04** support inspection, export and explicit repair of unreadable local integrity records. Local commands and interrupted-process recovery are verified below. ID-04 remains **active** for operational audit delivery/monitoring, real signed-platform/provider/physical acceptance and foreground native-dialog acceptance. Full parity and UI refinement remain incomplete.

## Operator procedure

Quit other instances of Common. Use the approved installed desktop executable with one operation:

| Switch                                              | Behavior                                                                                                                                                                                             |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--inspect-integrity`                               | Print a JSON diagnostic report without modifying integrity records or opening business storage.                                                                                                      |
| `--export-integrity=/absolute/path/new-report.json` | Save the report to a new file outside application data. Existing destinations, including symlinks, are refused.                                                                                      |
| `--repair-integrity`                                | After verifying the application, replace an unreadable audit with linked recovery evidence, retain the old directory and require fresh sign-in. Repeat this command to resume an interrupted repair. |

The startup failure dialog also provides **Export report** and, for unreadable or pending audit recovery, **Repair records**. An asset/signature failure requires an approved installation repair first. The application exits after support repair; restart it and sign in again. Repairing records never establishes corporate authority or submits saved work.

Reports contain the installation verdict, validated current records, pending/staged recovery metadata and validated records from retained audit directories. Invalid known records are identified without copying their bytes; unknown entries are counted without exporting their filenames. Credentials and business stores are not read. Files are limited to 8 KiB and traversal to 10,000 entries; exceeding the report limit refuses the operation instead of silently truncating evidence. Export uses private temporary storage, flushes and publication that cannot replace an existing destination.

Retain the entire application data folder, including `integrity-retained-<id>` and any `integrity-staged-<id>` directory or `integrity-repair.json` marker. Do not remove recovery markers to bypass the startup gate. If the marker itself is corrupt, paths are linked/ambiguous, or filesystem access prevents safe recovery, automated repair refuses and retains the evidence. Restore filesystem access or obtain operator-assisted recovery from a retained copy; no arbitrary original bytes are deleted or interpreted as authority.

## Recovery protocol

- A validated marker is persisted before moving the active audit. A separate staging directory contains matching provenance, a fixed incident identity, and locked/recovered events.
- Session invalidation finishes before replacement is published. Application verification runs before preparation and again before a new promotion. Startup refuses admission while a recovery marker exists, even after promotion.
- The old audit is renamed to a unique retained directory. The complete stage becomes active; original encrypted business storage is untouched. Each directory publication is flushed where supported.
- Resuming after retention or promotion validates the exact provenance and event pair. Existing retained evidence is never overwritten. Once complete, session cleanup and marker removal acknowledge recovery. Repeating a completed repair is a no-op while the new audit remains readable.
- Managed temporary files from an interrupted initial staging write are retained and do not prevent resumption. Unrecognized staging contents, conflicting provenance and symlinked directories fail closed.

These are local operational records, not tamper-proof server evidence. OS/package failures before main executes cannot be handled by these commands, and a compromised operating system remains outside this protection.

## Verification, 20 September 2026

- **25 focused tests passed** across support, installation integrity and runtime admission: `/tmp/gabs-integrity-support-unit-final.log`. Support coverage includes read-only inspection, sanitized report publication, overwrite and explicit symlink/linked-marker refusal, versioned repair evidence, failed session cleanup, resumed retention/promotion, corrupt markers and conflicting staging contents. The native-dialog controller runs through injected dialog responses with real report/repair code; this is not foreground OS dialog acceptance.
- Strict root/browser/Node/preload/worker checks, boundary/copy checks and all four build targets passed: `/tmp/gabs-integrity-support-build-final.log`. Desktop rebuilt and three targets used cache; existing bundle-size warnings remain. An initial fixture typing failure was corrected by expressing the exact dialog methods the controller consumes.
- **Nine hidden/minimized native cases passed in one run:** `/tmp/gabs-integrity-support-native-final.log`. The actual compiled executable inspected/exported/repaired while a test hook prohibited native business-storage opening. Inspection stdout parsed as complete JSON. Corrupted installation and incompatible command combinations were rejected; repeated repair preserved one retained audit and required old-session removal.
- Three compiled-process cases exited during the initial staged marker publication, after retaining the original, and after promotion. Normal startup remained locked; the same command resumed to one event pair with original bytes intact. This is real process-exit testing, not proof of power-loss durability.
- A real encrypted-work journey committed a Contacts request while holding its exact server reply, then triggered runtime lockdown, corrupted its audit, repaired through the executable, and signed in again. Original request identity/input and an unrelated draft survived. Reconnection produced exactly one record and one audit effect. Existing offline/accepted-work and runtime/startup regressions also passed. The disposable PostgreSQL database was removed.
- Six wide/narrow recovery captures were inspected; scoped Axe A/AA and overflow assertions passed. The two new captures are retained below; incidental changes to four historical captures were restored. Renderer sources/styles are unchanged, and current UI quality is not approved by this verification.

| Recovered original request and draft after audit repair | Capture                                     |
| ------------------------------------------------------- | ------------------------------------------- |
| Wide                                                    | [Saved work](recovered-accepted.png)        |
| Narrow                                                  | [Saved work](recovered-accepted-narrow.png) |

The product journey uses development authentication and controlled OS keys; compiled command probes deliberately disable protected storage. Actual identity/OS providers, signed installed releases, Windows/Linux filesystem behavior, physical durability and interactive native dialogs remain required acceptance. Operational server audit delivery and monitoring are still missing implementation, not provider configuration.
