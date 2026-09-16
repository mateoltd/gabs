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

Draft creation copies validated explicit defaults, literal values, required objects, empty arrays and false booleans. It does not invent quantities, dates or resource identifiers. Optional fields without defaults remain absent. Tuple positions, nested field values and field-order keys retain their inferred types.

## Supported editors

- Text, long text, numbers, integers and booleans use host controls. Dates use the declared date pattern or format; field names do not choose the input type.
- Literal choices retain their original value types, including zero, false and empty text.
- Nested objects have grouped labels. Optional objects can be added and removed explicitly.
- Homogeneous arrays provide bounded add/remove controls and recursive item editors. Required minimums and maximums remain subject to complete schema validation.
- Nullable unions have an explicit null choice. Other unions offer a branch selector; changing the branch starts a fresh branch draft.
- Records, tuples, intersections and other schemas without a dedicated editor use a validated JSON field. Invalid raw input stays visible while unrelated fields are edited. It blocks native form submission and reports invalidity through `onValidityChange`.
- Reference options can be provided by JSON Pointer path; the legacy top-level field key remains supported. Automatic recursive lookup and inferred reference authoring are still tracked under SDK-04.

`SchemaForm` is the dynamic host equivalent for transported schemas. `TypedSchemaForm` adds schema-inferred authoring checks for custom views. The complete schema must be an object. Set `validate` to expose field issues and an accessible summary. Actions outside a native `<form>` must honor `onValidityChange` to avoid submitting a previously valid value while a JSON buffer is invalid.

Custom views use the host UI kit inside their declared Shadow DOM container. Control popovers stay in that container and inherit its styles. This is style containment for reviewed official modules, not a hostile-code security boundary.

The fixture in `tests/fixtures/schema-editor` exercises the public imports without host module registries or duplicated input interfaces. SDK-04 also covers generated tables, filtering, pagination, documentation generation and wider composability; this form milestone does not complete those gates.
