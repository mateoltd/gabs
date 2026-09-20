# Desktop database encryption, 20 September 2026

Scope: ID-03-DB under ID-03 and SEC-002. Corporate SQLite pages and WAL are now encrypted in the utility process, including account/workspace keys, table definitions and payloads. Standalone profiles still use renderer-owned IndexedDB vaults. This milestone does not complete ID-03, key rotation, hardware/provider acceptance or release acceptance.

## Implementation and recovery

- `apps/desktop/src/utility/storage/database.ts` owns the versioned page format and migration. SQLite3 Multiple Ciphers uses explicit ChaCha20-Poly1305 authenticated pages without a plaintext database header. HKDF-SHA-256 derives a separate page key from the existing 32-byte OS-protected master key. Existing per-value AES-GCM encryption and key-bound authentication remain intact.
- SQLite uses WAL with FULL synchronization and memory-only temporary tables. The database file is mode 0600 in the private application directory. SQLite filenames, size, timestamps, page counts and filesystem allocation patterns are not concealed. This does not promise protection from a compromised OS or guaranteed erasure of old disk blocks/backups.
- The new file is `workspace.sqlite.protected`. Legacy import locks the original writer, authenticates every original payload and copies rows plus the migration marker in one target transaction. It checkpoints and verifies the encrypted copy, then retires the original database and sidecars. Interrupted imports retry transactionally; interrupted cleanup resumes from the committed marker. A reappearing legacy database after retirement is retained and rejected for recovery rather than silently overriding current work.
- Wrong keys, damaged pages and failed imports never become empty successful stores. A rejected initial import leaves the original recoverable. Missing key material beside an existing database fails closed; startup cannot replace it with a fresh key. A new key must be durably OS-protected before storage opens. Failed utility initialization terminates the unusable process so later attempts can retry.
- Keys, SQL and storage paths stay in main/utility ownership; no new renderer capability was added. The existing scoped cache bridge and pending-work retention policy are unchanged. No UI source, design tokens or styles changed.

The format and key ordering follow the [SQLite3 Multiple Ciphers configuration documentation](https://utelle.github.io/SQLite3MultipleCiphers/docs/configuration/config_sql_pragmas/) and its [ChaCha20-Poly1305 description](https://utelle.github.io/SQLite3MultipleCiphers/docs/ciphers/cipher_chacha20/). Version [13.0.3 of the Node binding](https://github.com/m4heshd/better-sqlite3-multiple-ciphers/releases/tag/v13.0.3) ships Node-API prebuilds. Dependency builds are disabled; the repository patch only exposes its already-shipped TypeScript declarations through `exports`.

## Packaging

The desktop build vendors the small JS loader, license and target native binary into `dist/vendor/sqlite`. Forge unpacks the native binary from ASAR. The bundled utility resolves that exact loader and needs no workspace `node_modules` or runtime download. Explicit target platform/architecture variables participate in the build cache.

`SUITE_DESKTOP_PACKAGING_SMOKE=1 pnpm --filter @suite/desktop package` passed on macOS arm64. The resulting ASAR contains the worker and loader; its unpacked companion contains `darwin-arm64.node`. A hidden development Electron main launched the worker **from this actual packaged ASAR**, then verified persistence across forced utility-process termination. This validates packaged storage loading, not the signed production main, notarization, Windows/Linux execution or an installed application update.

## Verification

- Ten focused storage checks passed in `/tmp/gabs-id03-storage-final.log`: live file/WAL metadata protection, unkeyed and wrong-key rejection, unchanged data after failed access, authenticated legacy migration, rollback after a later-row failure, corrupt legacy data retention, resumed cleanup, reappearing legacy-source rejection, page tamper rejection, process death during migration, and the two existing pending-work purge/opt-out tests. Several assertions share one test; the total is ten.
- The full isolated unit/PostgreSQL regression passed **736 tests across 110 files** in `/tmp/gabs-id03-regression.log`. This preceded the final master-key file/directory flush ordering safeguard; final strict/native checks cover the resulting build, while actual OS-provider acceptance remains open.
- Strict root/browser/Node/preload/worker types, boundary/copy checks and all four fresh build targets passed in `/tmp/gabs-id03-final-build.log`; `/tmp/gabs-id03-final-check.log` checks the final key-flush ordering change. Existing bundle-size warnings remain.
- `/tmp/gabs-id03-native-final.log` passed **three** hidden/minimized journeys on the final build: existing standalone unlock IPC/passphrase access, a real utility process preserving acknowledged pending work after SIGKILL, and the existing standalone worker surviving application restart. The earlier `/tmp/gabs-id03-native.log` passed two journeys: a real utility process preserves acknowledged pending work after SIGKILL, and the existing standalone worker survives application restart. The utility test inspects actual database/WAL/SHM files for private metadata and values. It uses an ephemeral test key directly in the utility process and does not claim OS-provider acceptance.
- `/tmp/gabs-id03-package.log` records the unsigned packaging smoke check. `/tmp/gabs-id03-packaged-storage.log` passed the same forced-termination journey using the packaged ASAR worker and unpacked native binary.
- Tests did not invoke Keychain unlock or Touch ID. No foreground acceptance window was opened. All disposable acceptance databases were removed. Frozen-lockfile installation and changed-source formatting checks pass. Historical captures overwritten by the standalone regression were restored.

## Remaining ID-03 work at this checkpoint

The subsequent [native standalone vault milestone](../native-vaults/README.md) implements utility custody and migration with scoped acceptance. The remaining key-lifecycle and actual provider gates below are still required.

Move standalone desktop persistence and vault keys behind the utility-process boundary, with migration from existing IndexedDB profiles and preserved passphrase/PIN recovery. Implement and verify durable key rotation and backup/recovery across failure boundaries. Complete actual OS-key-provider failure/restart acceptance and signed target-platform installation/update checks. Overall parity and the later UI-refinement goal remain open.
