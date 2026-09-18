# Portable schema formats

Module schemas use the same format validators in authoritative execution, SDK clients, generated forms, standalone workers and development simulation. Format validation checks syntax; permissions and business rules still run separately.

```ts
import { field, resource, Type } from "@suite/module-sdk";

const contacts = resource(
  {
    email: field.text({ format: "email", title: "Email" }),
    birthday: field.text({ format: "date", title: "Birthday" }),
    website: Type.String({ format: "uri", maxLength: 2000 }),
  },
  { title: "Contacts" },
);
```

`field.text` infers the supported format vocabulary. `Type.String` remains available for full schema composition; unsupported formats fail module definition/check/build with their schema path and a supported-format list. This also applies to configuration, resources, stores, operation inputs/outputs/errors, services, events and saved view state, including unused optional/union branches. For custom string constraints, declare `pattern` and length bounds. A process-local custom format registration does not extend this portable contract.

## Supported contract

The SDK pins `ajv-formats` 3.0.1 and uses its **full** validators, matching the validation library used by the HTTP host. The supported string formats are exported as `supportedSchemaFormats` and the `SchemaStringFormat` type.

| Formats                                                              | Meaning                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `date`                                                               | Calendar-valid four-digit-year date, including leap-year checks.                                                                                                   |
| `time`, `date-time`                                                  | RFC 3339-style times with a timezone; local times without an offset or `Z` are rejected. The pinned library also accepts its documented separator/offset variants. |
| `duration`                                                           | Duration syntax supported by the pinned validator.                                                                                                                 |
| `uri`, `uri-reference`, `uri-template`                               | Absolute URI, absolute/relative reference, and URI template respectively. An absolute URI need not be an HTTP URL.                                                 |
| `email`, `hostname`, `ipv4`, `ipv6`                                  | Address and host syntax. Validation does not perform network lookups or verify ownership.                                                                          |
| `uuid`                                                               | UUID syntax; the pinned validator permits uppercase and the `urn:uuid:` prefix. It does not enforce a specific UUID version.                                       |
| `regex`                                                              | A regular-expression string supported by the JavaScript validator.                                                                                                 |
| `json-pointer`, `relative-json-pointer`, `json-pointer-uri-fragment` | JSON pointer forms.                                                                                                                                                |
| `byte`                                                               | Base64 string syntax.                                                                                                                                              |

See the [Ajv format contract](https://ajv.js.org/packages/ajv-formats.html) and [pinned validator implementation](https://github.com/ajv-validator/ajv-formats/blob/v3.0.1/src/formats.ts). Other names, numeric formats and OpenAPI display hints such as `password`/`binary` are rejected rather than silently accepted. Use numeric schema bounds and explicit UI presentation instead.

## Runtime and compatibility

All portable validation entry points bind these validators for the duration of a synchronous TypeBox check and restore any caller registry entries afterward. This is necessary because TypeBox exposes a shared format registry. No initialization order, application registration or shared SDK instance is required. Error iterators are consumed within that scope; values are not coerced or normalized.

`parseSchemaInput` returns field paths suitable for generated form errors. `assertSchema` rejects invalid operation/resource/configuration values. `checkSchema` uses the same rules when selecting nested reference branches. Existing length, pattern, required-field and closed-object constraints remain in force.

New custom-view bundles containing format-bearing module contracts declare `client.formats` revision 1 in signed host requirements. Hosts advertising that revision provide the matching generated form and resource validation behavior. Older hosts receive the existing actionable host-compatibility error before executing those new views. Historical signed schemas and packages are unchanged. This requirement does not replace backend compatibility or the host range declared by the publisher.

The historical `field.date()` helper still produces its original date-shaped pattern; changing it would alter previously signed contracts assembled from archived source. New calendar-validated fields should explicitly declare `format: "date"` as above. A format never changes a stored date or timezone automatically.

[Acceptance evidence](verification/schema-formats/README.md) records the environments and scenarios actually verified.
