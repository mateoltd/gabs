# SDK-04: typed resource ranges

17 September 2026. Scoped framework acceptance; full SDK-04, platform parity and final UI approval remain open.

## Implemented behavior

- Public resource clients infer numeric/text range fields and bound types from their schemas. `gt`, `gte`, `lt` and `lte` combine with exact equality and text search. Eight range fields are supported, with one lower and one upper operator per field. Contradictory/empty ranges and invalid field values fail validation.
- Corporate queries execute scoped, parameterized SQL after authorization. Numeric expressions guard retained data types before casting. Text uses UTF-8 `C` collation, matched by the local Unicode code-point comparator. Null and absent values do not match ranges; explicit zero and valid empty text remain distinct.
- Standalone execution and development simulation share the range validator and evaluator through `@suite/module-sdk/queries`. Corporate downloaded pages include canonical range conditions in their account/workspace cache keys. Empty ranges retain older normalized page keys. Undownloaded combinations remain unavailable offline.
- Generated corporate and local views use the public `TypedResourceRanges` control. It supports individual bounds and inclusive intervals, field-schema editors, invalid-input correction, removal and clearing. Changing a range resets paging; local range state is scoped to the profile, module version and resource. Local results announce their count and show an explicit empty-result message. Corporate equality and range controls share one wrapping toolbar group. Range summaries expose their complete bounds through accessible descriptions and hover titles.
- The HTTP resource endpoint now reuses the SDK list schema. Its dedicated Fastify validator preserves supplied scalar types and rejects unknown properties; it does not silently coerce or prune module resource envelopes. Generated OpenAPI and API-client types include the range contract.

## Corrections found during acceptance

The first server journey found a duplicated HTTP list schema dropping the new range field. After sharing the SDK schema, the next run exposed default HTTP union coercion changing numeric bounds into strings. The endpoint now uses the existing Fastify AJV compiler with coercion, default insertion and unknown-field removal disabled. The signed resource contract still validates the values after authorization. Tests assert numeric-looking strings and unknown properties are rejected.

Visual inspection also found that separate filter rows pushed records down unnecessarily; the controls now share the existing toolbar rhythm. Fixture corrections preserved the source module's declared navigation permissions, compared simulator results independently of random UUID assignment, allowed generated-only publication fixtures without unused custom-view files, and selected the module's exact offline status rather than the separate shell freshness banner. No permission, validation or performance acceptance gate was relaxed.

## Verification

- Final strict type checks, boundary/copy checks and all four builds passed (`/tmp/gabs-resource-ranges-build6.log`). OpenAPI and generated client types include the shared range schema.
- Seven focused query/UI checks passed after final review (`/tmp/gabs-resource-ranges-unit-final.log`), including exclusion of reference/member annotations inside nullable unions from generated range choices.
- **212 unit/PostgreSQL tests across 44 files passed in 52.05 seconds**, using a temporary migrated/seeded database removed afterward (`/tmp/gabs-resource-ranges-full.log`). The later toolbar grouping and empty-result presentation passed the final interface reruns below. No development data was removed.
- **Nine distinct headless browser journeys passed in 1.7 minutes** (`/tmp/gabs-resource-ranges-browser5.log`), including numeric/date ranges, malformed requests, revoked read permissions, PostgreSQL Unicode comparisons, offline cache normalization, encrypted local filtering, and existing equality/form/reference/table regressions.
- Final visual corrections passed **three browser journeys in 36.3 seconds** (`/tmp/gabs-resource-ranges-visual-browser.log`). They exercise the wrapping toolbar and explicit empty-result state as well as equality/pagination regressions. Scoped Axe found no violations in the generated resource area, and the narrow viewport has no document overflow.
- **Two distinct hidden/unfocused Electron journeys passed in 28.1 seconds** (`/tmp/gabs-resource-ranges-native.log`). The final range-layout rerun passed in 15.1 seconds (`/tmp/gabs-resource-ranges-visual-native.log`), with explicit hidden/minimized and unfocused assertions at both ends.
- Six captures inspected: [wide](wide.png), [narrow](narrow.png), [narrow actions](narrow-actions.png), [local filtered records](local.png), [local empty results](local-empty.png), and [Electron](electron.png). Historical screenshots overwritten by regression tests were restored.

The previous checkpoint `0f05b97` / [CI 35179410609](https://github.com/mateoltd/gabs/actions/runs/35179410609) was still running browser acceptance at the last inspection; its completion must be checked separately. The latest completed `d1941d9` run still failed the unchanged load budgets and GitHub account artifact quota. No remote acceptance of these range changes is claimed.

## Limits

Sorting controls, additional query composition, resource-client ergonomics and broad SDK acceptance remain open. These ranges do not implement arbitrary nested query paths, aggregation, locale-aware collation, calendar validation beyond the declared field schema or timezone conversion. Resource references and memberships retain generated equality/picker controls. Scoped Axe and hidden development Electron do not establish whole-product accessibility, signed release readiness or final UI approval. OPS-07 performance and GitHub artifact quota remain separate open work.
