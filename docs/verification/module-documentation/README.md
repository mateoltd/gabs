# SDK-04: schema-derived module references

17 September 2026. This closes the documentation-generation portion of SDK-04. Generated tables, filtering/pagination, recursive reference handling and broader composability remain active.

## Delivered behavior

`@suite/module-sdk/documentation` renders a deterministic Markdown reference from `ModuleDefinition`. `pnpm module docs` typechecks a module's own graph and validates fixtures before printing or writing its reference. Existing files require an explicit update; `--check` fails on drift and gives a regeneration instruction. The normal signed build uses the same renderer for its accompanying Markdown file.

Coverage includes release/dependency compatibility, permissions, configuration, nested resource schemas, operations and typed errors, service aliases/provider contracts/grants, events, audit actions, private stores, independent corporate/local storage evolution, navigation and retained custom-view state. A contents list navigates major sections. Exact JSON blocks preserve schema details beyond the readable field tables. Publisher prose is escaped and code fences adapt to embedded backticks.

Generated TypeScript examples import inferred public types. They do not redeclare resource DTOs or copy operation/service input interfaces. Service-only operations do not receive direct client examples, and consumer aliases use the consumer's declared service types.

## Verification

- Strict TypeScript, dependency boundaries and UI-copy checks passed.
- 20 focused tests passed across `module-documentation`, `module-cli` and `module-sdk`. After final navigation and escaping review, all five documentation tests passed again.
- Generated examples for Contacts, Projects, Orders, Inventory and an independent service consumer typechecked together against their actual definitions. Resource clients, commands, queries, typed-error attempts and consumed service aliases were covered.
- All four business-module references preserved their complete configuration/resource/operation/error/event/store/service schemas. Rendering source and serialized definitions produced identical output without modifying the definitions.
- An independent temporary module exercised stdout, creation, overwrite protection, drift detection, explicit regeneration, invalid flags, invalid TypeScript rejection and a signed build. Its build reference equaled CLI output exactly; the host catalog was unchanged. Temporary signing keys and generated files were removed.
- Escaping and round-trip checks covered arbitrary property names, HTML/link-like prose, embedded code fences, false/null defaults, nested arrays/unions, membership/resource references and retained view-state schemas.
- Actual `pnpm module docs contacts` and `pnpm module docs orders` output was generated and inspected locally; the Orders drift check passed. All four application builds passed.

No application interface or desktop behavior changed, so browser/native suites were not rerun for this tooling milestone. Documentation describes declared contracts; it does not prove readiness, entitlement, runtime business behavior or the remaining full-product gates.

See the [authoring guide](../../module-documentation.md), [generator](../../../packages/module-sdk/src/documentation.ts) and [acceptance tests](../../../tests/module-documentation.test.ts).
