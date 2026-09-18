import {
  defineModule,
  resource,
  field,
  operation,
  Type,
} from "@suite/module-sdk";
export default defineModule({
  id: "custom-notes",
  name: "Custom notes",
  version: "1.0.0",
  description: "Independent executable client and server acceptance fixture",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: {},
  permissions: [
    "custom-notes.notes.read",
    "custom-notes.notes.write",
    "custom-notes.capture",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  operations: {
    names: operation({
      kind: "query",
      title: "Read notes",
      policy: "online",
      permission: "custom-notes.notes.read",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Array(Type.String()),
    }),
    capture: operation({
      title: "Save note",
      policy: "queued",
      permission: "custom-notes.capture",
      input: Type.Object(
        { name: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      output: Type.Object({ id: Type.String() }),
      errors: Type.Object({ reason: Type.Literal("rejected") }),
    }),
  },
  resources: {
    notes: resource({ name: field.text({ minLength: 1 }) }, { title: "Notes" }),
  },
  views: {
    home: {
      title: "Custom notes workspace",
      entry: "view.tsx",
      stylesheet: "view.css",
      permission: "custom-notes.notes.read",
    },
  },
  navigation: {
    path: "/custom-notes",
    permission: "custom-notes.notes.read",
    view: "home",
  },
});
