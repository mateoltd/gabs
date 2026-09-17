# Local device grant authority

17 September 2026. SDK-05 remains active. This milestone verifies durable local-profile authorization; consent UI, worker brokering and desktop effect integration are still required.

## Evidence

- [Profile authority](../../../packages/client/src/identity/local-capabilities.ts) resolves declarations from installed, verified standalone modules and binds exact release digests, aliases, kinds and permissions.
- [Encrypted profile integration](../../../packages/client/src/identity/local-profiles.ts) saves and revokes grants, prunes them on release changes/uninstall, and provides an immutable request with a live recheck guard.
- [Unit acceptance](../../../tests/unit/local-capabilities.test.ts) rejects tampered/replaced signed bytes, changed bundled contracts, corporate-only definitions, wrong aliases/permissions and inactive installations.
- [Real browser acceptance](../../../tests/e2e/local-capability-grants.spec.ts) uses encrypted IndexedDB profiles and actual signed installation workers while offline. It covers denied defaults, input validation, profile isolation, immutable requests, revoke/regrant, lock/unlock, concurrent windows, updates, rollback, uninstall/reinstall and preserved records.

## Runs

| Check                                                                                     | Result                                              |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Local capability, existing host-capability and service transaction unit checks            | 12 passed across 3 files                            |
| Final local and existing host-capability regression checks                                | 36 passed across 8 files after subsystem extraction |
| Headless local device grants and existing service-consent journeys                        | 2 passed                                            |
| Strict types, browser/Node/preload/worker environments, boundaries and application builds | Passed; all 4 application bundles built             |

The final unit set includes the 12-test focused set; these counts are not additive. After subsystem extraction, the expanded device-grant browser proof passed again, including exact-release repair and profile removal. Browser acceptance ran in a fresh migrated/seeded database and removed that database afterward. Historical service-consent screenshots were restored. No device export, OS notification or LAN effect was performed.

Local logs: `/tmp/gabs-local-capability-unit.log`, `/tmp/gabs-local-capability-final-unit.log`, `/tmp/gabs-local-capability-browser.log`, `/tmp/gabs-local-capability-browser-final.log`, `/tmp/gabs-local-capability-build-final.log`.
