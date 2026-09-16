# Module development preview

```sh
pnpm module dev contacts
pnpm module dev ./path/to/module
```

The command prints a loopback URL, normally `http://127.0.0.1:4321`. Set `MODULE_DEV_PORT` to select a different port. An independent directory needs no catalog, navigation or host edits.

## Authoring loop

The workspace checks the module's own TypeScript graph, validates fixture/configuration schemas and dependency compatibility, and builds custom React views with the same public bundle builder used for module releases. Views share the host React instance and public UI kit. Choose any manifest-declared view from the preview selector; styles stay in the existing Shadow DOM container.

Put resource examples in `fixtures.json`. Put development configuration in `configuration.json`, matching the module's configuration schema. If the module has custom server operations, supply a scoped `module-server.ts` matching that exact definition. Missing configuration, incompatible dependencies, invalid fixtures and type/bundle errors appear in the workspace. Fixing the source rebuilds it automatically, including recovery from a failed initial build.

Changes to module sources, custom TSX, CSS, JSON fixtures and configuration trigger a fresh simulator process and page reload. **Every rebuild resets simulated data, permissions, connectivity and unsaved view state.** This is automatic reload, not state-preserving React Fast Refresh. Tests and authored scenarios remain separate commands; see [module scenarios](module-scenarios.md).

## Exercising behavior

- Custom views receive the typed client, simulated account/workspace, connectivity and permission checks through `defineView`. Resource calls and custom scoped operations execute in the isolated simulator. Declared business rejections retain their typed error envelope for `client.attempt`.
- Stateful views receive the declared `state` capability. Values are schema-validated and retained during ordinary preview renders, then cleared by `state.clear` or a rebuild. A mismatched executable/state contract fails visibly.
- The permission controls change simulated actor permissions. Removing a view's permission hides it; operation/resource permissions are checked again when the request executes.
- Preview requests use immediate simulated server execution. Offline mode disables or rejects those requests. Use the generated resource/operation inspector to capture provisional queued work, reconnect and synchronize; accepted records and the journal remain distinct.
- Build failures hide the previous workspace and block requests. Render failures stay within the preview boundary. Fixing the source restores the preview. Requests from an earlier build cannot mutate the replacement simulator.

The local host preserves same-origin/Host validation, strict input schemas, a 64 KB action limit and revision checks. Build execution is limited to 120 seconds and requests to 30 seconds. An unresponsive module is terminated without blocking the HTTP host. Authored server code is trusted developer code, not sandboxed publisher code; previewing a module is not a signing or publication decision.

## Current boundaries

The preview uses the host's light UI styles. Application theme/archetype certification remains separate work. The simulator supports generated resources and resource-based scoped operations; private stores, corporate audits and cross-module service fixtures remain unsupported. Current development dependency metadata comes from the reviewed catalog; explicit external provider fixtures are the next SDK-03 milestone. Standalone worker execution, durable offline recovery, corporate permission/grant correctness and transactional database acceptance still require their actual host tests. No corporate workspace or production database is used by this simulator.
