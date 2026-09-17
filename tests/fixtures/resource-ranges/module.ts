import { defineModule, resource, Type, field } from "@suite/module-sdk";
export default defineModule({
  id: "resource-ranges",
  name: "Range records",
  description: "Typed range query acceptance",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: [
    "resource-ranges.records.read",
    "resource-ranges.records.write",
  ],
  operations: {},
  resources: {
    records: resource(
      {
        name: Type.String({ title: "Name" }),
        amount: Type.Optional(
          Type.Union([Type.Number({ minimum: -10 }), Type.Null()], {
            title: "Amount",
          }),
        ),
        date: field.date(),
        approved: Type.Boolean({ title: "Approved" }),
      },
      {
        title: "Records",
        standalone: true,
        columns: ["name", "amount", "date", "approved"],
      },
    ),
  },
  navigation: {
    path: "/resource-ranges",
    permission: "resource-ranges.records.read",
  },
});
