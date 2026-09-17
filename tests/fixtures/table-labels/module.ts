import { defineModule, field, resource, Type } from "@suite/module-sdk";
export default defineModule({
  id: "table-labels",
  name: "Reference tables",
  version: "1.0.0",
  description: "Structured reference editor acceptance",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: [
    "table-labels.records.read",
    "table-labels.records.write",
    "table-labels.targets.read",
    "table-labels.targets.write",
  ],
  operations: {},
  resources: {
    records: resource(
      {
        name: field.text({ minLength: 1 }),
        pair: Type.Tuple(
          [
            field.reference("table-labels", "targets"),
            Type.Integer({ minimum: 0, title: "Quantity" }),
          ],
          { title: "Pair" },
        ),
        links: Type.Record(
          Type.String({ pattern: "^[a-z/~_]+$" }),
          field.reference("table-labels", "targets"),
          {
            title: "Links",
            additionalProperties: false,
            minProperties: 1,
            maxProperties: 3,
          },
        ),
        extras: Type.Object(
          { fixed: Type.String({ default: "kept" }) },
          {
            title: "Extras",
            additionalProperties: field.reference("table-labels", "targets"),
            default: { fixed: "kept" },
          },
        ),
      },
      { title: "Records", standalone: true },
    ),
    targets: resource(
      { name: field.text() },
      { title: "Targets", standalone: true },
    ),
  },
  views: {
    home: {
      title: "Reference records",
      entry: "view.tsx",
      permission: "table-labels.records.read",
    },
  },
  navigation: {
    path: "/table-labels",
    view: "home",
    permission: "table-labels.records.read",
  },
});
