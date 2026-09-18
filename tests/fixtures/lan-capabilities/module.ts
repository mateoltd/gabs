import {
  defineModule,
  capability,
  field,
  resource,
  Type,
} from "@suite/module-sdk";
export default defineModule({
  id: "custom-notes",
  name: "Custom notes",
  version: "1.0.0",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  description: "Managed LAN capability acceptance",
  dependencies: {},
  permissions: [
    "custom-notes.open",
    "custom-notes.network",
    "custom-notes.notes.read",
    "custom-notes.notes.write",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  resources: {
    notes: resource(
      { text: field.text({ title: "Text" }) },
      { title: "Notes", columns: ["text"] },
    ),
  },
  operations: {},
  capabilities: {
    peers: capability({
      kind: "lan.status",
      permission: "custom-notes.network",
    }),
    relay: capability({
      kind: "lan.relay",
      permission: "custom-notes.network",
    }),
  },
  views: {
    home: {
      title: "Local network",
      entry: "view.tsx",
      permission: "custom-notes.open",
    },
  },
  navigation: {
    path: "/custom-notes",
    view: "home",
    permission: "custom-notes.open",
  },
});
