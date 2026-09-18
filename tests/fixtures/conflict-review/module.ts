import { defineModule, field, resource, Type } from "@suite/module-sdk";
const contact = (title: string) => ({
  ...field.reference("structured-review", "targets"),
  title,
});
export default defineModule({
  id: "structured-review",
  name: "Structured review",
  version: "1.0.0",
  description: "Structured conflict acceptance",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  configuration: Type.Object({}),
  operations: {},
  permissions: [
    "structured-review.records.read",
    "structured-review.records.write",
    "structured-review.targets.read",
    "structured-review.targets.write",
  ],
  resources: {
    records: resource(
      {
        name: field.text(),
        details: Type.Object({
          note: field.text({ title: "Details note" }),
          contact: contact("Details contact"),
        }),
        links: Type.Array(
          Type.Object({
            contact: contact("Linked contact"),
            note: field.text({ title: "Link note" }),
          }),
          { maxItems: 4 },
        ),
        routes: Type.Record(
          Type.String(),
          Type.Tuple([
            contact("Route contact"),
            Type.Integer({ title: "Priority" }),
          ]),
        ),
        delivery: Type.Union([
          Type.Object(
            {
              kind: Type.Literal("linked"),
              contact: contact("Delivery contact"),
              note: field.text({ title: "Delivery note" }),
            },
            { title: "Linked", additionalProperties: false },
          ),
          Type.Object(
            {
              kind: Type.Literal("text"),
              note: field.text({ title: "Plain note" }),
            },
            { title: "Plain", additionalProperties: false },
          ),
        ]),
        optional: Type.Optional(
          Type.Object({ note: field.text({ title: "Optional note" }) }),
        ),
      },
      {
        title: "Records",
        columns: ["name", "details", "links", "routes", "delivery"],
      },
    ),
    targets: resource({ name: field.text() }, { title: "Targets" }),
  },
  navigation: {
    path: "/structured-review",
    permission: "structured-review.records.read",
  },
});
