import { defineModule, resource, field, Type } from "@suite/module-sdk";
export default defineModule({
  id: "custom-notes",
  name: "Custom notes",
  version: "1.0.0",
  description: "Independent executable client acceptance fixture",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: {},
  permissions: ["custom-notes.notes.read", "custom-notes.notes.write"],
  configuration: Type.Object({}, { additionalProperties: false }),
  operations: {},
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
