import {
  defineModule,
  field,
  resource,
  operation,
  Type,
} from "@suite/module-sdk";
import {
  ReferenceQuerySchema,
  ReferencePageSchema,
} from "@suite/module-sdk/references";
export default defineModule({
  id: "reference-client",
  name: "Reference client",
  version: "1.0.0",
  description: "Independent reference client acceptance",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: [
    "reference-client.notes.read",
    "reference-client.notes.write",
    "reference-client.targets.read",
    "reference-client.targets.write",
  ],
  resources: {
    notes: resource(
      {
        name: field.text({ title: "Name", minLength: 1 }),
        link: {
          ...field.reference("reference-client", "targets"),
          title: "Target",
        },
      },
      { title: "Notes", standalone: true },
    ),
    targets: resource(
      { name: field.text({ title: "Name", minLength: 1 }) },
      { title: "Targets", standalone: true },
    ),
  },
  operations: {
    lookup: operation({
      title: "Check reference",
      kind: "query",
      policy: "online",
      permission: "reference-client.notes.read",
      input: ReferenceQuerySchema,
      output: ReferencePageSchema,
    }),
  },
  views: {
    home: {
      title: "Reference client",
      entry: "view.tsx",
      stylesheet: "view.css",
      permission: "reference-client.notes.read",
    },
  },
  navigation: {
    path: "/reference-client",
    view: "home",
    permission: "reference-client.notes.read",
  },
});
