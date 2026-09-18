# Orders capability release acceptance

18 September 2026. SDK-05 scoped official effect adoption is locally verified. Full parity remains open.

## Implementation and boundaries

- Orders 2.1.0 adds the signed `export` capability (`files.export`, permission `orders.export`). Current workspace defaults select 2.1.0; Inventory remains 2.0.0. Orders retains its schema-2 business contracts and reviewed server implementation. The contract regression rejects any additional business/storage difference. Historical 2.0.0 and 1.1.0 definitions and implementations were not rewritten.
- The official view invokes the public typed SDK host client through `@suite/client/host`. The browser effect adapter is shared with independent custom views. Native effects use opaque main-process sessions and reauthorize after file selection. Aborting or changing the view closes the session.
- Background generation and authorized data retrieval remain host responsibilities. Pinned 2.0.0 retains its protected job delivery adapter; its save path still obtains authoritative bytes after file selection. Version 2.1.0 retrieves authorized bytes before requesting the declared device effect. Retrieval audits therefore remain present even when a later save is denied or abandoned; they are not proof of an operating-system write.
- The export capability has no offline allowance. Corporate generation, retrieval and effect authorization remain online-only. No CSS, geometry or modal structure changed.

## Verification

| Check                                                                                | Evidence                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Strict root/browser/Node/preload/worker types, boundaries and four production builds | `pnpm build` passed; `/tmp/gabs-orders-capability-build.log`. Existing bundle-size warning remains.                                                                                                                                                                  |
| Full unit/PostgreSQL suite on a temporary migrated/seeded database                   | 315 tests across 66 files passed; `/tmp/gabs-orders-capability-unit.log`. Includes schema-compatible defaults, exact release authorization and unchanged business contracts.                                                                                         |
| Headless browser acceptance                                                          | Four distinct journeys passed: Orders 2.1.0, actual pinned 2.0.0, independent online capabilities, independent corporate offline leases. Each Orders journey creates a company, generates a real worker export, downloads CSV and rejects a revoked second download. |
| Browser fixture correction                                                           | Initial run passed three journeys; the legacy-pin setup omitted the required idempotency key. Both Orders journeys passed after correcting that fixture. Logs: `/tmp/gabs-orders-capability-browser.log` and `/tmp/gabs-orders-capability-browser-final.log`.        |
| Hidden, unfocused Electron acceptance                                                | Four journeys passed: both Orders releases, independent online capabilities and corporate offline restart/lease recovery. `/tmp/gabs-orders-capability-native.log`.                                                                                                  |
| Native effect and authority checks                                                   | Real API, IPC and filesystem writes; post-dialog revocation and leaving the view prevent new files; exact retrieval audit counts are asserted; generic renderer CSV writes are denied. OS dialog selection is controlled so no foreground window opens.              |
| Accessibility and visual continuity                                                  | Scoped native dialog Axe checks passed for both versions. All four new web/native captures were inspected: readable denial messages, existing modal structure and no clipping. Historical regression captures were restored.                                         |

Local registry fixtures sign, review, stage and publish the new release only inside the disposable acceptance database. This is not production publication or production signing acceptance. Shared previews and development data were preserved.

## Remaining work

Administrator capability review and effective grant explanations are next under SDK-05. Positive native LAN, real notification presentation, profile/recovery and hosted release gates retain their original tracker rows. These official views still use the retained compiled host integration; this milestone does not claim completion of independent executable distribution for every official application or broader business-module completeness. Final UI refinement remains the separately queued goal after parity.
