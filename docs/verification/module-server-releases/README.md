# Reviewed server release verification

16 September 2026. EXT-02 engineering milestone; the full item and overall parity remain open.

## Acceptance exercised

- Built and signed a server factory from a module directory outside host discovery. An API instantiated before publication successfully executed the deployed code without source registration or restart.
- Used the restricted `suite_registry` role for submission, approval, staging and publication; ordinary application publication remains denied.
- Rejected missing/corrupt server artifacts, publication before approval/staging, attempts to alter submitted bytes or review decisions, and publication of rejected versions. SQL guards protect direct registry insertion too.
- Concurrent publication retries created one published release and one publication audit event. Audit attribution uses the authenticated database session.
- An approved broken factory failed staging; staging remained null and the client could not publish.
- Independently deployed compatible backend versions produced distinct real records. A workspace pin selected the previous executable version.
- Operation retries returned the original result. A typed business rejection rolled back records, events, audit and idempotency effects. Revoked operation permissions denied a subsequent request.
- The fifth custom React fixture invokes the actual CLI to build both artifacts, submit, approve, stage and publish. Chromium and Electron saved/reloaded through the independent server handler against the compiled API, including integrity and style-containment checks.

## Final local checks

| Check               | Result                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm check`        | 63 tests in 10 files, strict TypeScript, dependency boundaries and copy checks passed             |
| `pnpm build`        | API, worker, web and desktop passed                                                               |
| `pnpm test:e2e`     | 55 Chromium journeys passed                                                                       |
| `pnpm test:desktop` | 5 actual Electron journeys passed                                                                 |
| Fresh database      | Migrations and seed passed; 3 builtin and 2 resource-only fixture releases reviewed and published |
| `pnpm test:load`    | Local p95 order read 212 ms, confirmation 258 ms; targets remain 500/1000 ms                      |
| `pnpm test:restore` | Logical restore passed balance, reservation, movement and RLS checks                              |
| Formatting          | Passed                                                                                            |

The test fixture changed its implementation behind the existing form; no product UI redesign was introduced. Updated custom-view captures remain in [the executable-module gallery](../executable-modules/README.md). Historical unrelated regression images were preserved.

## Limits and remote evidence

The preceding pushed commit `3408488` passed macOS/Windows/Linux unsigned packaging, builds, unit tests and browser journeys on [GitHub Actions](https://github.com/mateoltd/gabs/actions/runs/35045233224). Its load gate failed at 781 ms for order reads versus the unchanged 500 ms target; restore did not run after that failure. A second preceding run measured 779 ms. Current local results do not establish the remote performance target.

This milestone adds the official CLI review workflow and independently deployed backends. The review web interface, hosted release acceptance, module schema migrations, external-publisher access and key rotation remain incomplete. Local fixture approvals are not evidence of a human production review. Unsigned packaging is not signed-release acceptance, and local restore is not managed/offsite recovery.
