import provider from "./provider/module";
import { serviceReference } from "@suite/module-sdk";
import {
  defineModule,
  resource,
  field,
  operation,
  Type,
} from "@suite/module-sdk";
export default defineModule({
  id: "service-notes",
  name: "Custom notes",
  version: "1.0.0",
  description: "Independent executable client and server acceptance fixture",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: { "preview-provider": "^1.0.0" },
  services: { record: serviceReference(provider, "record") },
  permissions: [
    "service-notes.notes.read",
    "service-notes.notes.write",
    "service-notes.capture",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  operations: {
    names: operation({
      kind: "query",
      title: "Read notes",
      policy: "online",
      permission: "service-notes.notes.read",
      input: Type.Object({}, { additionalProperties: false }),
      output: Type.Array(Type.String()),
    }),
    capture: operation({
      title: "Save note",
      policy: "online",
      permission: "service-notes.capture",
      input: Type.Object(
        { name: Type.String({ minLength: 1 }) },
        { additionalProperties: false },
      ),
      output: Type.Object({ id: Type.String() }),
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
      permission: "service-notes.notes.read",
    },
  },
  navigation: {
    path: "/service-notes",
    permission: "service-notes.notes.read",
    view: "home",
  },
});
