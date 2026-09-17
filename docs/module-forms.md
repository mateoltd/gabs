# Schema-driven module forms

Module contracts remain the source for values and runtime validation. Custom React views can use `TypedSchemaForm` from `@suite/ui-web` and draft helpers from `@suite/module-sdk/forms`:

```tsx
const schema = module.resources.contacts.schema;
const [draft, setDraft] = useState(() => createSchemaDraft(schema));
const [valid, setValid] = useState(false);

<TypedSchemaForm
  schema={schema}
  value={draft}
  onChange={setDraft}
  onValidityChange={setValid}
  validate={showErrors}
/>;

const parsed = parseSchemaInput(schema, draft);
if (valid && parsed.ok) {
  await client.resource("contacts").create(parsed.value);
}
```

`SchemaDraft<Static<typeof schema>>` allows incomplete fields, nested objects and array items. It does not replace the complete operation or resource type. `parseSchemaInput` returns either a cloned schema-validated value or JSON Pointer paths and messages. Validation uses the SDK's TypeBox schema hydration, including serialized module contracts. The server still checks the schema, permissions and business rules.

Draft creation copies validated explicit defaults, literal values, required objects, empty homogeneous arrays, fixed tuple positions and false booleans. It does not invent quantities, dates or resource identifiers. Optional fields without defaults remain absent. Tuple positions, nested field values and field-order keys retain their inferred types.

## Supported editors

- Text, long text, numbers, integers and booleans use host controls. Dates use the declared date pattern or format; field names do not choose the input type.
- Literal choices retain their original value types, including zero, false and empty text.
- Nested objects have grouped labels. Optional objects can be added and removed explicitly.
- Homogeneous arrays provide bounded add/remove controls and recursive item editors. Required minimums and maximums remain subject to complete schema validation.
- Nullable unions have an explicit null choice. Other unions offer a branch selector; changing the branch starts a fresh branch draft.
- Fixed tuples render a recursive editor for each declared position, including resource-reference pickers. Positions retain their order; existing extra values remain available for explicit JSON review.
- Record maps and typed additional properties provide explicit add, rename and remove controls, preserving values on rename. Keys must match the declared property patterns; duplicate keys, declared-field collisions and the transport-reserved `__proto__` key are refused. Property-count bounds govern the controls and complete schema validation. Pending key edits block submission until applied or canceled with Escape.
- Maps and tuples offer an explicit JSON editor. Intersections and other schemas without a dedicated editor use validated JSON. Invalid raw input stays visible while unrelated fields are edited and blocks submission. **Discard JSON edits** returns to the last parsed value; it does not silently accept invalid input. Variadic tuple authoring and specialized intersection editors remain outside this milestone.
- Reference options can be provided by JSON Pointer path; the legacy top-level field key remains supported. Pass the typed resource client's `.loadReferences` to `loadReferences` for recursive authorized lookup, including tuple and map values. See [reference contracts and limits](module-references.md).

`SchemaForm` is the dynamic host equivalent for transported schemas. `TypedSchemaForm` adds schema-inferred authoring checks for custom views. The complete schema must be an object. Set `validate` to expose field issues and an accessible summary. Actions outside a native `<form>` must honor `onValidityChange` to avoid submitting a previously valid value while a JSON buffer is invalid.

`objectPropertySchema(schema, key)` resolves fixed properties, every matching property pattern and additional-property value schemas. Overlapping matches retain all constraints through an intersection. It returns `undefined` when the key is undeclared and additional properties are forbidden. It resolves value contracts, not transport authorization; raw JSON still passes through the server’s protected JSON parser.

Custom views use the host UI kit inside their declared Shadow DOM container. Control popovers stay in that container and inherit its styles. This is style containment for reviewed official modules, not a hostile-code security boundary.

The fixture in `tests/fixtures/schema-editor` exercises the public imports without host module registries or duplicated input interfaces. SDK-04 also covers generated tables, filtering, pagination, documentation generation and wider composability; this form milestone does not complete those gates.

[Tuple and map acceptance](verification/map-tuple/README.md) covers the independent development/custom-view fixture and offline generated forms.
