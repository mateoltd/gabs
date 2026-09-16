import { defineModule, operation, store, field, Type } from "@suite/module-sdk";
export default defineModule({
  id: "preview-provider",
  name: "Preview provider",
  version: "1.0.0",
  description: "Independent development provider",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object(
    { prefix: Type.String() },
    { additionalProperties: false },
  ),
  permissions: ["preview-provider.write"],
  resources: {},
  stores: { entries: store({ name: field.text() }, { unique: ["name"] }) },
  audit: ["recorded"],
  events: { recorded: Type.String() },
  operations: {
    record: operation({
      title: "Record",
      permission: "preview-provider.write",
      policy: "online",
      public: true,
      serviceOnly: true,
      input: Type.Object(
        { name: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      output: Type.String(),
    }),
  },
});
