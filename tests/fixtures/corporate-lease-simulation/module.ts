import { defineModule, capability, Type } from "@suite/module-sdk";
export default defineModule({
  id: "leased-notes",
  name: "Leased notes",
  version: "1.0.0",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  description: "Module-scoped host actions",
  dependencies: {},
  permissions: [
    "leased-notes.open",
    "leased-notes.export",
    "leased-notes.notify",
    "leased-notes.network",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  resources: {},
  operations: {},
  capabilities: {
    export: capability({
      kind: "files.export",
      permission: "leased-notes.export",
      offline: "lease",
    }),
    notify: capability({
      kind: "notifications.show",
      permission: "leased-notes.notify",
    }),
    peers: capability({
      kind: "lan.status",
      permission: "leased-notes.network",
    }),
    relay: capability({
      kind: "lan.relay",
      permission: "leased-notes.network",
    }),
  },
  views: {
    home: {
      title: "Host actions",
      entry: "view.tsx",
      permission: "leased-notes.open",
    },
  },
  navigation: {
    path: "/leased-notes",
    view: "home",
    permission: "leased-notes.open",
  },
});
