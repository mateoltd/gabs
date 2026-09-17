# Test ownership

Root tests are grouped by the boundary they exercise:

- `unit/` contains deterministic domain, SDK, client, storage and simulation checks that do not require the suite PostgreSQL roles.
- `integration/` contains API, PostgreSQL, registry, migration and multi-package checks. The architecture checker fixtures live here because they build temporary workspace graphs.
- `support/` contains reusable browser/native journey functions and package-publishing fixtures. These were formerly the `*-journey.ts` and `*-fixture.ts` files directly under `tests/`.
- `fixtures/` retains authored module workspaces and seeded product data.
- `e2e/` and `desktop/` retain their stable Playwright locations and runner configuration.

The former root `tests/*.test.ts` files moved to `unit/` or `integration/` using PostgreSQL/API use as the dividing rule. Historical verification documents may cite the old root paths; current runners discover both groups through `tests/**/*.test.ts`.
