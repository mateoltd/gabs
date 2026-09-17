import {
  capability,
  defineModule,
  field,
  resource,
  Type,
} from "@suite/module-sdk";
export default defineModule({
  id: "device-notes",
  name: "Device notes",
  version: "1.0.0",
  description: "Standalone capability acceptance",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}, { additionalProperties: false }),
  permissions: [
    "device-notes.notes.read",
    "device-notes.notes.write",
    "device-notes.export",
    "device-notes.notify",
  ],
  capabilities: {
    export: capability({
      kind: "files.export",
      permission: "device-notes.export",
    }),
    notify: capability({
      kind: "notifications.show",
      permission: "device-notes.notify",
    }),
  },
  resources: {
    notes: resource(
      { name: field.text() },
      { title: "Notes", standalone: true },
    ),
  },
  operations: {},
});
