import {
  defineModule,
  resource,
  field,
  operation,
  Type,
} from "@suite/module-sdk";
const records = resource(
  { name: field.text(), amount: field.number(), approved: field.boolean() },
  { title: "Records", standalone: true },
);
export default defineModule({
  id: "query-proof",
  name: "Resource explorer",
  description: "Typed reusable resource queries",
  version: "1.0.0",
  publisher: "suite",
  host: "^1",
  backend: "^1",
  dependencies: {},
  configuration: Type.Object({}),
  operations: {
    approved: operation({
      kind: "query",
      title: "Read approved records",
      policy: "online",
      permission: "query-proof.view",
      input: Type.Object(
        { minimum: Type.Number(), cursor: Type.Optional(Type.String()) },
        { additionalProperties: false },
      ),
      output: Type.Object(
        {
          names: Type.Array(Type.String()),
          nextCursor: Type.Union([Type.String(), Type.Null()]),
        },
        { additionalProperties: false },
      ),
    }),
  },
  permissions: [
    "query-proof.view",
    "query-proof.records.read",
    "query-proof.records.write",
    "query-proof.other.read",
    "query-proof.other.write",
  ],
  resources: { records, other: { ...records, title: "Other records" } },
  views: {
    home: {
      title: "Resource explorer",
      entry: "view.tsx",
      permission: "query-proof.view",
    },
  },
  navigation: {
    path: "/query-proof",
    view: "home",
    permission: "query-proof.view",
  },
});
