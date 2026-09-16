# Editable state in custom module views

The public SDK supports typed, live editable-state transfer between signed custom-view releases. Use it for partially entered form values and view selections that must survive an update. This state stays in the mounted account/workspace/module session. It is not durable offline storage, a committed business record or proof of server acceptance.

## Declare once

Add a state schema and a positive integer version to the view in your module definition:

```ts
views: {
  home: {
    title: "Notes",
    entry: "view.tsx",
    permission: "notes.read",
    state: {
      version: 1,
      schema: Type.Object(
        { name: field.text() },
        { additionalProperties: false },
      ),
    },
  },
}
```

Use the view identifier with `defineView`:

```tsx
export default defineView(module, "home", function Notes({ state, client }) {
  return (
    <Input
      value={state.value?.name ?? ""}
      onChange={(event) => state.save({ name: event.target.value })}
    />
  );
});
```

`state.value` and `state.save` infer their types from that view's schema. Undeclared view identifiers, missing fields and incorrect field types fail compilation. Use a draft schema that permits intermediate editing values; business input still validates independently when submitted. `state.clear()` removes the live checkpoint, for example after confirmed acceptance. Ordinary module clients and permission identifiers remain inferred.

The host validates each save, copies the value and freezes its own snapshot. Values must be JSON, no larger than 64 KiB and at most 32 levels deep. Functions, undefined values, dates, non-finite numbers, cycles and sparse arrays are rejected. State callbacks from a replaced or no-longer-authorized view cannot modify the active checkpoint.

## Version changes

Compatible updates with the same state version and view identifier reuse the snapshot only after validating it against the new signed schema. If the state version or view identifier changes, supply a conversion:

```tsx
export default defineView(module, "home", Notes, {
  restore({ version, value }) {
    if (
      version !== 1 ||
      !value ||
      typeof value !== "object" ||
      !("name" in value) ||
      typeof value.name !== "string"
    )
      throw Error("Unsupported previous input");
    return { title: value.name, category: "Restored input" };
  },
});
```

The return type is inferred from the target schema. A conversion receives the prior view identifier, state version, module release and value. It must be synchronous and should be a pure transformation. Its output is bounded and runtime-validated before the host replaces the old view. A missing conversion, thrown error or invalid result keeps the current view and input. The original snapshot is immutable.

The host preloads the verified candidate and offers **Update and keep input** in the existing update dialog. Replacement waits for active custom-view writes to settle. If the candidate fails its initial render, the host restores the previous executable and checkpoint and reports the failure. A successful first render completes the handoff. Callbacks and requests from an unmounted view remain invalid.

Views without a state declaration continue using the explicit discard-and-update fallback. Only data saved through this contract transfers; arbitrary React state, focus, ongoing computations and external side effects are not automatically serialized. Keep request IDs and uncertain business results in the appropriate operation recovery flow; this editing contract does not establish durable custom-operation recovery.

## Compatibility and verification

Stateful bundles declare `suite-view-v2`; ordinary views keep `suite-view-v1`. Old hosts reject the unsupported bundle format instead of running a view without its state capability. The manifest and executable view identifier/state version must agree, and all executable bytes remain signed. The source-level SDK remains backward compatible with the two-argument `defineView(module, component)`.

See [the editable example](../tests/fixtures/editable-notes/view.tsx), [schema/type and bundle tests](../tests/module-client.test.ts), [browser acceptance](../tests/e2e/module-editor-update.spec.ts) and [native acceptance](../tests/desktop/custom-view-update.spec.ts). Full parity, durable custom-operation recovery and the later UI-refinement goal remain separate acceptance work.
