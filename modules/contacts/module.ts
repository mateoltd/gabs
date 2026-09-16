import { defineModule, resource, field, Type } from "@suite/module-sdk";
export default defineModule({
  id: "contacts",
  name: "Contacts",
  version: "1.1.0",
  description: "People, organizations, customers and suppliers.",
  host: "^1.0.0",
  backend: "^1.0.0",
  publisher: "suite",
  dependencies: {},
  permissions: [
    "contacts.contacts.read",
    "contacts.contacts.write",
    "contacts.notes.read",
    "contacts.notes.write",
    "contacts.addresses.read",
    "contacts.addresses.write",
  ],
  configuration: Type.Object({}, { additionalProperties: false }),
  operations: {},
  navigation: { path: "/contacts", permission: "contacts.contacts.read" },
  resources: {
    contacts: resource(
      {
        name: field.text({ minLength: 1, maxLength: 200 }),
        kind: field.enum(["person", "organization"]),
        relationship: field.enum(["customer", "supplier", "both", "other"]),
        email: field.optional(field.text({ maxLength: 254 })),
        phone: field.optional(field.text({ maxLength: 80 })),
        address: field.optional(field.text({ maxLength: 1000 })),
      },
      {
        title: "Contacts",
        columns: ["name", "kind", "relationship", "email"],
        standalone: true,
      },
    ),
    addresses: resource(
      {
        contactId: field.reference("contacts", "contacts"),
        kind: field.enum(["billing", "shipping", "office", "other"]),
        label: field.optional(field.text({ maxLength: 100 })),
        street: field.text({ minLength: 1, maxLength: 300 }),
        additionalLine: field.optional(field.text({ maxLength: 300 })),
        city: field.text({ minLength: 1, maxLength: 150 }),
        region: field.optional(field.text({ maxLength: 150 })),
        postalCode: field.optional(field.text({ maxLength: 40 })),
        country: field.text({ minLength: 1, maxLength: 100 }),
      },
      {
        title: "Addresses",
        columns: ["contactId", "kind", "street", "city", "country"],
        standalone: true,
      },
    ),
    notes: resource(
      {
        contactId: field.reference("contacts", "contacts"),
        text: field.text({ minLength: 1, maxLength: 10000 }),
      },
      {
        title: "Notes",
        columns: ["contactId", "text"],
        standalone: true,
        appendOnly: true,
      },
    ),
  },
});
