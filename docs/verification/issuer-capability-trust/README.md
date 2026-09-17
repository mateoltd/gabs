# Shared corporate capability authority

18 September 2026. SDK-05 milestone; full SDK-05 and parity remain open.

## Implemented behavior

The client persists issuer trust separately from account/workspace grants. Every offline check compares its workspace grant with the current issuer key and trust generation. Learning a replacement through authenticated transport makes prior grants unusable across workspaces and accounts, including after restart. Revoked grants are cleared when encountered; unrelated business data and pending work remain intact.

Acquisition captures both workspace and shared-trust generations before its network request. A delayed key observation or renewal cannot overwrite a newer observation in another account. Retired fingerprints remain recorded and cannot be restored by a later response. A failed trust write retains the learned retirement in the current host's memory and retries persistence before subsequent authority checks. Storage failure never grants an effect.

IndexedDB holds the public issuer record outside account purge prefixes. A client-wide Web Lock serializes authority/grant changes and account/workspace purges across tabs. Removing an account removes its grants without erasing issuer retirement history. The shared record contains public keys and fingerprints, no user/workspace identifiers or credentials.

Older workspace-only records do not establish shared trust. A connected renewal binds grants to the current issuer generation and discards grants from the prior generation. Another workspace learning the same key does not make legacy grants usable.

## Final verification

- 22 focused tests across `client-capability-leases.test.ts` and `capability-leases.test.ts` passed. New cases cover cross-account/workspace replacement, other-issuer isolation, restart, delayed key observations and renewals, refusal of retired keys, failed trust persistence and legacy-cache upgrade.
- Two headless browser journeys passed against a freshly migrated/seeded isolated PostgreSQL database: the real IndexedDB/Web Locks harness and the actual independently published corporate custom-view export workflow. The runner removed its database on completion.
- The storage journey verifies cross-tab replacement, restart, account removal without trust-history loss, rejection of an old signed renewal, and serialized purge during held cryptographic verification. The product journey retains real authenticated acquisition, offline reload/download, connected denial/revocation and tamper/expiry rejection.
- Strict TypeScript and all four environment checks, boundary/copy checks and all four application builds passed. The existing web chunk-size warning remains.
- Product journey scoped Axe and narrow overflow checks passed. Wide/narrow screenshots were inspected with no structural regression; historical screenshot files were restored after inspection. No desktop window or real OS notification was launched.

Final logs: `/tmp/gabs-issuer-trust-tests-final.log`, `/tmp/gabs-issuer-trust-build-final.log`, and `/tmp/gabs-issuer-trust-browser-final.log`. Earlier runs preceded the legacy-generation hardening; the final runs above include it.

## Limits and next work

The browser harness supplies test-signed keys to the real storage adapter; it is not a hosted key-rotation exercise. Trust comes from authenticated API responses, never a module-supplied key. This client orders observations and remembers retired keys; it cannot infer chronology for a key it has never seen. Operators must serve a consistent issuer key, use a fresh key for recovery rather than reuse a retired key, and verify rollout/recovery under OPS-05. No claim of protection against compromised storage or an operating system is made.

Next implement independently trusted native authority in Electron main and encrypted utility persistence, then verify offline effects with hidden/minimized native journeys. Official module adoption, administrative review, leased-offline simulation and the rest of the SDK-05 acceptance map remain required.
