# Deployment and operations

## Environments and roles

Use separate development, staging and production infrastructure, Auth0 applications, databases, secrets and object storage. The repository's `.env.example` and Docker PostgreSQL credentials are for loopback development only.

Provision database roles before production migrations:

- Migration role: owns the schema and tables, can perform reviewed DDL and create/assign the non-login control role. It runs only during deployment. A managed database administrator must grant it the required role-management permissions.
- `suite_app`: LOGIN, NOSUPERUSER, NOBYPASSRLS, no schema ownership or DDL privileges. API credential only.
- `suite_worker`: separate LOGIN with the same privilege restrictions. Worker credential only.
- `suite_control`: NOLOGIN, narrow table permissions and explicit RLS policies used by security-definer functions. Runtime roles must not be its members.
- Operator: a separate, audited human-controlled database credential for entitlement grants and recovery. It must not be deployed to the application.

Run `pnpm exec tsx tooling/migrate.ts` with `MIGRATION_DATABASE_URL` from the secret manager. Migrations take an advisory lock and verify the checksums of previously applied SQL files. Do not edit an applied migration. On managed PostgreSQL without superuser privileges, have the database administrator create `suite_control`, grant the migration identity permission to set that role during ownership changes, and verify the grants before staging deployment.

Never use the migration credential as DATABASE_URL. Enforce TLS using the provider's certificate chain and `sslmode=verify-full`; do not disable certificate verification. Repeat the integration isolation tests using the real application role after migrations.

## Auth0 configuration

1. Create a confidential Regular Web Application and a public Native Application. Register the API audience with RS256 signing. Enable Universal Login, verified email, Authorization Code, and rotating native refresh tokens with expiry and reuse detection.
2. Web callback: `https://<suite-host>/auth/callback`; web origin: `https://<suite-host>`. Use one HTTPS origin for web assets, `/auth`, and `/api` through the edge. `APP_ORIGIN` and public `API_ORIGIN` must match this routing.
3. Native callback: `http://127.0.0.1:49173/callback`. Native applications contain no secret. Register the exact callback, including port, in Auth0. Token exchange and refresh run in Electron main.
4. Enable suitable MFA factors and install the two Post Login Actions in `deploy/auth0`, in file order: `require-mfa`, then `mfa-claim`. Set their `SUITE_CLIENT_IDS` secret to the two comma-separated client IDs and `SUITE_MFA_CLAIM` to the configured claim URI. This pilot setup challenges all suite users; application authorization independently requires verified MFA for company owners and administrators.
5. Test first enrollment, subsequent login, existing SSO, native refresh, cancelled login, callback replay, and recovery. Never hardcode the custom MFA claim to true. A user cannot regain company administrator access until the issued session/token actually proves MFA.

The ordering matters: a challenge must complete before the later Action inspects authentication methods. See [Auth0's MFA Action behavior](https://support.auth0.com/center/s/article/using-actions-mfa-authentication-method-is-missing-on-first-login), [custom MFA selection](https://auth0.com/docs/secure/multi-factor-authentication/customize-mfa/customize-mfa-selection-universal-login), and [native OAuth](https://www.rfc-editor.org/rfc/rfc8252). These are configuration templates; live tenant flows have not been exercised here.

API secrets: DATABASE_URL, AUTH0_CLIENT_SECRET. Public configuration: AUTH0_ISSUER (including trailing slash), AUTH0_CLIENT_ID, AUTH0_DESKTOP_CLIENT_ID, AUTH0_AUDIENCE, AUTH0_MFA_CLAIM, APP_ORIGIN, API_ORIGIN. Set AUTH_MODE=oidc, NODE_ENV=production and HOST=0.0.0.0. Development auth refuses production mode and non-loopback binding.

## Containers and exports

Build the Dockerfile targets `api`, `worker`, and `web`. Run the migration job first, then the API and worker, then the compatible clients. The nginx example serves immutable asset files, no-cache HTML/service worker, restrictive content policy and same-origin API/auth proxying. Put it behind a managed HTTPS edge; configure HSTS there and keep direct API/worker access private.

The worker requires WORKER_DATABASE_URL, EXPORT_BUCKET and AWS_REGION. Give it write access only to the private export bucket prefix and encryption keys it needs. Give the API read access to that prefix. Block public bucket access, enable storage encryption and set an export retention/lifecycle policy. Export creation, execution and retrieval each check authorization. Browser/desktop receive an authorized CSV response; private object keys are not public download links.

Each container logs structured records. API responses carry request IDs. `/health` checks database connectivity. Do not log provider tokens, cookies, callbacks containing authorization codes, integration secrets or whole business payloads. The worker emits a `job_health` record every minute with pending/failed counts and oldest pending age. Map these logs into the hosting provider's metrics and alerts.

Pilot request limiting is per process and IP. Configure a shared edge limit for multi-instance production deployments and set trusted proxy handling deliberately. Do not assume per-process counters enforce a global limit.

## Entitlements and seats

Production workspaces start without active commercial entitlements. A human operator grants the pilot allowance:

```sh
OPERATOR_DATABASE_URL=... OPERATOR_USER_ID=... pnpm exec tsx tooling/grant-entitlement.ts <workspace-id> inventory true 10 "Pilot approval"
OPERATOR_DATABASE_URL=... OPERATOR_USER_ID=... pnpm exec tsx tooling/grant-entitlement.ts <workspace-id> orders true 10 "Pilot approval"
```

The operator user ID must be their existing application identity for audit attribution. Supply secrets through the environment, not shell history. The CLI locks the workspace, rejects seat allowances below active membership usage, and records the grant. The company owner then configures and enables Inventory before Orders. There is no payment collection or automatic subscription lifecycle.

## Jobs and incident handling

The dispatcher claims only job envelopes; processing establishes that workspace's tenant context. Claims have a token and 60-second lease. Processing locks the job row, so an expired lease cannot cause two workers to commit the same delivery. Notifications deduplicate by event and recipient. Export writes use a deterministic object key so a retry can replace an uncommitted object safely.

Normal failures use exponential backoff and exhaust after five attempts. Repeated process crashes are also bounded; the dispatcher marks exhausted leases failed. The export list reflects a failed underlying job, including exhausted crash retries. Alerts include failed job counts; an operator must resolve or retry the specific failed job.

Investigate `last_error`, actor, workspace, event type and request ID using the operator credential. After correcting the cause, reset attempts, failed_at, locked_until and available_at for the specific failed outbox record in a reviewed tenant-scoped transaction. Exports must still pass current authorization on retry. Never replay arbitrary payloads outside the normal worker.

Alert on:

| Signal            | Initial trigger                                             |
| ----------------- | ----------------------------------------------------------- |
| API availability  | Elevated 5xx rate or failed health checks over five minutes |
| Database pressure | Sustained high CPU, storage, connections or lock waits      |
| Job backlog       | Oldest pending job exceeds five minutes                     |
| Exhausted jobs    | Any new failed job                                          |
| Backups           | Any failed backup or PITR continuity gap                    |

Thresholds are starting points to calibrate in staging. No hosted monitor or notification destination has been provisioned by this implementation.

## Backup and recovery

Targets: RPO 15 minutes, RTO four hours, seven days of PITR and 30 daily backups. Configure and verify these in the managed PostgreSQL service. Daily logical dumps alone do not meet the RPO. Keep recovery credentials and the runbook independent of the failing deployment.

`pnpm test:restore` verifies local logical recovery into a newly named database, then removes only that drill database. It checks stock balances, outstanding reservations, ledger reconciliation and unscoped application-role RLS. The report records dataset size and elapsed time. It is not evidence of managed PITR or a four-hour full-service recovery.

For the staging restore exercise: select a timestamp, restore into isolated infrastructure, deploy the matching compatible API/worker, run the invariant/isolation checks, complete an order through the UI, verify an authorized export, record recovery point and elapsed restoration time, and obtain operational acceptance before routing production traffic. Preserve the original database while diagnosing an incident.

## Desktop distribution and compatibility

`pnpm --filter @suite/desktop package` produces an application directory; `make` produces OS-specific artifacts. The shared bundles contain all runtime JavaScript, and the Forge configuration excludes the rest of the monorepo. Forge tooling is selectively hoisted under pnpm's workspace configuration. See [Forge's package-manager requirements](https://www.electronforge.io/).

Both packaging commands validate the HTTPS API origin, Auth0 issuer, native client ID, audience and loopback callback before building. Provide those public values in the build environment. For the seeded local pilot, use `pnpm dev:desktop` from the repository root; it loads `.env` and enables the local adapter only for an unpackaged development app with a loopback API. CI explicitly sets `SUITE_DESKTOP_PACKAGING_SMOKE=1` to check installer creation without a hosted identity provider. Those artifacts are labeled packaging checks and cannot authenticate without valid service settings.

CI builds on macOS, Windows and Ubuntu 24.04. Local verification covers macOS arm64 only. Validate actual installation, native login, OS storage fallback, IPC restrictions, drafts across restart, offline expiry, update recovery and uninstall behavior on each supported platform.

The manual release workflow uses a protected `desktop-release` environment. Configure the public Auth0/API/update values, Windows PFX certificate/password, Apple Developer ID certificate/password, signing identity, and notarization API credentials. It fails on absent release configuration and signing secrets. It uploads candidates for review; it does not publish them. Verify signatures and notarization on the resulting artifacts before distribution. Unsigned CI packaging artifacts are not production releases.

Host the platform-appropriate update feed over HTTPS with compatible artifacts. Built-in autoUpdater applies on macOS/Windows; Ubuntu uses reviewed manual package updates. Updates install on application quit and preserve user data. Keep current and previous desktop releases supported for at least 90 days except urgent security retirement. MIN_DESKTOP_VERSION is a compatibility gate, not an entitlement control or proof of an honest client.

Deploy additive schema/API changes before dependent clients. Delay destructive migrations until supported clients and running backend versions no longer need the old shape. Prefer forward repairs. Test a real signed update between two releases with unsent drafts before opening the pilot to users.
