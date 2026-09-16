# SDK-02: independently signed local executables

16 September 2026. Local handlers now build into reviewed, signed packages and run from encrypted profile installations in browser and desktop workers. SDK-02 remains active. This milestone verifies execution and profile lifecycle APIs; it does not deliver the end-user installation or custom-operation interface.

## Implementation

- `pnpm module build` bundles `module-local.ts` into one browser-compatible `suite-local-v1` executable using the public local SDK. The bundle is covered by the package checksum and Ed25519 signature. Privileged package imports, escaping relative imports and escaping symlinks fail the build. Reviewed code remains trusted application code; these boundaries are not a hostile-code sandbox.
- Local-only operations do not require a server component. Corporate operations and storage migrations still do. Registry approval/publication and the PostgreSQL submission guard enforce that distinction. A forward migration preserves existing releases and checks signed local payload requirements.
- Worker loading verifies package integrity, publisher identity, host compatibility, the requested contract and the loaded implementation contract before execution. Corporate services, Node, DOM and Electron preload capabilities are absent from the worker interface.
- Profile installation validates configuration, active dependencies and existing resource data before atomically committing an executable selection. Same-version executable bytes are immutable. An incompatible schema leaves the current release and records intact; local schema migrations remain unfinished and are explicitly rejected.
- Installed releases, configuration, resource records and receipts remain in the encrypted vault. Compatible upgrades preserve historical artifacts for exact receipt recovery; new operations cannot use superseded code. Uninstall retains data and receipts and refuses active dependents. Reinstallation preserves retained work. Bundled and installed resource definitions use the existing local resource interface without layout changes.
- The host must supply a trusted registry key. Accepting a package's own key is not a trust mechanism. There is no arbitrary package upload or unauthenticated registry bypass in the product.

## Acceptance

- CLI acceptance creates a module outside the catalog, builds, submits, approves and publishes it without host-source edits or a server entry point. Node and browser signature verifiers reject corrupted bytes and untrusted keys. Direct SQL attempts cannot bypass local bundle or corporate backend requirements. An authenticated API device installation accepts the local-only release without a staged server.
- Headless Chromium installs the reviewed executable into a local profile, runs it offline in a real worker, locks/unlocks, recovers an exact result, upgrades, rejects new old-version operations, rejects incompatible data and corrupt code, uninstalls and reinstalls without losing records. Separate coverage retains concurrent-session/deleted-profile protections.
- Hidden/minimized Electron runs the signed bundle in the actual packaged worker through `suite://app` under the production CSP, restarts with the same isolated profile and recovers the exact receipt without duplicate data. A test-only helper calls profile APIs; this is not evidence of an end-user installation flow. The existing native local resource editing journey also passes. Both tests assert every window is minimized and unfocused.
- The coordinated business upgrade regression now delays read-side completion in the test to deterministically exercise a committed request whose response is lost, followed by a manual retry with the same body and key. It no longer races a live completion update against the Retry button.

Verification: strict types/boundaries/copy checks, 140 unit/PostgreSQL tests, four builds, three headless browser cases and two minimized desktop cases. Existing build chunk-size warnings remain. No styling or geometry changes were made.

## Remaining scope

User-facing local installation/configuration/removal and custom-operation controls, uncertain operation recovery/cancellation UX, local schema migration support, broader dependency/version recovery, personal-to-company import, native full-file encryption and registry trust rotation remain open. This does not establish production release acceptance, functionality parity or approved UI polish.

The preceding commit `3d42f93`, [CI 35136781563](https://github.com/mateoltd/gabs/actions/runs/35136781563), passed code/build, three unsigned packaging jobs and 70 of 71 browser cases. The business-upgrade retry selector raced a live completion event and timed out. Load and restore were skipped; OPS-07 still has no new remote performance acceptance.
