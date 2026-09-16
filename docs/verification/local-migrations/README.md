# SDK-02: reviewed local schema migrations and offline restoration

16 September 2026. Signed standalone releases can now migrate their own encrypted profile data. Personal schema versions are independent of corporate database versions. Removed modules can be restored from retained signed code without connecting. SDK-02 and full parity remain active; the current interface is an engineering baseline awaiting the separately authorized refinement goal.

## Behavior

- `localStorage` declares the target schema, compatible stored versions and named forward steps. `defineLocalModule` requires handlers for those names and infers configuration and standalone rename targets. Historical fields remain unknown until checked by the handler.
- The CLI signs migration-only local bundles, even when no local operations exist. Registry review and database submission guards require those executable bytes. Such releases do not require a corporate server component unless their corporate contract does.
- A disposable worker runs the complete migration path against a private snapshot. Migration capabilities page through retained and archived records, create derived records, write/archive with version checks and rename resources within the module's namespace. Caught capability failures poison the transaction; detached writes are drained; capabilities close after the step.
- Before committing, all retained records must validate against the incoming release. Selected code, configuration, schema version, migration history and records share one encrypted compare-and-swap write. Failure, cancellation or a competing session leaves the previous installation intact. Unrelated module records and historical retry receipts are preserved.
- Stored data is never downgraded. Executable rollback succeeds only when the incoming release declares compatibility with the actual stored schema and validates the retained records. Reinstalling a compatible release does not repeat migrations.
- The existing installation dialog retains configuration, explains updates to saved data and supports cancellation. **Retained modules** offers **Restore locally** after uninstall. Offline restoration verifies the retained signature and validates code/data before activation.

## Verification

- **147 unit/PostgreSQL tests in 28 files**, strict TypeScript and boundary/copy checks passed. Compile-time checks reject missing/unknown migration handlers, invalid rename targets and unvalidated historical field access. Runtime cases cover complete paths, archived metadata, source isolation, missing paths, invalid output, caught errors, detached writes, closed capabilities, derived records and mixed-case pagination across more than 100 records.
- All four production builds passed. Database migration 027 was applied locally; the package acceptance tests publish an independently built migration-only release and exercise the database guard against missing executable code.
- **Four focused headless Chromium cases** passed. Coverage includes signed local execution, failed/cancelled migrations, concurrent-session rejection, unlock/retry, compatible and incompatible rollback, unchanged historical receipts and the actual installation/cancel/retry/offline-uninstall/restore interface. The final migration-specific rerun uses the latest SDK build.
- **Three minimized/unfocused Electron cases** passed. The signed-package case migrates with the actual packaged worker under the native CSP and `suite://` protocol, restarts the application, then recovers the original operation receipt while retaining the migrated record and one migration-history entry. The final package rerun uses the latest worker build.
- Visually inspected [retained module restoration at desktop width](retained.png) and [restored data at narrow width](restored-narrow.png). Existing dialog/table/toolbar primitives are reused. This does not establish whole-product visual or accessibility approval.

## Remaining work

The installation candidate and configuration are not durably journaled before migration; interruption preserves the old installation but may require downloading the candidate again. Durable installation recovery, coordinated dependency selection/update, a general retained-version rollback interface and local-profile lifecycle reporting remain open. Richer custom views/forms remain SDK-04. Native profiles still use the encrypted IndexedDB vault; this is not completion of full-file desktop SQLite encryption, biometric identity, corporate import or trust rotation.

## Remote checkpoint

Prior commit `294c5c8`, [CI 35141217552](https://github.com/mateoltd/gabs/actions/runs/35141217552), passed strict/code/build checks, all **73 headless browser cases**, unsigned Windows/Linux/macOS packaging and a **two-second logical restore**. Load acceptance failed on the two-core Linux runner: p95 read **1,619 ms** and confirmation **2,435 ms**, against unchanged **500/1,000 ms** budgets. A diagnostic repeat recorded 1,548/2,588 ms. These are unresolved failures, not adjusted acceptance thresholds; OPS-07 remains open. Restore passed its recorded logical invariants but is not hosted disaster recovery or signed-release acceptance.
