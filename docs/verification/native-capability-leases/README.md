# Native corporate offline capability acceptance

18 September 2026. SDK-05 milestone; SDK-05 and full parity remain active.

## Authority and storage

Electron main independently obtains authenticated workspace policy, the registry trust key, the signed module package and the capability signing authority. It verifies the package and exact release before acquiring declared leases. The configured API issuer must match the lease authority; a changed API configuration cannot reuse another server's native context.

Main owns the policy, device opt-in, verified packages and signed grants in private records through the existing encrypted SQLite utility process. The renderer cache allowlist does not expose these keys. The preload method accepts only scoped module identity and an offline preference, and returns verified capability aliases and expiry. Renderer roles, snapshots, connectivity flags and supplied tokens do not establish native authority.

Authenticated policy responses update the main-owned context. Authentication, permission and mandatory-update denials revoke cached authority; unrelated business validation errors do not. Any HTTP rejection on the capability acquisition/authorization path fails without offline fallback. Only classified transport failures may use a retained lease. TLS/certificate and programming errors are not treated as disconnection. Existing online effects still work when protected storage is unavailable.

Opaque view sessions and the lease guard recheck current profile, scope, permissions, exact contract, policy revision, signing-key trust and expiry after native save dialogs. Known expiry/revocation prevents writing. Sessions also clear on navigation, profile changes, renderer termination and window destruction; the event hooks reuse the tested session invalidation mechanism. Public issuer trust survives scoped removal while private workspace authority is removed. Business drafts and pending operations are not part of these private authority records.

## Executed acceptance

| Check                                                         | Result                                                                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Focused native authority, client lease and host-session tests | 33 passed across three files                                                                                                                                        |
| Headless browser regression                                   | Three distinct journeys passed: shared lease storage, corporate offline exports, and host capability authority                                                      |
| Hidden native regression                                      | Five passed: renderer/storage boundary, unconfigured sign-in, corporate online host actions, standalone device effects and corporate offline effects                |
| Strict checks and builds                                      | TypeScript, all four environment configurations, boundary/copy checks and four application builds passed; unchanged bundles were cached in the last main-only build |
| Presentation                                                  | Native main-content Axe A/AA checks passed; native screenshot inspected. Browser offline wide/narrow coverage passed through the shared shell journey               |

The native offline journey publishes and assigns an independent reviewed module against a fresh temporary PostgreSQL database. After real API acquisition, it terminates Electron and starts a new process using the same protected profile with main-process API transport blocked. It opens the cached module and writes the expected export bytes. Online-only notification access is rejected. The journey also rejects renderer writes to authority keys, preserves useful grants after an unrelated missing-query response, advances the main clock during a held save dialog to prove expiry prevents writing, reconnects and renews, then observes a real permission revocation during another held dialog and verifies that no file is created.

Network loss is injected in a test-only launcher before application startup. Save dialogs are controlled inside the test; no real OS dialog or notification opens. Every desktop launch remains hidden/minimized and unfocused. This is actual Electron storage/IPC/file execution with controlled network/dialog conditions, not packaged cross-OS or real-provider acceptance.

Final authority and build logs: `/tmp/gabs-native-authority-issuer-tests.log` and `/tmp/gabs-native-authority-issuer-build.log`. Final five-case native run: `/tmp/gabs-native-authority-issuer-native.log`. Browser regression: `/tmp/gabs-native-authority-browser.log`, followed by the affected readiness/export rerun in `/tmp/gabs-native-authority-browser-accepted.log`. Those browser sources were unchanged by the final main-only issuer binding. Every completed isolated runner removed its database.

## Repairs during verification

Initial unit checks exposed an unregistered UUID format in the native validator; the native policy schema now derives the shared schema with an explicit UUID pattern. Strict checks caught a test-only unresolved type import and an unhydrated contract; both were corrected. Native fixtures were corrected to navigate from the restart's Overview page, use Axe's existing-page mode supported by Electron, and use the independently published fixture's actual version for the missing-query check. No production authorization assertion or acceptance threshold was weakened. Final runs above include these corrections.

[Native offline surface](offline-native.png) shows the verified export allowance and the refused online-only notification. Historical screenshots overwritten by regressions were restored rather than replacing earlier evidence.

## Remaining scope

The utility store encrypts record payloads; full-file encryption and key-lifecycle acceptance remain ID-03. Real OIDC/MFA, multi-profile unlock/recovery, supported OS notification presentation, packaged multi-OS updates and hosted signing-key rotation remain separate ID/GOV/OPS gates. Actual renderer-crash recovery beyond session invalidation remains part of those broader recovery exercises.

Next extend typed SDK fixtures, CLI scenarios and preview controls for corporate leased-offline states. Official module capability adoption, administrator review, positive native LAN transport and the remainder of the SDK-05 acceptance map are still required. This milestone does not approve the UI as polished or complete the parity goal.
