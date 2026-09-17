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
    orderBy: [{ field: "name", direction: "asc" }],
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
- Without `orderBy`, pages use ascending record ID and retain the existing UUID `nextCursor`. Sorted queries use the opaque cursors described below. Reset the cursor when changing any filter or ordering. Cursors do not provide snapshot isolation: changes to matching records between requests can change the result. Do not treat a paginated read as an authoritative business commitment.

## Typed range filters

Resource lists accept `ranges` alongside equality filters and text search. Each condition combines with AND:

```ts
client.resource("invoices").list({
  ranges: { amount: { gte: 0, lt: 1000 }, dueDate: { lte: "2026-09-30" } },
  where: { approved: true },
  limit: 25,
});
```

This example assumes an authored invoice resource with numeric `amount`, a date-string `dueDate` and boolean `approved`; it does not declare another completed business application. `ResourceRanges<T>` infers supported fields and bound types from that contract. Boolean, object, array and heterogeneous string/number fields have no range operators. Numeric unions and nullable/optional scalar fields retain their underlying scalar kind.

- Up to eight range fields may be combined. Each must have at least one bound: `gt`, `gte`, `lt` or `lte`. Choose at most one lower and one upper operator per field. Reversed or empty intervals fail validation; equal inclusive bounds are valid.
- Every boundary must satisfy the field schema, including numeric limits, integer restrictions, text patterns and date formats. The HTTP endpoint preserves supplied types and rejects unknown fields; the server validates boundaries against the resource contract after authorization. Field names and values are SQL parameters.
- Null and missing values never match a range. Empty text can match a valid string range. Numbers compare numerically; text compares in case-sensitive Unicode code-point order, using PostgreSQL's UTF-8 `C` collation and the matching local comparator. ISO dates therefore follow stored date order. This is not locale-aware sorting or timezone normalization.
- Paging follows the selected ordering, or ascending UUID order by default. Reset the cursor when changing ranges. Range queries do not create snapshots or authorize business commitments.
- Corporate offline pages include the normalized range object in the account/workspace cache key. The same bounds in a different field insertion order reuse a downloaded page; undownloaded combinations remain explicitly unavailable. Empty ranges preserve existing default/equality page keys. Local standalone workspaces evaluate ranges over their encrypted profile records.

`@suite/module-sdk/queries` exposes the shared list validator, local evaluator and scalar range helpers. `TypedResourceRanges` from `@suite/ui-web` provides inferred controls for individual bounds or an inclusive interval, retained invalid input for correction, and removable active ranges with complete accessible descriptions. It composes with `TypedResourceFilters`; both must be outside another HTML form. The generated corporate and standalone views use the same control. Reference/member fields retain equality/picker interactions rather than offering generated character-order ranges.

Nested-property range paths, aggregation, locale collation and complete SDK composition remain tracked.

## Typed sorting and pagination

`orderBy` accepts up to three distinct declared scalar fields in priority order:

```ts
client.resource("invoices").list({
  where: { approved: true },
  ranges: { amount: { gte: 0 } },
  orderBy: [
    { field: "dueDate", direction: "asc" },
    { field: "amount", direction: "desc" },
  ],
  limit: 25,
});
```

`ResourceOrder<T>` infers the sortable field names. Numbers, strings, booleans and their homogeneous nullable/optional unions are supported. Unknown names, duplicate fields, unsupported structured or mixed-type fields, and directions other than `asc`/`desc` fail validation. Text uses the same case-sensitive Unicode order as ranges; booleans order false before true. Null, missing and retained values incompatible with the current scalar kind come last in either direction. Ascending UUID breaks remaining ties.

Sorted pagination records the last row's sort values and ID. A later request can continue after the saved boundary even if that row has been archived or removed. It reads current data: concurrent edits to sort fields can move rows across the boundary, so this is not a snapshot or a basis for a business commitment.

- Corporate `rq1` cursors encrypt and authenticate boundary values, bound to the actor, workspace, module version, resource and normalized query. Changed queries, foreign scopes, corrupt tokens and tokens from a rotated key are rejected. Page size can change while keeping the same boundary. Production instances require the shared `MODULE_QUERY_CURSOR_KEY`; see [operations](operations.md#module-query-cursors).
- Each encrypted cursor also carries an authenticated deterministic query/boundary identity. The generated host uses this identity for downloaded-page cache keys, so fresh random encryption does not orphan an already downloaded next page. The full token is still authenticated by the server; the identity grants no access. Cache records remain account/workspace scoped and subject to current offline leases.
- Standalone `lr1` cursors contain a query-bound local boundary. The host includes profile, module version and resource in the namespace. Simulation includes module version and resource. These local encodings are not corporate authentication tokens and do not conceal local query data. Local records remain protected by profile storage.
- Cursor envelopes are bounded to 24,576 characters. Oversized sort values or local query scopes produce an actionable error; use shorter fields or narrower queries. Empty `orderBy` retains the earlier UUID cursor and default cache format.

`TypedResourceSort` from `@suite/ui-web` provides inferred field choices, direction, up to three priorities, removal, reset and keyboard-operable reordering. Compose it outside another form alongside `TypedResourceFilters` and `TypedResourceRanges`. Generated reference/member fields use their existing pickers and are excluded from generated sort choices. Corporate and standalone views reset pagination on sort changes; local resource/profile changes reset query controls and page history. Invalid cursors offer a first-page recovery action.

This milestone does not implement nested sort paths, locale-specific collations, aggregates, arbitrary schema intersections or performance guarantees for large local datasets. Further resource-client ergonomics and SDK composition remain open.

## Reusable React query state

`useResourceList` from `@suite/ui-web` derives its input and returned record types from a resource client:

```tsx
import { defineView } from "@suite/module-sdk/ui";
import {
  useResourceList,
  TypedResourceTable,
  Button,
  Loading,
  ErrorMessage,
} from "@suite/ui-web";
import module from "../modules/contacts/module";

export default defineView(module, function Customers({ client, online }) {
  const contacts = client.resource("contacts");
  const list = useResourceList(
    contacts,
    {
      where: { relationship: "customer" },
      orderBy: [{ field: "name", direction: "asc" }],
      limit: 25,
    },
    { enabled: online },
  );
  if (list.status === "idle") return <p>Reconnect to read customers.</p>;
  if (list.status === "loading") return <Loading />;
  if (list.status === "error")
    return (
      <>
        <ErrorMessage error={list.error} />
        <Button onClick={list.reload}>Retry</Button>
      </>
    );
  return (
    <>
      <TypedResourceTable
        schema={module.resources.contacts.schema}
        rows={list.page.items}
        label="Customers"
        loadReferences={contacts.loadReferences}
      />
      <Button disabled={!list.hasPreviousPage} onClick={list.previousPage}>
        Previous
      </Button>
      <Button disabled={!list.hasNextPage} onClick={list.nextPage}>
        Next
      </Button>
    </>
  );
});
```

The four result states are discriminated: `page` exists only after `status === "success"`; errors are `unknown` and can be passed to the host error component. Filter values, range/sort fields and returned records retain the resource schema. `ResourceListQuery<T>` omits `cursor`, which the hook owns. It provides `pageNumber`, next/previous availability, `nextPage()`, `previousPage()`, `firstPage()` and `reload()`.

Query conditions can be written inline. Equivalent JSON objects, including different field insertion order, retain the current query; unrelated React renders do not refetch. Changing conditions, resource client or `enabled` resets paging. `reload()` retries the current boundary; `firstPage()` discards page history and reads the first page again. Refresh after a successful mutation explicitly with `list.reload()`.

`client.resource(name)` returns a stable `ResourceClient<Data>` within one module client, including its reference loader. A new host workspace/authorization context receives a different client. Do not cache a client across those host contexts. Existing code that relied on constructing another client object to reload should use an explicit reload or include its own refresh revision in its effect dependencies.

`get(id, { signal })` and `list(query, { signal })` support read cancellation. They reject already-aborted calls before transport and reject cancelled completions even when a transport cannot stop its underlying work. The corporate web host forwards the signal to HTTP. Desktop IPC or other adapters may finish already-dispatched work; cancellation does not undo business mutations.

The hook cancels superseded reads and ignores their completions. It masks the prior result during render when a query/client/enabled context changes, before effects run, and clears records on loading, error or pause. It owns no persistent offline cache and does not silently show old rows as fresh results. A local module can supply its own resource client; mounting independent custom views in standalone workspaces remains separate work. Corporate callers use the host's online/authorization context and existing offline lease rules.

Signed custom views on the current host can import `useResourceList`, `TypedResourceFilters`, `TypedResourceRanges`, `TypedResourceSort`, `Select` and `SelectOption` through the shared UI contract. Supported SDK helpers under `@suite/module-sdk/queries` are also available to their build. Broader host-capability/version compatibility and full UI-kit composition remain tracked.

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

Pass the resource client's stable `.loadReferences` callback to `TypedResourceTable` to resolve annotated links, including tuple slots, map entries, matching union branches and nested objects/arrays. Resource clients are stable within the supplied view client, so they can be used directly during rendering:

```tsx
const records = client.resource("records");
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

[Resource reference fields](module-references.md) now provide recursive CRUD validation and bounded searching in generated forms. Sort controls, complete SDK-04 composition and resource-client ergonomics remain tracked work. These list improvements do not complete the platform or its UI refinement goal.
