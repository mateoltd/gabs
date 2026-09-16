# Independent executable module verification

16 September 2026. Tracker: EXT-01. Local macOS arm64, Node 24.19, pnpm 12.4.1, PostgreSQL 18.6.

## Observed behavior

The fixture in `tests/fixtures/custom-notes` lives outside automatic module discovery. Acceptance copies it to a temporary authoring directory and invokes the real CLI to build/sign/publish an immutable version. The running API discovers it without a restart or host source changes. A fixture-only workspace receives entitlement/activation/assignment separately; this does not verify commerce.

The browser installs the package through the normal installation path, loads its TSX component with the host React/UI kit, saves a schema-typed record, and reloads it. Shadow DOM contains the fixture's deliberately global body selector; the host body color remains unchanged. An altered download fails checksum verification before execution. Native Electron independently installs, saves and reloads the same module through its bounded bridge with no renderer Node globals.

## Final checks

| Check               | Result                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm check`        | 62 tests across 9 files; TypeScript, module boundaries and copy checks passed                     |
| `pnpm build`        | Web, API, worker and desktop builds passed                                                        |
| `pnpm test:e2e`     | All 55 Chromium journeys passed                                                                   |
| `pnpm test:desktop` | All 5 actual Electron runtime journeys passed                                                     |
| `pnpm format:check` | Passed                                                                                            |
| Visual inspection   | Wide, 390px narrow and Electron views inspected; controls readable and usable, no narrow overflow |

Package tests additionally reject modified code/CSS, foreign signing keys, missing or unsupported view payloads and escaped source paths. Compile-time checks reject unknown resources, invalid record fields and undeclared permissions. Existing lifecycle/browser/native regressions remain green after fixing catalogue readiness races, removing a four-module-only test assumption and wrapping long release metadata.

## Visual evidence

- [Wide custom view](custom-view-wide.png)
- [Narrow custom view](custom-view-narrow.png)
- [Native custom view](custom-view-electron.png)

These images document framework behavior, not approval of the product's visual quality. The later UI-refinement goal remains queued. Historical UI-reconciliation screenshots were preserved rather than replaced by unrelated regression captures.

## Limits

- Custom view requests currently require connectivity; a durable provisional-result API, standalone operations and offline custom UX remain required work.
- Reviewed executable code is trusted application code. Shadow DOM prevents CSS leakage; it is not a hostile-code sandbox.
- Full fifth-module review/update/pin/migration/failure-containment acceptance remains open under EXT-02 through EXT-07 and SDK work.
- Local development signing keys, unpackaged Electron tests and unsigned remote packaging do not establish hosted registry trust or signed release readiness.
- Provider-backed commerce, identity and real installed multi-OS update acceptance remain open.
