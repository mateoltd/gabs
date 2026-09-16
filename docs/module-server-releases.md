# Reviewed server releases (EXT-02)

## Official release workflow

The registry now keeps immutable client/server submissions, review decisions, staging status and an append-only event history. Protected release tooling operates with the `suite_registry` database role. The application reads this state but cannot submit, approve, stage or publish releases. Use distinct authenticated database logins for human operators; audit attribution comes from the database session identity, not a client-supplied reviewer name.

1. `pnpm module build <module-directory>` creates the signed client JSON and, for a scoped operation-bearing module, a separate `.server.json` package.
2. `pnpm module submit <client.json> <server.json>` verifies signatures, identity, compatibility and exact contract equality, then returns a submission ID. Omit the server argument for a resource-only module.
3. `pnpm module submissions` lists recent submissions. `pnpm module submissions <id>` exposes the complete submitted artifacts and review metadata for inspection. Reviewers must inspect the actual code and contracts; a signature is not a code review.
4. `pnpm module review <id> approve <reason>` or `reject <reason>` records an immutable decision. Rejected code needs a new version and submission.
5. `pnpm module stage <id>` verifies and loads the approved server factory before marking it staged. A failed factory leaves the release unstaged and unpublished. Staging does not execute business operations.
6. `pnpm module publish <id>` revalidates artifacts and dependencies and publishes the approved client only when its required server is staged. Retries do not duplicate publication or audit events.

`REGISTRY_DATABASE_URL` is mandatory outside development/test. Give its login membership in `suite_registry`, keep it out of API/worker/client environments, and protect signing keys separately. Local development may use the explicit migration connection. There is no automatic approval in the production CLI; seed and acceptance helpers approve only their documented local fixtures.

Buying, organization activation/configuration, permission grants, user assignment and device installation remain separate. Registry publication no longer mutates every company's roles or activation records. Administrators grant access in their own workspace. Ordinary employees cannot turn registry publication into runtime access.

## Organization activation

After registry publication, an administrator can discover the release in Modules even if the company predates the module. Configure validates the workspace's selected signed schema and enabled dependencies. Publishing requires an active entitlement and creates the company activation record when it does not exist. Employees do not see draft modules.

People & access derives business permissions and module assignments from the same release catalogue. Create a role with the module's declared permissions, then assign the role and module to a member. Assignment does not implicitly grant operation permissions. Opening an authorized module uses the normal verified installation path. Purchasing an entitlement remains a separate commerce step.

[Browser acceptance](verification/module-activation/README.md) exercises this path without inserting activation rows, role permissions or module assignments as fixtures.

## Executable server contract

`module-server.ts` exports `defineModuleServer(module)({...handlers})` using public scoped capabilities. The compiler produces a self-contained `suite-server-v1` factory and shares the host SDK, including runtime validators and typed business errors. Source imports stay within the module or the public SDK. The artifact signature covers the exact module contract, JavaScript and format. Server code is not included in client downloads.

The authoritative API loads the reviewed staged package for the workspace's selected version on demand. A client release can be published after the API starts; no central source registry or host rebuild is required. Older staged versions remain usable through workspace pins. Authorizations, resource writes, business errors, events, audit and idempotency stay inside the existing transaction and scoped capability runtime.

Official executable code remains trusted application code, not a hostile-publisher sandbox. Approval must happen before staging or runtime loading. Signature checks do not replace operator trust or code review.

The host's existing trusted Orders/Inventory bridges remain supported as builtins. Their client packages still build, but independent server publication requires migration to scoped capabilities under SDK-01. Development seeding records explicit fixture reviews for those host-owned backends. Migration 014 labels pre-existing releases as a historical baseline; it does not manufacture past human review evidence.

## Current verification and remaining work

Real PostgreSQL tests exercise premature publication, immutable submission/review, altered signatures, restricted release-tool privileges, concurrent publish retries, failed staging, server-side business rollback, revoked permissions and old-version pins. The fifth custom-view fixture builds, submits, reviews, stages and publishes both packages through the real CLI; Chromium and Electron save through its independently deployed server operation against the compiled API.

The official CLI workflow is usable. The publisher review web interface, external publisher authentication/approval, per-module migrations, hosted deployment acceptance and trust rotation are not implemented by this change. External publishers remain outside the initial official-only release policy. EXT-02 stays active while its review interface and remaining acceptance are completed; EXT-03 owns schema migration work.
