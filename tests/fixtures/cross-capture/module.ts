import { defineModule, field, resource, Type } from "@suite/module-sdk";
const contact = (title: string) => ({
  ...field.reference("contacts", "contacts"),
  title,
});
export default defineModule({
  id: "cross-capture",
  name: "Cross capture",
  version: "1.0.0",
  description: "Cross-module capture acceptance",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: { contacts: "^1.0.0" },
  configuration: Type.Object({}),
  operations: {},
  permissions: [
    "cross-capture.records.read",
    "cross-capture.records.write",
    "cross-capture.comments.read",
    "cross-capture.comments.write",
  ],
  resources: {
    records: resource(
      {
        name: field.text(),
        links: Type.Array(Type.Object({ contact: contact("Linked contact") }), {
          minItems: 1,
          maxItems: 3,
        }),
        routes: Type.Record(
          Type.String(),
          Type.Tuple([
            contact("Route contact"),
            Type.Boolean({ title: "Primary", default: false }),
          ]),
          { maxProperties: 3 },
        ),
        delivery: Type.Union([
          Type.Object(
            {
              kind: Type.Literal("linked"),
              contact: contact("Delivery contact"),
            },
            { title: "Linked", additionalProperties: false },
          ),
          Type.Object(
            { kind: Type.Literal("plain"), note: field.text() },
            { title: "Plain", additionalProperties: false },
          ),
        ]),
      },
      { title: "Records", columns: ["name", "links", "routes", "delivery"] },
    ),
    comments: resource(
      {
        parent: {
          ...field.reference("cross-capture", "records"),
          title: "Parent",
        },
        text: field.text(),
      },
      { title: "Comments" },
    ),
  },
  navigation: {
    path: "/cross-capture",
    permission: "cross-capture.records.read",
  },
});
