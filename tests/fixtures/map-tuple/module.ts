import { defineModule, field, resource, Type } from "@suite/module-sdk";
export default defineModule({
  id: "map-tuple",
  name: "Map and tuple editor",
  version: "1.0.0",
  description: "Structured reference editor acceptance",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: [
    "map-tuple.records.read",
    "map-tuple.records.write",
    "map-tuple.targets.read",
    "map-tuple.targets.write",
  ],
  operations: {},
  resources: {
    records: resource(
      {
        name: field.text({ minLength: 1 }),
        pair: Type.Tuple(
          [
            field.reference("map-tuple", "targets"),
            Type.Integer({ minimum: 0, title: "Quantity" }),
          ],
          { title: "Pair" },
        ),
        links: Type.Record(
          Type.String({ pattern: "^[a-z/~_]+$" }),
          field.reference("map-tuple", "targets"),
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
            additionalProperties: field.reference("map-tuple", "targets"),
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
      title: "Structured links",
      entry: "view.tsx",
      permission: "map-tuple.records.read",
    },
  },
  navigation: {
    path: "/map-tuple",
    view: "home",
    permission: "map-tuple.records.read",
  },
});
