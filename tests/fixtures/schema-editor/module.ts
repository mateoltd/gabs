import { defineModule, field, resource, Type } from "@suite/module-sdk";
export default defineModule({
  id: "schema-editor",
  name: "Supplier intake",
  description: "Typed structured form acceptance",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: ["schema-editor.records.read", "schema-editor.records.write"],
  operations: {},
  resources: {
    records: resource(
      {
        candidate: field.text({ title: "Candidate", minLength: 3 }),
        approved: Type.Boolean({ title: "Approved", default: false }),
        credit: Type.Optional(
          Type.Union([Type.Number({ minimum: 0 }), Type.Null()], {
            title: "Credit limit",
          }),
        ),
        address: Type.Optional(
          Type.Object(
            {
              street: field.text({ minLength: 3 }),
              city: field.text({ minLength: 2 }),
            },
            { title: "Address", additionalProperties: false },
          ),
        ),
        lines: Type.Array(
          Type.Object(
            {
              label: field.text({ minLength: 1 }),
              quantity: Type.Integer({ minimum: 1, maximum: 10 }),
              tags: Type.Array(field.enum(["urgent", "standard"]), {
                maxItems: 2,
              }),
            },
            { additionalProperties: false },
          ),
          { title: "Lines", minItems: 1, maxItems: 3 },
        ),
        choice: Type.Union(
          [Type.Literal(0), Type.Literal(false), Type.Literal("")],
          { title: "Choice" },
        ),
        delivery: Type.Union(
          [
            Type.Object(
              {
                method: Type.Literal("pickup"),
                desk: field.text({ minLength: 1 }),
              },
              { title: "Pickup", additionalProperties: false },
            ),
            Type.Object(
              {
                method: Type.Literal("courier"),
                destination: field.text({ minLength: 3 }),
              },
              { title: "Courier", additionalProperties: false },
            ),
          ],
          { title: "Delivery" },
        ),
        metrics: Type.Record(Type.String(), Type.Integer({ minimum: 0 }), {
          title: "Metrics",
          default: {},
        }),
      },
      { title: "Intake", columns: ["candidate", "approved", "lines"] },
    ),
  },
  views: {
    home: {
      title: "Structured intake",
      entry: "view.tsx",
      permission: "schema-editor.records.read",
    },
  },
  navigation: {
    path: "/schema-editor",
    view: "home",
    permission: "schema-editor.records.read",
  },
});
