# Registry resolution performance

16 September 2026. Local engineering evidence; remote performance acceptance remains open.

## Change

Workspace release resolution previously fetched every published package, including every custom React bundle, before selecting module versions. In the local registry, 23 releases contained 1,954,826 serialized artifact bytes versus 5,733 manifest bytes. This overhead affected ordinary business authorization, even for unrelated modules.

Resolution now reads compact release metadata, applies workspace pins and dependency constraints, and fetches the exact selected packages. Each selected artifact still undergoes checksum, signature and identity verification. Permission, entitlement and assignment reads remain current on each request; no cross-request authorization cache was added.

## Local results

The existing load fixture exercises 50 concurrent clients with 1,000 orders and one shared stock row. Targets are unchanged: p95 reads below 500 ms and confirmation below 1,000 ms.

| Measurement      | Before | After  |
| ---------------- | ------ | ------ |
| Order read p95   | 318 ms | 168 ms |
| Confirmation p95 | 372 ms | 300 ms |

[Before report](before.json), [after report](after.json). These are individual local runs on the same machine, not a statistically controlled benchmark or proof of remote runner performance. The post-change run overlapped a build; the reports preserve the observed measurements without adjusting them.

All 63 unit/PostgreSQL tests, strict TypeScript and boundary/copy checks passed, including signature rejection, independently deployed version pins, current permission revocation and atomic operations. All four builds passed. Both signed custom-view installation and existing-company activation browser journeys passed against the rebuilt API; formatting passed.

The previous CI run failed the order-read target at 781 ms. The new query must still pass CI before that failure is considered resolved. Overall parity and release acceptance remain open.
