# Fresh authentication for profile recovery

Date: 19 September 2026. Tracker: ID-02-RECOVERY, under ID-02. Status: server contract and local protocol checks verified; browser PIN storage/UI and real-provider acceptance remain required.

## Implemented contract

`GET /api/v1/identity/recovery` returns the current account, a non-secret session identifier, its authentication time and a fixed expiry five minutes after session creation. The server derives these values from the authenticated database session. Repeated reads return the same identity and expiry, without updating the session. The normal account-matching, revocation and `no-store` response rules apply. Unauthenticated or inactive accounts are denied; recovery also requires verified email, MFA and a recent session. Caller-supplied timestamps or MFA headers grant nothing.

The schema lives in [contracts/identity/recovery](../../../packages/contracts/src/identity/recovery.ts). The [authentication service](../../../packages/server/src/identity/authentication.ts) owns freshness and identity decisions, and the HTTP route only exposes that service. OpenAPI and the generated client derive the response type from the schema. The response grants no permissions and does not renew sessions or offline leases.

Web sign-in now requests fresh provider authentication. Both web and native authorization-code exchanges validate `auth_time` with the installed OpenID client's `maxAge` check. The prior native request already sent `max_age=0` but omitted the corresponding token check. [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest) specifies the authentication-age request and its required `auth_time` response claim. Existing state, nonce, PKCE and single-use callback checks remain in force.

## Verification

- Five focused cases pass: two real API/database recovery journeys and three production OpenID-client protocol cases. Fresh, missing and stale authentication times are exercised. The fixture controls provider discovery and transport, while the actual token-processing library, login-attempt storage and identity provisioning execute. Invalid callbacks cannot provision an account and cannot be replayed.
- Real API checks cover fixed expiry, stable and distinct session identifiers, unchanged session storage, secret exclusion, forged claims, stale sessions, mismatched accounts, absent MFA, unverified email, inactive users and revoked/missing sessions. A stale recovery denial leaves the existing ordinary session usable. The generated client exposes the typed result.
- Strict root/browser/Node/preload/worker checks, boundary/copy checks and all four fresh builds pass. The full isolated unit/PostgreSQL suite passes 704 tests across 104 files.
- Ten headless browser identity/sign-out journeys and two hidden/minimized native readiness/recovery journeys pass. The protected-storage PIN/restart journey remains skipped. No UI source or stylesheet changed; existing captures remain byte-identical.
- Initial fixture corrections used the repository's public relative test imports and matched the OpenID client's structured error cause, which carries the rejected claim. These were fixture failures; missing/stale tokens were already rejected. No timeout, authentication or business acceptance rule was relaxed.

Logs: `/tmp/gabs-browser-unlock-focused2.log`, `/tmp/gabs-browser-unlock-build.log`, `/tmp/gabs-browser-unlock-regression.log`, `/tmp/gabs-browser-unlock-web.log` and `/tmp/gabs-browser-unlock-native.log`. Disposable databases were removed. Direct pinned test dependencies on `openid-client` and `jose` match the server's existing versions; no production dependency version changed.

## Remaining work and consumer rules

Browser corporate PIN storage and the lock UI are not implemented by this change. The browser consumer must bind recovery to its expected account, compare against the session being recovered, check expiry, and reject stale asynchronous completions after another lock or account switch. An unchanged session must not become a new authentication merely because its evidence was fetched again. PIN unlock must preserve pending input, retain account/workspace isolation and obey existing offline leases and server permissions.

Real-provider MFA, TLS discovery, callback and refresh acceptance remain open. Controlled provider transport and native development login do not establish those gates. Supported physical biometric/OS acceptance, standalone PIN/biometric integration, full ID-02 and overall parity remain unfinished. UI refinement has not started.
