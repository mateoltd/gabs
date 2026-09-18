# Module development preview

```sh
pnpm module dev contacts
pnpm module dev ./path/to/module --dependency ./path/to/provider
```

The command prints a loopback URL, normally `http://127.0.0.1:4321`. Set `MODULE_DEV_PORT` to select a different port. An independent directory needs no catalog, navigation or host edits.

Use [typed resource lists](module-resource-lists.md), [typed schema forms](module-forms.md) in custom views and [generated module references](module-documentation.md) to review schemas, permissions, services and compatibility. `pnpm module docs <module-id-or-directory>` prints the complete reference without requiring a signed build.

## Authoring loop

The workspace checks the module's own TypeScript graph, validates fixture/configuration schemas and dependency compatibility, and builds custom React views with the same public bundle builder used for module releases. Views share the host React instance and public UI kit. Choose any manifest-declared view from the preview selector; styles stay in the existing Shadow DOM container.

Put resource examples in `fixtures.json`. Put development configuration in `configuration.json`, matching the module's configuration schema. If the module has custom server operations, supply a scoped `module-server.ts` matching that exact definition. Missing configuration, incompatible dependencies, invalid fixtures and type/bundle errors appear in the workspace. Fixing the source rebuilds it automatically, including recovery from a failed initial build.

Repeat `--dependency` for each external provider directory. The host loads its exact scoped backend, development configuration and fixtures. A provider is never granted access merely because it is loaded. Add explicit grants in `module.simulation.ts` as described in [cross-module fixtures](module-scenarios.md#cross-module-fixtures). The preview exposes per-service grants, reference read grants, provider permissions, private stores and a simulated audit trail. [Reference fixtures](module-scenarios.md#reference-fixtures) supply member choices and exercise authorized pickers through the public client.

Changes to root or provider module sources, custom TSX, CSS, typed/JSON fixtures and configuration trigger a fresh simulator process and page reload. **Every rebuild resets simulated data, permissions, connectivity and unsaved view state.** This is automatic reload, not state-preserving React Fast Refresh. Tests and authored scenarios remain separate commands; see [module scenarios](module-scenarios.md).

## Exercising behavior

- Custom views receive the typed client, simulated account/workspace, connectivity and permission checks through `defineView`. Resource calls and custom scoped operations execute in the isolated simulator. Declared business rejections retain their typed error envelope for `client.attempt`.
- Views also receive the inferred `host` client. The host capability simulator validates declarations, current simulated permissions, connectivity, release identity and configured result schemas. It never invokes device adapters. Edit a result in the inspector or provide typed `hostResults` in `module.simulation.ts`; see [host fixtures](module-scenarios.md#host-capability-fixtures).
- Stateful views receive the declared `state` capability. Values are schema-validated and retained during ordinary preview renders, then cleared by `state.clear` or a rebuild. A mismatched executable/state contract fails visibly.
- The permission controls change simulated actor permissions. Removing a view's permission hides it; operation/resource permissions are checked again when the request executes.
- Preview requests use immediate simulated server execution. Offline mode disables or rejects corporate server requests; explicitly leased host actions use the separate allowance controls. Use the generated resource/operation inspector to capture provisional queued work, reconnect and synchronize; accepted records and the journal remain distinct.
- Build failures hide the previous workspace and block requests. Render failures stay within the preview boundary. Fixing the source restores the preview. Requests from an earlier build cannot mutate the replacement simulator.

The local host preserves same-origin/Host validation, strict input schemas, a 64 KB action limit and revision checks. Build execution is limited to 120 seconds and requests to 30 seconds. An unresponsive module is terminated without blocking the HTTP host. Authored server code is trusted developer code, not sandboxed publisher code; previewing a module is not a signing or publication decision.

Host actions have separate simulated/rejected observations, bounded to the latest 100 calls. The log omits input content and relay payloads. These observations do not create business records, journal entries, emitted events or corporate audit records. A configured successful reply is a test fixture, not proof that a file was written, a notification delivered or an authorized peer contacted. Invalid result edits preserve the previous valid fixture. JSON `null` resets the inspector's result to its default; relay has no default success. Source reload clears observations and restores file-based fixtures.

## Corporate lease controls

Select a capability declaring `offline: "lease"` in the host inspector to reveal its current allowance, duration and renewal/revocation controls. Renewal requires the simulated server to be online and the capability/view permissions to be present. Advance the simulated clock to test expiry without waiting. The current allowance and clock are visible; recent actions distinguish online and leased results.

Permission changes invalidate known allowances. Re-enabling a permission requires explicit renewal before offline use. Source reload restores `hostLeases` from `module.simulation.ts`, clears observations and resets the clock. Invalid aliases/durations and requests from a previous source revision are rejected. The inspector never creates signed credentials or performs device effects. See [typed fixtures and delayed-action scenarios](module-scenarios.md#corporate-offline-lease-scenarios).

## Current boundaries

The preview uses the host's light UI styles. Application theme/archetype certification remains separate work. The simulator supports generated resources, scoped operations, private store CRUD/query/aggregation, declared cross-module services and a development audit trail. Cross-module records, emitted events and audits roll back together on failure, including caught or detached capability failures. Query handlers cannot write or lock records. Transactions are serialized in memory; PostgreSQL isolation, locale/numeric behavior and real corporate audit storage are outside this simulation. Standalone worker execution, durable offline recovery, corporate permission/grant correctness and transactional database acceptance still require their actual host tests. No corporate workspace or production database is used by this simulator.
