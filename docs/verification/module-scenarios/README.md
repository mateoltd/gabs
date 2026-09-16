# SDK-03: module-owned scenario CLI

16 September 2026. First SDK-03 milestone; the row remains active for custom React preview and cross-module fixtures.

## Implemented

- `@suite/module-sdk/scenarios` exposes `defineModuleScenarios` with an inferred module client, fixtures and configuration. Each named scenario receives a fresh simulator. A mismatched scoped server contract is rejected.
- `module check` and `module test` accept an independent directory and explicit dependency directories. They check the module's source graph, including scenario/custom view files, fixture data, compatibility and custom client bundles without adding the module to the host catalog.
- `module test` executes the selected module's scenarios in a child process, reports named results and assertion stacks, and returns nonzero for failures, missing/empty scenarios or a stuck process. The process has a 120-second execution limit. It no longer runs a generic host SDK test in place of authored scenarios.
- `module create` generates two working examples. Contacts owns scenarios covering an offline permission revocation and a stale edit that must preserve the accepted record.

## Observed acceptance

- Strict TypeScript, module/browser boundary checks and UI-copy rules passed.
- Eight focused tests passed across `module-scenarios.test.ts`, `module-cli.test.ts` and `module-simulator.test.ts`. This includes fixture/network/permission/receipt isolation after a failing scenario, named failure reporting, mismatched backend rejection, existing offline journal behavior and compile-time rejection of invalid resource names, required fields, enum values and fixtures.
- The CLI acceptance test creates an independent module outside the catalog and executes its actual scenario. Changing its assertion, introducing a type error, removing the scenario file and corrupting its fixtures each fail. A missing provider fails compatibility; explicitly supplying its directory succeeds. The catalog remains byte-for-byte unchanged.
- `pnpm module test contacts` passes both module-owned scenarios through the actual CLI.
- A temporary module created with `module create` passes both generated scenarios through `module test`. Cleanup restores all three generated catalogs exactly; no fixture module remains in the checkout.
- No application UI changed and no browser or desktop test was launched for this tooling checkpoint. The earlier 155-test/full-build/browser/native baseline remains historical, not a claim of a newly repeated full suite.

Logs for this session: `/tmp/gabs-scenarios-types.log`, `/tmp/gabs-scenarios-lint.log`, `/tmp/gabs-scenarios-tests.log`, `/tmp/gabs-scenarios-dependency-test.log`, `/tmp/gabs-scenarios-contacts.log`, `/tmp/gabs-scenarios-scaffold.log`.

## Remaining scope

Custom React preview, source/fixture hot reload improvements and cross-module fixtures remain SDK-03 acceptance. The simulator still excludes private stores and corporate audit/service execution. It does not substitute for authoritative server, persistent offline, native or release acceptance. [Authoring guide](../../module-scenarios.md). Full parity and the later UI refinement goal remain open.
