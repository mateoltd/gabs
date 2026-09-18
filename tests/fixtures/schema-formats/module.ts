import {
  defineModule,
  field,
  operation,
  resource,
  Type,
} from "@suite/module-sdk";

export const fields = {
  identifier: field.text({ title: "Identifier", format: "uuid" }),
  email: field.text({ title: "Email", format: "email" }),
  website: field.text({ title: "Website", format: "uri" }),
  date: field.text({ title: "Date", format: "date" }),
  time: field.text({ title: "Time", format: "time" }),
  timestamp: field.text({ title: "Timestamp", format: "date-time" }),
};
export const schema = Type.Object(fields, { additionalProperties: false });
export const valid = {
  identifier: "11111111-1111-4111-8111-111111111111",
  email: "reader@example.com",
  website: "https://example.com/office",
  date: "2024-02-29",
  time: "09:30:00+02:00",
  timestamp: "2024-02-29T09:30:00+02:00",
};
export default defineModule({
  id: "schema-formats",
  name: "Formatted records",
  description: "Portable schema format acceptance",
  version: "1.0.0",
  publisher: "suite",
  host: "^1.0.0",
  backend: "^1.0.0",
  dependencies: {},
  permissions: [
    "schema-formats.records.read",
    "schema-formats.records.write",
    "schema-formats.capture",
  ],
  configuration: Type.Object({}),
  resources: {
    records: resource(fields, {
      title: "Records",
      standalone: true,
      columns: ["email", "date"],
    }),
  },
  operations: {
    echo: operation({
      title: "Echo",
      permission: "schema-formats.capture",
      policy: "online",
      input: schema,
      output: schema,
    }),
    capture: operation({
      title: "Capture",
      permission: "schema-formats.capture",
      policy: "local",
      input: schema,
      output: schema,
    }),
  },
  views: {
    home: {
      title: "Formatted intake",
      entry: "view.tsx",
      permission: "schema-formats.records.read",
    },
  },
  navigation: {
    path: "/schema-formats",
    view: "home",
    permission: "schema-formats.records.read",
  },
});
