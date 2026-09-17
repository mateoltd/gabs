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
- `ReferenceQuerySchema`, `ReferenceOptionSchema`, `ReferencePageSchema`, their inferred types and target/value types.
- `createReferenceLoader(schema, lookup)`: bind a lookup to targets declared by a resource schema, without a React dependency.

Traversal covers nested properties, homogeneous arrays, tuples, pattern/additional-property maps, nullable fields, intersections and matching union branches. Null and absent values are skipped. A free-text branch is not treated as a link unless it also matches a reference-bearing branch. JSON pointers escape `~` and `/`. Unsupported transported schema constructs still fail explicitly. JSON validation uses own properties, so an omitted field named `constructor` cannot read from JavaScript's object prototype.

## Authorized lookup

The versioned corporate endpoint is:

`GET /api/v1/module/{moduleId}/workspaces/{workspaceId}/references/{resource}`

Use the public module client in generated or custom views. Resource names are inferred from the module definition; requests validate the declared schema pointer and bounded query, and responses validate the shared page schema. The installed source release is carried in `moduleVersion`.

```tsx
const tasks = client.resource("tasks");
const page = await tasks.references(
  { field: "/properties/reviewers/items", search: "Alex", limit: 25 },
  { signal: controller.signal },
);

<TypedSchemaForm
  schema={module.resources.tasks.schema}
  value={draft}
  onChange={setDraft}
  loadReferences={tasks.loadReferences}
/>;
```

`client` is the typed client supplied to an independent view. External host applications can obtain it through `suiteClient.module(module, workspaceId)`. A scoped server query can use `ctx.resource("tasks").references(...)` through the same public contract. Lookup is a read: it does not create journal entries, idempotency receipts or audit effects. Cancellation propagates through the host adapter, and an aborted response is discarded.

The adapter uses operation `moduleReferences` and these query parameters:

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

`SchemaForm`, `TypedSchemaForm` and `TypedResourceFilters` accept a typed `loadReferences` callback. `ReferencePicker` and `ReferenceLoader` are public exports of `@suite/ui-web`; the loader type is defined by the SDK. The callback receives a declared target, bounded query and abort signal; it returns a reference page. The resource client's bound loader can be passed directly to these controls. Client, server and local package builders accept the public `@suite/module-sdk/references` helpers. Static `referenceOptions` remain supported.

With offline storage enabled and a valid corporate lease, the host remembers at most 200 recently used labels per source module version/resource/target in account/workspace-scoped storage. Offline pickers search only downloaded labels and say so. An undownloaded label does not erase its UUID. No entire member directory is fetched. These label bounds do not complete general working-set management or freshness controls.

## Standalone and development lookup

Generated standalone forms use the local worker client. Lookup reads active targets from the same installed module's standalone resources in the current unlocked profile. It never falls back to a corporate database or another profile. Corporate membership has no local directory, and cross-module local lookup explicitly fails until a scoped host broker exists. These reads do not rewrite the encrypted profile or create receipts.

The development simulator implements the same paging, selected-item resolution and label rules. Member fixtures must be supplied explicitly. Cross-module lookup requires a loaded compatible dependency, a `readGrants` fixture and current target read permission. The development workspace exposes these grants alongside service grants in **Module grants and provider permissions**. See [reference fixtures](module-scenarios.md#reference-fixtures). Corporate simulation rejects offline lookup rather than placing it in the journal.

### Write integrity

Standalone resource creates and updates validate every present annotated link against active same-module targets in the current local transaction. Nested arrays, maps and matching union branches use the same schema traversal as corporate writes. A target created earlier in an operation is available to later writes. A failed reference check rejects the operation even if its handler catches the error; no partial records or new receipt are committed.

The simulator performs equivalent checks using its current fixtures, permissions, member state and explicit read grants. Offline capture remains provisional: validation happens when the simulated server accepts the queued request, and one rejected reference does not prevent unrelated entries from synchronizing.

Ordinary edits revalidate all present links, including unchanged ones. If a target has since been archived, remove or replace its link before saving. Archiving a target does not delete historical records that reference it. An exact retry of an already accepted request returns its saved receipt; it does not create a second write or revalidate historical success. Migration reconciliation is a separate contract.

### Standalone migrations

Before committing an installation, the worker validates final reference values in all retained records, including archived rows. Targets created later in the migration are available at this final check; newly referenced targets archived before completion are rejected. The original record, resource, field path, target namespace and UUID identify a historical link. Unchanged links can therefore survive target archival, while copying a link to another record/position, renaming its source resource, changing its annotation or introducing a new link requires a valid final target.

The profile host passes the previous installed release to the worker, which verifies its signed artifact or matches an official bundled contract. The source must match the module and stored schema compatibility. Missing source evidence or source records invalid under that contract provide no historical exemption. Intermediate migration writes cannot establish one. Pure SDK callers of `migrateLocalSnapshot` may pass an already verified source contract as the optional fifth argument; that argument is not itself a signature verifier.

Compatible reinstallations and executable rollbacks also validate final references. Failures preserve the previous installation, records, schema and receipts; the existing installation history and discard/retry controls apply. See [standalone migration acceptance](verification/local-migration-references/README.md).

## Current limits

- Generated object, homogeneous-array, fixed-tuple and record-map editors use recursive pickers. Typed additional properties use the same lookup. Map renames preserve reference values and update escaped data paths. Complex intersections retain validated JSON editing; specialized controls for every schema construct remain open. See [tuple and map acceptance](verification/map-tuple/README.md).
- Public, generated corporate and same-module standalone tables now resolve nested/off-page labels through the authorized loader, with deduplication, cancellation, denial invalidation and explicit missing-cache states. See [table acceptance](verification/table-labels/README.md). Ambiguous multi-target intersections require a custom cell; broad composition and performance acceptance remain open.
- Resource CRUD and [recursive migration reconciliation](module-storage-migrations.md) are covered. Migrations compare final records with their original signed contract and validate new links before committing. Operation inputs/private stores do not acquire reference semantics solely from these annotations.
- Pagination is not a snapshot. Archiving or revocation after lookup can cause a subsequent write to be rejected.
- Corporate independent views currently require an online lookup; the generated host's leased label cache is not automatically supplied to arbitrary custom views.
- Cross-module local lookup and custom standalone view mounting remain open. Same-module standalone generated pickers are covered.
- In-memory simulation does not establish real corporate authorization, SQL isolation or concurrency. Local migration reconciliation is validated in the worker/profile lifecycle; it does not implement corporate import or cross-module local capabilities.
- Broader SDK composition, accessibility acceptance and platform parity remain open.
