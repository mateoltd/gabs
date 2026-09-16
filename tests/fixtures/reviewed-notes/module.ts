import {
  defineModule,
  field,
  operation,
  resource,
  Type,
} from "@suite/module-sdk";
export default defineModule({
  id: "reviewed-notes",
  name: "Reviewed notes",
  version: "1.0.0",
  description: "Independent server deployment acceptance",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  permissions: [
    "reviewed-notes.notes.read",
    "reviewed-notes.notes.write",
    "reviewed-notes.capture",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  resources: {
    notes: resource({ name: field.text({ minLength: 1 }) }, { title: "Notes" }),
  },
  events: { captured: Type.Object({ name: Type.String() }) },
  operations: {
    capture: operation({
      title: "Capture a note",
      permission: "reviewed-notes.capture",
      policy: "online",
      input: Type.Object(
        { name: Type.String(), fail: Type.Optional(Type.Boolean()) },
        { additionalProperties: false },
      ),
      output: Type.Object({ id: Type.String() }),
      errors: Type.Object({ reason: Type.Literal("cancelled") }),
    }),
  },
});
