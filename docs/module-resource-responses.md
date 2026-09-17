# Typed resource responses

`createModuleClient(module, transport).resource(name)` validates results from `get`, `list`, `create`, `update` and `archive` before resolving a typed success. The resource's declared data schema remains the source of validation, including nested fields, choices and additional-property rules.

`resourceRecordSchema(dataSchema)` and `resourcePageSchema(dataSchema)` are public TypeBox schema constructors for module operation outputs and custom adapters. They retain the data schema's inferred types. Record metadata requires nonempty string IDs and `updatedAt` values, positive safe-integer versions and a boolean archive flag. A page contains validated records and either a nonempty cursor string or `null`. Envelope metadata permits additional fields for forward compatibility; resource data follows its own declared rules. These checks do not establish timestamp chronology or server authorization.

For example, a module that declares `resources.records` can derive an operation output without repeating its fields:

```ts
import { resourcePageSchema, type Static } from "@suite/module-sdk";
import module from "./module";

const pageSchema = resourcePageSchema(module.resources.records.schema);
type Page = Static<typeof pageSchema>;
```

## Invalid results and recovery

An invalid result rejects with `INVALID_RESOURCE_RESPONSE`. `isResourceResponseError(error)` structurally narrows its message, module/resource/action identity and optional `idempotencyKey`. Use the guard rather than relying on constructor identity across independently bundled SDK copies. Diagnostic schema details remain in the error cause; user-facing copy provides the appropriate next action.

Malformed reads cannot become successful `useResourceList` pages. Cancelled reads remain cancelled, including when a late transport result is malformed. Transport failures keep their original error behavior.

An invalid mutation response does **not** prove that the mutation failed. The request may already have committed. The error retains the exact key sent to the transport, including an SDK-generated key, and the SDK does not automatically retry. Check authoritative state and retain the original key for appropriate recovery; do not create a new key merely because the response could not be verified. Full durable recovery remains part of the offline/profile acceptance work.

Pending/provisional envelopes do not satisfy a confirmed record schema. This validator does not invent accepted results or add a new offline mutation protocol. Standalone modules retain their explicit local authority and receipts.

New custom-view builds require `client.resources` revision **3**, which includes response validation. Current hosts explicitly support revisions 1, 2 and 3; supported revision sets are not inferred from numeric ordering. See [signed host compatibility](module-client-packages.md#host-ui-compatibility-sdk-04).

Generated host screens apply the same validation before using live or cached resource results. Their journal retains the original signed package and key atomically with queued work, including across updates/removal. Each response is checked against that request's original module/resource/version contract. Invalid replies remain pending and retain their keys; dependencies wait while unrelated entries continue. A missing or damaged contract requires recovery of the exact original signed release. See [generated host acceptance](verification/generated-response/README.md) and the [SDK-04 map](sdk-04-acceptance.md).

The generated save/archive retry preserves the mounted screen's original request. This is not a claim of complete durable online/custom-operation recovery across navigation, lock or process failure; those remain separate offline/profile requirements.
