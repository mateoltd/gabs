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

`renderActions` receives the typed record, including its version. `references` can supply labels by field key. A custom cell renderer owns its output, including an intentional `null`. Default cells distinguish unset/null/empty values, show boolean labels, and use keyboard-operable expandable content for arrays and objects. They do not render JSON as HTML.

The generated corporate host view uses these components with first/previous/next navigation, a page number, page-size selection and removable equality filters. Search, filters, resource changes and page-size changes reset navigation. Downloaded pages are keyed by account/workspace storage scope and the complete list request. Offline browsing only displays matching downloaded pages, with a distinct message for an uncached query. Previously downloaded pages remain readable for the original default-size unfiltered requests. Filtered queries and other page sizes cannot reuse those pages. Drafts and pending operations are unchanged.

Recursive reference discovery, searching beyond the first reference page, richer sort/range controls and the complete SDK-04 composition acceptance remain tracked work. These list improvements do not complete the platform or its UI refinement goal.
