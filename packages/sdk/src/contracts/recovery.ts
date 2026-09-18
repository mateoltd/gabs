import { Type, type Static } from "@sinclair/typebox";
import { resourceRecordSchema } from "./resource";

const id = Type.String({ minLength: 1, maxLength: 128 });
const name = Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_-]{0,63}$" });
const version = Type.String({ minLength: 1, maxLength: 40 });
const data = Type.Record(Type.String(), Type.Unknown());
const base = {
  moduleId: name,
  moduleVersion: version,
  key: Type.Optional(id),
  input: Type.Unknown(),
};
const call = Type.Union([
  Type.Object(
    { ...base, action: Type.Literal("operation"), operation: name },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...base,
      action: Type.Union([
        Type.Literal("create"),
        Type.Literal("update"),
        Type.Literal("archive"),
      ]),
      resource: name,
    },
    { additionalProperties: false },
  ),
]);
const journal = Type.Object(
  {
    id,
    userId: id,
    workspaceId: id,
    call,
    dependencies: Type.Array(id),
    requestedDependencies: Type.Optional(Type.Array(id)),
    state: Type.Union([
      Type.Literal("pending"),
      Type.Literal("accepted"),
      Type.Literal("rejected"),
      Type.Literal("conflict"),
    ]),
    createdAt: Type.Number(),
    attempts: Type.Integer({ minimum: 0 }),
    delivery: Type.Optional(
      Type.Union([Type.Literal("unsubmitted"), Type.Literal("uncertain")]),
    ),
    orderingRecovery: Type.Optional(
      Type.Union([Type.Literal("outcome"), Type.Literal("waiting")]),
    ),
    recordRecovery: Type.Optional(
      Type.Object(
        {
          targetId: id,
          destination: Type.Union([
            Type.Literal("separate"),
            Type.Literal("existing"),
          ]),
        },
        { additionalProperties: false },
      ),
    ),
    supersededBy: Type.Optional(id),
    error: Type.Optional(Type.String()),
    errorCode: Type.Optional(Type.String()),
    businessError: Type.Optional(Type.Unknown()),
    settlement: Type.Optional(Type.Literal("cancelled")),
    recoveredAt: Type.Optional(Type.Number()),
    result: Type.Optional(Type.Unknown()),
  },
  { additionalProperties: false },
);
const target = Type.Union([resourceRecordSchema(data), Type.Null()]);
const comparison = Type.Object(
  {
    base: Type.Optional(data),
    local: data,
    remote: data,
    conflicts: Type.Array(Type.String()),
    choices: Type.Record(
      Type.String(),
      Type.Union([Type.Literal("local"), Type.Literal("remote")]),
    ),
  },
  { additionalProperties: false },
);
const review = Type.Object(
  {
    entryId: Type.Optional(id),
    draftId: Type.Optional(id),
    comparison: Type.Optional(comparison),
    collision: Type.Optional(
      Type.Object(
        {
          parentId: id,
          sourceData: data,
          sourceTarget: target,
          targetId: Type.Optional(id),
          moduleVersion: version,
          ready: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: false },
      ),
    ),
    recoveryInput: Type.Optional(
      Type.Object(
        {
          moduleVersion: version,
          baseVersion: Type.Optional(Type.Integer({ minimum: 1 })),
          recordId: Type.Optional(id),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const identity = {
  kind: Type.Literal("module-work-recovery"),
  formatVersion: Type.Literal(1),
  userId: id,
  workspaceId: id,
  moduleId: name,
  moduleVersion: version,
};
/** A portable copy of device observations and input, never an execution or acceptance credential. */
export const SavedWorkRecoverySchema = Type.Union([
  Type.Object(
    {
      ...identity,
      selection: Type.Literal("request"),
      entry: journal,
      review: Type.Optional(
        Type.Object(
          {
            source: call,
            moduleVersion: version,
            input: Type.Unknown(),
            revision: Type.Integer({ minimum: 1 }),
            updatedAt: Type.Number(),
            continuations: Type.Optional(
              Type.Array(
                Type.Object(
                  { id, fingerprint: Type.String() },
                  { additionalProperties: false },
                ),
              ),
            ),
          },
          { additionalProperties: false },
        ),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...identity,
      selection: Type.Literal("draft"),
      resource: name,
      key: Type.String({ minLength: 1, maxLength: 1024 }),
      data,
      target,
      draftVersion: version,
      review: Type.Optional(review),
      entry: Type.Optional(journal),
    },
    { additionalProperties: false },
  ),
]);
export type SavedWorkRecovery = Static<typeof SavedWorkRecoverySchema>;
