# Protected release review console

16 September 2026. EXT-02 local acceptance, using a real PostgreSQL registry and Chromium.

## What is verified

`pnpm module console` builds and serves the React operator interface on loopback. A terminal access code unlocks an HTTP-only session; database credentials and signing keys never reach the browser. The connection must hold the protected registry role. Production requires an explicit registry connection, while the documented development/test fallback uses the local migration connection.

The interface supports signed client/server uploads, search, state filters and pagination; exact contract and executable inspection; explicit approval/rejection reasons; server staging; publication; and immutable decision history attributed to the authenticated database login. It reuses the existing guarded release workflow and host UI components.

- `tests/registry-console.test.ts` verifies application-role rejection, anonymous access denial, wrong code, foreign origin, hostile Host header, invalid CSRF token, corrupt packages, publication before review, empty review reason, immutable decisions, retry-safe approval/publication, database audit identity and logout revocation.
- `tests/e2e/registry-console.spec.ts` uploads an actual independently built server package, exposes its contract/code for review, approves, proves publication disabled until staging, stages and publishes, and verifies the real registry row. A second version is rejected and remains unpublished.
- The browser journey checks automatic accessibility rules and a 390-pixel viewport without horizontal overflow. [Wide review](review-wide.png) and [narrow published review](review-narrow.png) were visually inspected.
- An actual CLI smoke run served the UI and rejected anonymous registry access, then shut down cleanly.
- Final `pnpm check`: strict TypeScript, boundaries/copy checks and 64 unit/PostgreSQL tests passed. The focused operator browser journey passed. The console's actual client build is exercised by that journey and the CLI smoke check.

## Scope and limitations

This is the official operator workflow, served on the operator's computer using their protected database login. It does not add publisher privileges to a company administrator. A hosted multi-user publisher portal and external publisher onboarding are not claimed; external publishers remain outside the initial official-only policy. Configure remote registry connections with authenticated TLS under the existing deployment policy.

The session expires after 30 minutes without requests or eight hours absolute. Locking revokes it immediately; a new unlock replaces any prior browser session. The running terminal is required; restarting creates a new access code. This is not an OS-compromise sandbox.

EXT-02's official submission/review/stage/publish behavior is now verified locally together with the earlier independent-server and company-activation evidence. Hosted trust management, per-module migrations and complete executable update recovery remain separate open tracker items. Overall parity is not achieved.

## CI evidence

The preceding `933068e` passed all unsigned packaging jobs, unit/build checks and 56 browser journeys, but [its CI run](https://github.com/mateoltd/gabs/actions/runs/35048614374) still failed the order-read latency target: 685 ms against 500 ms. Confirmation was 525 ms against 1,000 ms. Restore did not run after that failure. These console checks do not close the latency gate or establish signed-release readiness.
