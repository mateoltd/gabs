import { defineModule, resource, Type, field } from "@suite/module-sdk";
export default defineModule({
  id: "resource-sort",
  name: "Sorted records",
  description: "Typed range query acceptance",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  permissions: [
    "resource-sort.records.read",
    "resource-sort.records.write",
    "resource-sort.supplements.read",
    "resource-sort.supplements.write",
  ],
  operations: {},
  resources: {
    supplements: resource(
      { name: Type.String() },
      { title: "Notes", standalone: true },
    ),
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
    path: "/resource-sort",
    permission: "resource-sort.records.read",
  },
});
