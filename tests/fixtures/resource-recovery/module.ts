import { defineModule, resource, field, Type } from "@suite/module-sdk";
export default defineModule({
  id: "custom-notes",
  name: "Custom notes",
  version: "1.0.0",
  description: "Host-owned resource recovery acceptance",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: [
    "custom-notes.open",
    "custom-notes.notes.read",
    "custom-notes.notes.write",
  ],
  operations: {},
  resources: {
    notes: resource({ name: field.text({ minLength: 1 }) }, { title: "Notes" }),
  },
  navigation: { path: "/custom-notes", permission: "custom-notes.open" },
});
