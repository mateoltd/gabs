# Portable local-profile backup creation

20 September 2026. Scope: ID-03-BACKUP-LOCAL under ID-03 and SEC-002/SEC-003. This milestone implements backup creation and authenticated archive extraction. Product restore activation, recovery authorization and device-effect safeguards are unfinished; it does not establish complete lost-key recovery or corporate backup parity.

## Implemented behavior

- The desktop maintenance flag `--backup-local-profiles=<new-file>` runs before credentials, renderer windows or business operations are opened. It requires the application to be closed, reads a bounded passphrase from standard input, rejects combined rotation/backup commands and exits with a success/failure code. Another running instance is neither focused nor used to take a live snapshot.
- Main obtains the current protected database only after finishing any interrupted key rotation. The utility then creates a new encrypted SQLite database containing standalone vault envelopes and matching migration receipts. It uses a fresh independent master/page key. The source remains intact, including its corporate pending work.
- Corporate caches, journals, identity/refresh-token files and corporate unlock policies are excluded. A portable whole-database key would make those records readable outside their account permissions and leases, so corporate recovery needs its own authenticated, scope-aware path. The local export is not a replacement for that requirement.
- Native PIN/biometric wrappers are excluded from the copy. Profile passphrases still protect the encrypted business data. Profile identifiers, revisions, removed state and migration receipts remain available for the forthcoming restore workflow. Device capability grants and device-request outcomes inside the encrypted profile still require guarded normalization during restore before a session is issued.
- The archive uses a versioned local-profile header, random salt and IV, PBKDF2-HMAC-SHA-256 at 600,000 iterations, and AES-256-GCM with the framing authenticated as additional data. The encrypted database and its independent key are streamed into the archive. The database key is never written as plaintext. KDF/cipher parameters are fixed by the version, rather than chosen by untrusted archive input. This follows the relevant [OWASP cryptographic-storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html) and [PBKDF2 work-factor guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- Extraction holds one source descriptor, authenticates the complete archive and releases only encrypted SQLite pages plus an in-memory key. Wrong passphrases, altered framing/body/tag, truncation, trailing bytes and cancellation cannot publish a recovery file. Extracted storage must still pass database/schema and recovery-policy validation before activation.
- Publication uses a flushed temporary file and atomic no-overwrite hard linking. Existing backup/recovery files are never replaced. Destinations must support hard links; unsupported filesystems fail closed. A process killed during creation can leave an encrypted `.tmp` file; the final file is never used as evidence of successful backup without authentication. Normal failure/cancellation removes temporary output. Windows directory flush and signed-platform acceptance remain external validation work.

## Operator use and current limits

Quit Common. Use the desktop executable with `--backup-local-profiles=/absolute/path/local-profiles.commonbackup` and pipe a long, unique backup passphrase through standard input. Never put the passphrase in command-line arguments, shell history or environment variables. The command permits one final line ending, preserves intentional spaces, and rejects empty, multiline and excessively long input. Keep the archive passphrase separately from the original device; each saved profile still needs its own original passphrase.

For an interactive terminal, Python's `getpass` can collect and confirm the secret without echoing it, then pipe it to the executable. No password is supplied by the example:

```sh
python3 -c 'import getpass,sys; p=getpass.getpass("Backup passphrase: "); q=getpass.getpass("Confirm passphrase: "); sys.exit("Passphrases differ") if p != q else sys.stdout.write(p)' | \
  /Applications/Common.app/Contents/MacOS/Common --backup-local-profiles="$HOME/local-profiles.commonbackup"
```

This is a machine-owner maintenance operation, not a renderer or module capability. It currently creates backups only. There is no supported product restore command or UI yet. Do not replace active storage or publish decoded archives manually. The next acceptance item must preserve original storage through interrupted activation, require fresh corporate authentication, reset device-bound unlock state and prevent restored device requests from repeating effects. Corporate saved-work backup/recovery remains separately required; this archive does not contain that data.

## Verification

- `/tmp/gabs-local-backup-regression-accepted.log` passed **786 tests across 114 files** against the final implementation. The 13 backup cases include current migration-receipt assertions, corporate-cache exclusion, removal of quick-unlock wrappers, independently keyed portability, source retention, malformed/tampered archives, wrong passphrases, cancellation, bounded secret input and no-overwrite behavior.
- `/tmp/gabs-local-backup-build-accepted.log` passed strict root/browser/Node/preload/worker checks, architecture/copy checks and all four fresh builds. Existing bundle-size warnings remain.
- `/tmp/gabs-local-backup-package-accepted.log` produced the unsigned macOS arm64 package. `/tmp/gabs-local-backup-native-accepted.log` passed eight hidden/minimized journeys. The backup journey runs actual main/utility code from its ASAR with the bundled SQLite binding. It verifies backup creation, refusal while the profile is open and portable profile data under a different controlled OS provider. Other journeys retain PIN/biometric envelope renewal, corporate pending work after worker termination and all three key-rotation interruption cases.
- The final worker leaves the completed snapshot closed before main streams it; it does not reopen the file in WAL mode or initialize normal vault sessions. This behavior is included in the final build, regression and packaged native run.
- The maintenance fixture fails if any browser window is created. For portability verification it uses test-only staging to put the authenticated archive under a new controlled provider, then opens the original saved contact through the real UI. That staging proves portable data and key separation, not completion of product restore activation.
- Actual Keychain/DPAPI/Secret Service, physical biometric, signed installer and full packaged-main environment acceptance remain required. A development Electron harness supplies the controlled OS callbacks for packaged-code verification.

All disposable PostgreSQL databases were removed. Changed-source formatting, diff whitespace, documentation links and all 29 original requirement mappings pass. No UI source or styles changed. Original browser-only profiles must complete the existing native migration before this native-store maintenance command can export them.
