import {
  defineModule,
  field,
  resource,
  operation,
  serviceReference,
  Type,
} from "@suite/module-sdk";
import { defineLocalModule } from "@suite/module-sdk/local";
const common = {
  version: "1.0.0",
  host: "^1",
  backend: "^1",
  publisher: "suite",
  description: "Standalone service transaction acceptance",
  configuration: Type.Object({ prefix: Type.Optional(Type.String()) }),
};
export const provider = defineModule({
  ...common,
  id: "local-provider",
  name: "Local counter",
  dependencies: {},
  permissions: [
    "local-provider.add",
    "local-provider.online",
    "local-provider.items.read",
    "local-provider.items.write",
  ],
  resources: {
    items: resource(
      { name: field.text(), value: Type.Number() },
      { title: "Counters", standalone: true },
    ),
  },
  operations: {
    online: operation({
      title: "Corporate service",
      policy: "online",
      public: true,
      permission: "local-provider.online",
      input: Type.Object({}),
      output: Type.Number(),
    }),
    add: operation({
      title: "Add to counter",
      policy: "local",
      public: true,
      permission: "local-provider.add",
      input: Type.Object({
        amount: Type.Number(),
        fail: Type.Optional(Type.Boolean()),
      }),
      output: Type.Object({
        total: Type.Number(),
        id: Type.String(),
        profile: Type.String(),
        request: Type.String(),
        caller: Type.String(),
      }),
      errors: Type.Object({ reason: Type.Literal("blocked") }),
    }),
  },
});
export const consumer = defineModule({
  ...common,
  id: "local-consumer",
  name: "Local notes",
  dependencies: { [provider.id]: "^1" },
  permissions: [
    "local-consumer.run",
    "local-consumer.notes.read",
    "local-consumer.notes.write",
  ],
  resources: {
    notes: resource(
      {
        name: field.text(),
        target: field.optional(field.reference(provider.id, "items")),
      },
      { title: "Notes", standalone: true },
    ),
  },
  services: {
    add: serviceReference(provider, "add"),
    corporate: serviceReference(provider, "online"),
  },
  operations: {
    run: operation({
      title: "Record and count",
      policy: "local",
      public: true,
      permission: "local-consumer.run",
      input: Type.Object({
        fail: Type.Optional(Type.Boolean()),
        translate: Type.Optional(Type.Boolean()),
        detached: Type.Optional(Type.Boolean()),
        link: Type.Optional(Type.Boolean()),
      }),
      output: Type.Number(),
      errors: Type.Object({ reason: Type.Literal("translated") }),
    }),
  },
});
export const providerImplementation = defineLocalModule(provider)({
  async add(ctx, input) {
    const current =
      (await ctx.resource("items").list()).items[0] ??
      (await ctx
        .resource("items")
        .create({ name: ctx.configuration.prefix ?? "Count", value: 0 }));
    await new Promise((resolve) => setTimeout(resolve, 1));
    const changed = await ctx
      .resource("items")
      .update(
        current.id,
        { ...current.data, value: current.data.value + input.amount },
        current,
      );
    if (input.fail) ctx.reject({ reason: "blocked" });
    return {
      total: changed.data.value,
      id: changed.id,
      profile: ctx.profileId,
      request: ctx.requestId,
      caller: ctx.caller?.moduleId ?? "",
    };
  },
});
export const consumerImplementation = defineLocalModule(consumer)({
  async run(ctx, input) {
    await ctx.resource("notes").create({ name: "Started" });
    if (input.detached) {
      void ctx.service("add", { amount: 1, fail: input.fail });
      return 0;
    }
    const results = await Promise.all([
      ctx.service("add", { amount: 1 }),
      ctx.serviceAttempt("add", { amount: 2, fail: input.fail }),
    ]);
    if (!results[1].ok) {
      if (input.translate) ctx.reject({ reason: "translated" });
      return 0;
    }
    if (input.link)
      await ctx
        .resource("notes")
        .create({ name: "Linked", target: results[1].value.id });
    const value: number = results[1].value.total;
    if (
      results[1].value.profile !== ctx.profileId ||
      results[1].value.request !== ctx.requestId ||
      results[1].value.caller !== consumer.id
    )
      throw Error("Service context lost");
    return value;
  },
});
// Contract failures must be caught when modules are authored, before packaging.
if (false)
  defineLocalModule(consumer)({
    async run(ctx) {
      // @ts-expect-error corporate services cannot execute in standalone contexts
      await ctx.service("corporate", {});
      // @ts-expect-error undeclared service alias
      await ctx.service("missing", {});
      // @ts-expect-error input comes from the provider contract
      await ctx.service("add", { amount: "wrong" });
      // @ts-expect-error output is inferred from the provider contract
      const wrong: string = (await ctx.service("add", { amount: 1 })).total;
      return Number(wrong);
    },
  });
