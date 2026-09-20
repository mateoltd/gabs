# Role-targeted permission tags

Scope: **GOV-01**, **ORG-003**, **PERM-001** and **PERM-002**. Role tags target roles directly and contribute shared permissions independently of reporting relationships. This is one governance milestone; group/tag module assignment, broader employee management and graph filtering remain unfinished.

## Behavior and ownership

The SDK now owns the canonical organization, rank, group and tag schemas; TypeScript types derive from those schemas. API admission uses the same schema and validates the complete graph. Existing group labels remain metadata and do not silently become permission policies.

A tag has stable identity, a unique readable name, selected roles, grants and denials. Role permissions, groups and tags combine through the existing evaluator. Parent contributions require opt-in inheritance. Explicit denials override ordinary grants across assigned roles; the protected administrator retains its root permissions. Direct root tag denials, foreign or repeated role targets and ambiguous tag names are rejected.

The organization editor adds a separate Role tags section using existing host components. Administrators can find, create, rename and remove tags, choose roles and set Allow/Deny/Not set for registered permissions. Changes remain a draft until Save organization. The central matrix previews the same evaluator; module review uses the saved server policy. Both show tag contribution labels.

Server updates retain current authorization, tenant isolation, version conflicts, idempotent retries and transactional audit. A supported older client omitting the optional tags field preserves existing tags. An explicit empty list removes them under normal authority/version checks. Tags neither grant module entitlements nor change the organization DAG.

## Verification

Verified locally on 20 September 2026:

- **18 focused tests** passed across SDK governance, module contracts, PostgreSQL admission and capability review: `/tmp/gabs-role-tags-focused.log`.
- **1,007 regression tests in 130 files** passed against an isolated migrated PostgreSQL database: `/tmp/gabs-role-tags-regression.log`. This preceded the final UI keyboard-focus correction and component relocation; those final changes are covered by the strict builds and product journeys below.
- Final strict root/browser/Node/preload/worker checks, dependency boundaries and copy checks passed. **All four build targets rebuilt successfully**, with existing bundle-size warnings: `/tmp/gabs-role-tags-final-build.log`.
- **Two headless browser and two hidden/minimized native journeys** passed: the new tag journey and the existing capability-review regression on each client. Logs: `/tmp/gabs-role-tags-web-final.log` and `/tmp/gabs-role-tags-native-final.log`. Disposable databases were removed.
- Product acceptance covers unsaved drafts, multiple role assignments, persistence after reload, denial overrides, matching matrix/module review, rename, removal and keyboard focus returning to Add role tag. Scoped Axe A/AA and narrow overflow assertions passed.
- All eight new wide/narrow viewport captures below were inspected. The existing capability-review captures were also inspected and incidental differences restored. No styles or theme tokens changed. These checks preserve functional continuity; the current UI is not approved as polished.
- Scoped formatting, whitespace and documentation links passed. The ledger retains 29 original requirement IDs and the tracker 106 stable IDs.

The PostgreSQL journey exercises unauthorized actors, workspace isolation, delegated-grant constraints, revoked membership, stale versions, concurrent duplicate requests, competing updates, legacy-client omission, explicit tag removal and one transactional audit per accepted logical update. Domain checks cover inheritance, multiple-role denial precedence, protected root permissions, invalid targets, normalized name uniqueness and schema-derived typing.

Native acceptance uses development authentication and the existing hidden/minimized harness. It does not establish real identity-provider, signed-platform or physical durability acceptance. GOV-01 remains active for group/tag module assignment, broader employee/group management and chart classification filters.

## Inspected captures

Each pair records actual top and lower viewport positions within the scrollable organization page.

| Client | Top | Lower |
| --- | --- | --- |
| Web | [Wide](web-top.png) | [Wide](web.png) |
| Web, narrow | [Narrow](web-narrow-top.png) | [Narrow](web-narrow.png) |
| Desktop | [Wide](desktop-top.png) | [Wide](desktop.png) |
| Desktop, narrow | [Narrow](desktop-narrow-top.png) | [Narrow](desktop-narrow.png) |
