# Typed resource lists

Resource clients derive their data and filters from the module schema. The corporate server validates the filter against the active compatible resource contract after checking workspace access, module availability and permissions. Standalone execution and development simulation use the same envelope and field validators.

```ts
import { createModuleClient } from "@suite/module-sdk";
import module from "../modules/contacts/module";

type Client = ReturnType<typeof createModuleClient<typeof module>>;
async function customers(client: Client, cursor?: string) {
  return client.resource("contacts").list({
    where: { kind: "organization", relationship: "customer" },
    search: "Madrid",
    limit: 25,
    cursor,
  });
}
```

## Semantics

- `where` combines up to 16 declared fields with AND. Each value must satisfy that field's schema. Unknown fields and invalid values fail validation.
- Equality compares the **complete field value**. Object key order does not matter; array order and every array element do. This is not JSON containment or a partial nested-object update.
- `false`, `0`, empty text and explicit `null` are distinct. A missing optional field does not match `null`.
- `search` is an additional case-insensitive literal text search over the serialized record, limited to 100 characters. PostgreSQL uses its database locale; the local runtime uses JavaScript casing. This does not promise identical locale-sensitive search across engines.
- `archived: true` selects archived records; active records are the default.
- `limit` is an integer from 1 through 100, default 50. This bound now also applies to standalone lists (previously up to 200).
- Pages are ordered by ascending record ID, with an exclusive `nextCursor`. Reset the cursor when changing any filter. Cursors do not provide snapshot isolation: changes to matching records between requests can change the result. Do not treat a paginated read as an authoritative business commitment.

## Host UI composition

`TypedResourceTable` and `TypedResourceFilters` are public `@suite/ui-web` components. Their schema determines the accepted columns, rows, filter values and custom-cell parameter types; callers do not repeat data interfaces. Filters reuse the schema form, including nullable, numeric, enum, boolean and structured fields. Render the filter component outside another HTML form.

```tsx
import { TypedResourceTable } from "@suite/ui-web";
import type { ResourceRecord, Static } from "@suite/module-sdk";
import module from "../modules/contacts/module";

const schema = module.resources.contacts.schema;
export function Contacts({
  rows,
}: {
  rows: ResourceRecord<Static<typeof schema>>[];
}) {
  return (
    <TypedResourceTable
      schema={schema}
      rows={rows}
      columns={["name", "kind", "relationship"]}
      label="Contacts"
      cells={{ name: (name) => <strong>{name}</strong> }}
    />
  );
}
```

`renderActions` receives the typed record, including its version. `references` can supply labels by field key or escaped data JSON Pointer (for example `/links/0/contactId`). A custom cell renderer owns its output, including an intentional `null`. Default cells distinguish unset/null/empty values, show boolean labels, and use keyboard-operable expandable content for arrays and objects. They do not render JSON as HTML.

### Authorized reference labels

Pass the resource client's stable `.loadReferences` callback to `TypedResourceTable` to resolve annotated links, including tuple slots, map entries, matching union branches and nested objects/arrays. Memoize the resource client from the supplied view client when using it across renders:

```tsx
const records = useMemo(() => client.resource("records"), [client]);
<TypedResourceTable
  schema={module.resources.records.schema}
  rows={page.items}
  label="Records"
  loadReferences={records.loadReferences}
/>;
```

Displayed columns determine lookup scope; custom-rendered columns are excluded. A page deduplicates case-insensitive identifiers by target namespace and runs at most four lookups concurrently. Each lookup asks for the saved identifier explicitly, so labels are not limited to the first choice page. Changing the loader, displayed identifiers or retry attempt cancels the old work and immediately stops rendering its labels. A learned 403/404 or explicit permission/grant denial invalidates every label for that target in the active batch, including later responses already in flight. Other targets continue independently.

The table distinguishes loading, unavailable references and labels missing from the offline cache. Failed requests expose **Retry reference labels**. It never substitutes an older manually supplied label after an authoritative loader has rejected access. The saved identifier remains in the record and in the reference's title; display labels do not authorize a write.

Generated corporate tables use the host's account/workspace cache and existing offline lease. Direct custom-view clients remain online-only. Standalone tables resolve active same-module references through their local worker and page through 50 retained records at a time. Their previous/next navigation follows the same ascending UUID order as resource lists. These reads do not turn local records into company commitments.

`ResourceValue` renders tuples using their positional schemas and typed maps using their property schemas. Its optional `path` and `renderReference(value, path)` allow custom composition; returning `undefined` retains default rendering. An intersection that assigns multiple target namespaces to the same data path displays **Ambiguous reference** rather than choosing an arbitrary label; use a custom cell for such a contract. Invalid retained drafts remain visible but do not generate inferred target requests. Rich intersection presentation remains open.

Reference lookups are per distinct target/identifier, not a new batch server protocol. Very large nested working sets still require performance acceptance. Independent views must retain their current host client/loader; they must not cache labels across authorization contexts. [Table reference acceptance](verification/table-labels/README.md) records the tested scope.

The generated corporate host view uses these components with first/previous/next navigation, a page number, page-size selection and removable equality filters. Search, filters, resource changes and page-size changes reset navigation. Downloaded pages are keyed by account/workspace storage scope and the complete list request. Offline browsing only displays matching downloaded pages, with a distinct message for an uncached query. Previously downloaded pages remain readable for the original default-size unfiltered requests. Filtered queries and other page sizes cannot reuse those pages. Drafts and pending operations are unchanged.

[Resource reference fields](module-references.md) now provide recursive CRUD validation and bounded searching in generated forms. Richer sort/range controls, complete SDK-04 composition and resource-client ergonomics remain tracked work. These list improvements do not complete the platform or its UI refinement goal.
