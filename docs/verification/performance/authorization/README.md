# Current authorization in one database statement

16 September 2026. OPS-07 candidate; remote acceptance is still required.

## Evidence behind this change

Two remote runs of the same load path produced different outcomes:

| Commit / run                                                                         | CPU reported by runner | Read p95 | Confirmation p95 | Restore |
| ------------------------------------------------------------------------------------ | ---------------------- | -------- | ---------------- | ------- |
| `6442851` / [35057665259](https://github.com/mateoltd/gabs/actions/runs/35057665259) | AMD EPYC 9V45, 2 cores | 387 ms   | 420 ms           | Passed  |
| `1b7d216` / [35057963023](https://github.com/mateoltd/gabs/actions/runs/35057963023) | AMD EPYC 9V74, 2 cores | 552 ms   | 593 ms           | Passed  |

Both passed code/build checks, all 59 Chromium journeys and three unsigned packaging jobs. The latest read result misses the unchanged 500 ms budget. We therefore retain the failed result and keep OPS-07 open. Different runner CPUs and timing variability limit attribution; the permission-replay correction does not change the order-list path.

The failed run's diagnostic repeat recorded 750 SQL statements for 50 list requests. Authorization separately read the user, membership/policy and complete role graph. Query elapsed time includes network, server work and client scheduling; its cumulative duration overlaps across concurrent requests. The CPU summary is sampled JavaScript self time, not PostgreSQL execution time. Full profiles remain in the run's verification artifact.

## Change and limits

Authorization now retrieves current user status, workspace membership, organization policy and all workspace roles/assignments in one SQL statement. This reduces the fixture to 650 queries. No identity, permission, grant, assignment or module readiness result is cached across requests. Unassigned parent roles remain in the graph so opt-in inheritance and explicit denials retain their behavior. Missing/inactive identity fails authentication; revoked or foreign membership fails authorization. Existing MFA, permission, entitlement and module checks remain in place.

The query is exercised using the ordinary PostgreSQL application role and row security. A new integration journey toggles inheritance and denials, revokes/restores membership, disables/restores a user and rejects a foreign workspace. The fixture's policy uses the public typed organization contract.

## Verification

All 74 unit/PostgreSQL tests, type/boundary/copy checks and four builds passed. The uninstrumented local load passed at 102/177 ms for reads/confirmation. Local profiling confirms 13 statement groups and 650 queries; its elapsed time is not used as performance acceptance. All 18 selected browser journeys passed across the initial 17 successes and one focused rerun. The viewer layout test initially assumed a seed order remained on the first page; it now uses the real search controls to find seed inventory/orders before asserting visibility and overflow. Permission, accessibility and responsive assertions remain intact. Formatting passed. The exact remote candidate result is required before this item can be marked verified.

## Subsequent remote results

The candidate did not close OPS-07: [run 35087408586](https://github.com/mateoltd/gabs/actions/runs/35087408586) measured 678/679 ms, and [run 35087635112](https://github.com/mateoltd/gabs/actions/runs/35087635112) measured 689/698 ms. Both missed the unchanged 500 ms read budget. The latter passed confirmation, restore, code/build checks, all 59 browser journeys and three unsigned packaging jobs. Both runners reported AMD EPYC 7763. Fewer authorization round trips are verified, but remote latency acceptance remains open.

The subsequent rollout commit `dbb13cd` / [run 35091584839](https://github.com/mateoltd/gabs/actions/runs/35091584839) measured 637/692 ms on an AMD EPYC 7763 runner. Code/build checks, all 60 browser journeys, three unsigned packaging jobs and restore passed. Read latency still exceeds 500 ms; OPS-07 stays open.

[Run 35095394975](https://github.com/mateoltd/gabs/actions/runs/35095394975) (`3118da9`) passed all 64 browser journeys, code/build, three unsigned packaging jobs and logical restore, but measured 761/763 ms for read/confirmation. [Run 35095892425](https://github.com/mateoltd/gabs/actions/runs/35095892425) (`2986647`) again passed functional/build/packaging/restore checks and measured 640/723 ms. Both retain the unchanged budgets and leave OPS-07 open. The second commit adds native acceptance only; runner variation is not evidence of a latency fix.

[Run 35098023223](https://github.com/mateoltd/gabs/actions/runs/35098023223) (`fc3583c`) passed functional/build checks, three unsigned packaging jobs and logical restore. Read/confirmation p95 was 675/743 ms on AMD EPYC 7763. Read acceptance still fails the unchanged 500 ms budget; the minimized-test configuration is not a latency change.

[Run 35099113592](https://github.com/mateoltd/gabs/actions/runs/35099113592) (`381c0eb`) and [run 35099603873](https://github.com/mateoltd/gabs/actions/runs/35099603873) (`d029dbd`) passed browser/build checks, all three unsigned packaging jobs and logical restore. On AMD EPYC 9V74, read/confirmation p95 was 514/855 ms and 515/576 ms respectively. Both still fail the unchanged 500 ms read budget. These runs verify the prior custom-state/native-editor candidates, not the subsequent device-reporting implementation, and do not establish a performance fix.
