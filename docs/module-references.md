# Resource reference fields

Declare record links and workspace members in the resource schema. Corporate resource writes validate present references recursively, after validating the record and checking its source permission. A value is a UUID, not a client-supplied label or role.

```ts
import { field, resource, Type } from "@suite/module-sdk";

const tasks = resource({
  title: field.text({ minLength: 1 }),
  reviewers: Type.Array(field.member()),
  links: Type.Array(
    Type.Object({ contact: field.reference("contacts", "contacts") }),
  ),
});
```

Cross-module references require a declared dependency, the actor's current read permission on the target resource, an available target module and an explicit administrator read grant. Membership references resolve only active members whose user accounts are active in the current workspace. Record references resolve only active records in the declared module/resource and current workspace. UUID comparisons are case-insensitive. Duplicate identifiers are checked once and large collections are queried in batches of 500.

## Schema traversal

`@suite/module-sdk/references` exports:

- `referenceFields(schema)`: declared targets and JSON pointers into the schema, including inactive union branches. For example, an array's contact field has a path such as `/properties/links/items/properties/contact`.
- `referenceValues(schema, data)`: validates the complete record and returns present links with both schema pointers and data pointers, such as `/links/0/contact`.
- `referenceTarget(schema)` and `referenceTargetKey(target)`: normalize member/resource annotations and identify a target.
- `ReferenceQuerySchema`, its inferred `ReferenceQuery`, `ReferenceOption`, `ReferencePage` and target/value types.

Traversal covers nested properties, homogeneous arrays, tuples, pattern/additional-property maps, nullable fields, intersections and matching union branches. Null and absent values are skipped. A free-text branch is not treated as a link unless it also matches a reference-bearing branch. JSON pointers escape `~` and `/`. Unsupported transported schema constructs still fail explicitly. JSON validation uses own properties, so an omitted field named `constructor` cannot read from JavaScript's object prototype.

## Authorized lookup

The versioned corporate endpoint is:

`GET /api/v1/module/{moduleId}/workspaces/{workspaceId}/references/{resource}`

Use operation `moduleReferences` through `SuiteClient`, with the installed source release in `moduleVersion`. Query parameters:

| Parameter  | Meaning                                                           |
| ---------- | ----------------------------------------------------------------- |
| `field`    | Required schema pointer from `referenceFields`                    |
| `search`   | Literal, case-insensitive label search, up to 100 characters      |
| `cursor`   | Exclusive ascending UUID cursor                                   |
| `limit`    | 1–100, default 25                                                 |
| `selected` | Optional saved UUID to resolve independently of search and paging |

The result contains `items: { value, label }[]`, `nextCursor` and, when requested, `selected` (an option or `null`). Labels use a nonempty string `name`, then `title`, then the ID. Member labels use the member's name. Responses contain labels and identifiers, not full records or user details. The server checks both the source and target read permissions, module availability, storage compatibility, dependencies and grants on each call. Clients cannot substitute an arbitrary target module or field. Search does not grant access, and lookup success does not bypass validation when saving.

## Generated and custom forms

Generated corporate forms and equality-filter editors resolve annotated fields through `ReferencePicker`. Each picker uses 25 choices per page. Expand **Find [field]** to search or page; the saved selection remains visible even when outside the result page. Requests are cancellable, search is debounced, failures offer retry, and optional links can be cleared. A missing selected record is shown explicitly rather than silently clearing the saved UUID.

`SchemaForm`, `TypedSchemaForm` and `TypedResourceFilters` accept a typed `loadReferences` callback. `ReferencePicker` and `ReferenceLoader` are public exports of `@suite/ui-web`. The callback receives a declared target, bounded query and abort signal; it returns a reference page. The independent view bundler accepts reference helpers and these public UI exports. Static `referenceOptions` remain supported for existing custom/local forms. The corporate generated host supplies the authorized adapter. An independently installed custom view does not yet receive a scoped lookup capability automatically; that adapter and standalone/development parity remain tracked work.

With offline storage enabled and a valid corporate lease, the host remembers at most 200 recently used labels per source module version/resource/target in account/workspace-scoped storage. Offline pickers search only downloaded labels and say so. An undownloaded label does not erase its UUID. No entire member directory is fetched. These label bounds do not complete general working-set management or freshness controls.

## Current limits

- Generated object and homogeneous-array editors use recursive pickers. Tuple and record-map fields retain the structured JSON editor; their references are validated server-side, but per-item picker UI remains open.
- Tables use known top-level labels; resolving every nested or off-page table label remains open.
- Resource CRUD and [recursive migration reconciliation](module-storage-migrations.md) are covered. Migrations compare final records with their original signed contract and validate new links before committing. Operation inputs/private stores do not acquire reference semantics solely from these annotations.
- Pagination is not a snapshot. Archiving or revocation after lookup can cause a subsequent write to be rejected.
- Broader SDK composition, standalone/custom capability integration, accessibility acceptance and platform parity remain open.
