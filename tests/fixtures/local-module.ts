import {
  defineModule,
  resource,
  field,
  operation,
  Type,
} from "@suite/module-sdk";
import { defineLocalModule } from "@suite/module-sdk/local";
export const module = defineModule({
  id: "local-proof",
  name: "Local proof",
  version: "1.0.0",
  description: "Worker acceptance",
  host: "^1",
  backend: "^1",
  publisher: "suite",
  dependencies: {},
  permissions: [
    "local-proof.run",
    "local-proof.notes.read",
    "local-proof.notes.write",
    "local-proof.corporate.read",
    "local-proof.corporate.write",
  ],
  configuration: Type.Object({}),
  resources: {
    notes: resource(
      {
        text: field.text(),
        linked: field.optional(field.reference("local-proof", "notes")),
      },
      { title: "Notes", standalone: true },
    ),
    corporate: resource({ text: field.text() }, { title: "Corporate" }),
  },
  operations: {
    calculate: operation({
      title: "Calculate",
      policy: "local",
      permission: "local-proof.run",
      input: Type.Object({
        count: Type.Integer({ minimum: 0, maximum: 100000000 }),
      }),
      output: Type.Number(),
    }),
    append: operation({
      title: "Append",
      policy: "local",
      permission: "local-proof.run",
      input: Type.Object({ text: Type.String() }),
      output: Type.String(),
    }),
    reject: operation({
      title: "Reject",
      policy: "local",
      permission: "local-proof.run",
      input: Type.Object({}),
      output: Type.Null(),
      errors: Type.Object({ code: Type.Literal("INVALID_NOTE") }),
    }),
    caught: operation({
      title: "Caught",
      policy: "local",
      permission: "local-proof.run",
      input: Type.Object({}),
      output: Type.Null(),
    }),
    endless: operation({
      title: "Endless",
      policy: "local",
      permission: "local-proof.run",
      input: Type.Object({}),
      output: Type.Null(),
    }),
    crash: operation({
      title: "Crash",
      policy: "local",
      permission: "local-proof.run",
      input: Type.Object({}),
      output: Type.Null(),
    }),
    company: operation({
      title: "Company",
      policy: "online",
      permission: "local-proof.run",
      input: Type.Object({}),
      output: Type.Null(),
    }),
  },
});
export default defineLocalModule(module)({
  async calculate(_context, { count }) {
    let sum = 0;
    for (let i = 0; i < count; i++) sum += i;
    return sum;
  },
  async append(context, { text }) {
    const row = await context.resource("notes").create({ text });
    return row.id;
  },
  async reject(context) {
    await context.resource("notes").create({ text: "Rolled back" });
    return context.reject({ code: "INVALID_NOTE" });
  },
  async caught(context) {
    await context.resource("notes").create({ text: "Must roll back" });
    try {
      // @ts-expect-error Corporate resources are not local capabilities.
      await context.resource("corporate").create({ text: "Denied" });
    } catch {}
    return null;
  },
  async endless() {
    while (true) {}
  },
  async crash() {
    throw Error("Worker fixture failure");
  },
});
