# Generated module references

`pnpm module docs` generates a reference directly from `module.ts`. It checks the module's TypeScript graph and fixtures first; it does not need signing keys, a database, or host registry edits.

```sh
# Print Markdown to standard output.
pnpm module docs contacts

# Write a new reference. Existing files are protected by default.
pnpm module docs ./path/to/module reference.md

# Fail when a committed reference no longer matches the contract.
pnpm module docs ./path/to/module reference.md --check

# Replace the reference after reviewing a contract change.
pnpm module docs ./path/to/module reference.md --update
```

The same renderer runs during `pnpm module build`, producing `.local/modules/<id>-<version>.md` alongside the signed package. Build documentation and the separate docs command use the same contract data and output format. There are no generated timestamps, so identical contracts produce identical references.

The public function is also available to authoring tools:

```ts
import { renderModuleDocumentation } from "@suite/module-sdk/documentation";
import module from "./module";

const markdown = renderModuleDocumentation(module);
```

## Reference coverage

- Release identity, publisher, host/backend compatibility and dependencies.
- Permissions, resource policies, standalone support, append-only behavior and default columns.
- Configuration, nested record fields, array items, union/intersection branches, optional values, defaults, constraints, resource references and membership references.
- Operation inputs, outputs, declared business errors, read-only queries, execution policies and public/service-only boundaries.
- Consumed service aliases, exact provider contract versions, dependency ranges and explicit grant requirements.
- Events, audit actions, private store schemas and unique fields.
- Corporate and local storage contracts, supported schema versions and forward migration declarations.
- Custom views, navigation, permission requirements and versioned retained view-state schemas.
- TypeScript usage examples whose inputs derive from the actual resource/operation/service contract.

Schema tables are a readable index. Every schema also appears in a JSON block so additional annotations and nested constraints are retained. Property paths escape `~` and `/`; array wildcards and branch labels are explained in each reference. Publisher descriptions are escaped as text, and code fences adapt to backticks inside metadata.

References contain contract metadata, including declared defaults. They do not read runtime configuration values, credentials or fixtures into the output. Documentation is not an entitlement, readiness check or proof that a module implements its declared behavior. Use `module check`, module-owned scenarios and the platform acceptance gates for those separate checks.

`--check` compares the generated reference exactly. Formatting or hand editing a generated reference will cause drift; keep additional narrative in a separate document. Schema-derived table/filter/pagination behavior and recursive reference authoring remain separate SDK-04 work.
