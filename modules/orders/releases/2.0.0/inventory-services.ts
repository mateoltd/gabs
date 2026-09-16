// Generated public services for inventory@2.0.0. Regenerate with pnpm module services.
import { operation, Type } from "@suite/module-sdk";
export default {
  "resolve-products": {
    moduleId: "inventory",
    operation: "resolve-products",
    version: "2.0.0",
    contract: operation({
      ...{
        title: "Resolve product snapshots",
        policy: "online",
        permission: "inventory.availability.read",
        public: true,
        serviceOnly: true,
      },
      input: Type.Object(
        {
          ids: Type.Array(
            Type.String({
              pattern:
                "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
            }),
            { minItems: 1, maxItems: 100, uniqueItems: true },
          ),
        },
        { additionalProperties: false },
      ),
      output: Type.Array(
        Type.Object({
          id: Type.String({
            pattern:
              "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
          }),
          sku: Type.String(),
          name: Type.String(),
        }),
      ),
      errors: Type.Object(
        {
          code: Type.Union([
            Type.Literal("NOT_FOUND"),
            Type.Literal("FORBIDDEN"),
            Type.Literal("INVALID_INPUT"),
            Type.Literal("INSUFFICIENT_STOCK"),
            Type.Literal("PRODUCT_INACTIVE"),
            Type.Literal("VERSION_CONFLICT"),
            Type.Literal("RESERVED_STOCK"),
            Type.Literal("RESERVATION_CONFLICT"),
          ]),
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    }),
  },
  reserve: {
    moduleId: "inventory",
    operation: "reserve",
    version: "2.0.0",
    contract: operation({
      ...{
        title: "Reserve stock",
        policy: "online",
        permission: "inventory.reservations.write",
        public: true,
        serviceOnly: true,
      },
      input: Type.Object(
        {
          referenceId: Type.String({
            pattern:
              "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
          }),
          lines: Type.Array(
            Type.Object(
              {
                productId: Type.String({
                  pattern:
                    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
                }),
                quantity: Type.Integer({ minimum: 1, maximum: 1000000 }),
              },
              { additionalProperties: false },
            ),
            { minItems: 1, maxItems: 100 },
          ),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({ state: Type.Literal("reserved") }),
      errors: Type.Object(
        {
          code: Type.Union([
            Type.Literal("NOT_FOUND"),
            Type.Literal("FORBIDDEN"),
            Type.Literal("INVALID_INPUT"),
            Type.Literal("INSUFFICIENT_STOCK"),
            Type.Literal("PRODUCT_INACTIVE"),
            Type.Literal("VERSION_CONFLICT"),
            Type.Literal("RESERVED_STOCK"),
            Type.Literal("RESERVATION_CONFLICT"),
          ]),
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    }),
  },
  release: {
    moduleId: "inventory",
    operation: "release",
    version: "2.0.0",
    contract: operation({
      ...{
        title: "Release reservation",
        policy: "online",
        permission: "inventory.reservations.write",
        public: true,
        serviceOnly: true,
      },
      input: Type.Object(
        {
          referenceId: Type.String({
            pattern:
              "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
          }),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({ state: Type.Literal("released") }),
      errors: Type.Object(
        {
          code: Type.Union([
            Type.Literal("NOT_FOUND"),
            Type.Literal("FORBIDDEN"),
            Type.Literal("INVALID_INPUT"),
            Type.Literal("INSUFFICIENT_STOCK"),
            Type.Literal("PRODUCT_INACTIVE"),
            Type.Literal("VERSION_CONFLICT"),
            Type.Literal("RESERVED_STOCK"),
            Type.Literal("RESERVATION_CONFLICT"),
          ]),
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    }),
  },
  consume: {
    moduleId: "inventory",
    operation: "consume",
    version: "2.0.0",
    contract: operation({
      ...{
        title: "Consume reservation",
        policy: "online",
        permission: "inventory.reservations.write",
        public: true,
        serviceOnly: true,
      },
      input: Type.Object(
        {
          referenceId: Type.String({
            pattern:
              "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
          }),
        },
        { additionalProperties: false },
      ),
      output: Type.Object({ state: Type.Literal("consumed") }),
      errors: Type.Object(
        {
          code: Type.Union([
            Type.Literal("NOT_FOUND"),
            Type.Literal("FORBIDDEN"),
            Type.Literal("INVALID_INPUT"),
            Type.Literal("INSUFFICIENT_STOCK"),
            Type.Literal("PRODUCT_INACTIVE"),
            Type.Literal("VERSION_CONFLICT"),
            Type.Literal("RESERVED_STOCK"),
            Type.Literal("RESERVATION_CONFLICT"),
          ]),
          message: Type.String(),
        },
        { additionalProperties: false },
      ),
    }),
  },
} as const;
