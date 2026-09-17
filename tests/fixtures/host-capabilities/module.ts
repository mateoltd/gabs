import { defineModule, capability, Type } from "@suite/module-sdk";
export default defineModule({
  id: "custom-notes",
  name: "Custom notes",
  version: "1.0.0",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  description: "Module-scoped host actions",
  dependencies: {},
  permissions: [
    "custom-notes.open",
    "custom-notes.export",
    "custom-notes.notify",
    "custom-notes.network",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  resources: {},
  operations: {},
  capabilities: {
    export: capability({
      kind: "files.export",
      permission: "custom-notes.export",
    }),
    notify: capability({
      kind: "notifications.show",
      permission: "custom-notes.notify",
    }),
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
      title: "Host actions",
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
