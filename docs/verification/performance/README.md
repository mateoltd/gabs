# Order-list performance acceptance (OPS-07)

16 September 2026. The candidate improved latency but did not pass remote acceptance. The 500 ms read and 1,000 ms confirmation p95 targets remain unchanged.

## Observed cause

The unchanged load fixture creates a new company with 1,000 orders, distinct customers and one product, then issues 50 concurrent list requests followed by 50 concurrent confirmations. Prior remote runs failed reads: `101ff85` recorded 952 ms while confirmations passed at 720 ms.

A local CPU profile and timed `pg` query calls isolated the order/customer list join. PostgreSQL estimated only three rows for a freshly populated workspace. Its nested loop compared the tenant's materialized customer list against every order before sorting and limiting the result. The captured plan rejected 499,500 customer/order pairs to return a 51-row page. No customer records were missing, and the existing composite foreign key still guarantees the workspace/customer relationship.

The query now resolves customer names by the customer's unique key, with an explicit matching workspace condition. The database can page the orders and perform one indexed customer lookup for each returned row. Name search remains a parameterized, case-insensitive filter before the page limit; cursor and status filters retain their previous meaning. Search may examine additional orders to find matching names; this is not a claim of constant-time substring search.

| Evidence                                                                                      | Before                             | After                 |
| --------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------- |
| Customer access for the unfiltered first page                                                 | 499,500 pairs rejected by the join | 51 unique-key lookups |
| Local `EXPLAIN ANALYZE` execution                                                             | 21.422 ms                          | 0.122 ms              |
| Cumulative client-observed list-query time across 50 concurrent reads, with profiling enabled | 1,216 ms                           | 127 ms                |
| Local HTTP read p95 with the same profiling instrumentation                                   | 169 ms                             | 120 ms                |

Query elapsed times overlap under concurrency and include client scheduling; they are not additive database CPU time. These local measurements explain the fix and do not substitute for the remote gate.

- [Before query plan](order-plan-before.json)
- [After query plan](order-plan-after.json)
- [Before query timings](queries-before.json)
- [After query timings](queries-after.json)

The diagnostic CPU sampler and query wrapper were temporary local tooling. They recorded the 50-read phase only, without query parameter values, and were disabled for the acceptance benchmark. Plans were captured through the normal application database role inside a transaction with the fixture's workspace setting, using `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on the actual generated SQL. No planner switches, manual statistics refresh, permission caches, reduced fixture sizes or relaxed budgets were used.

## Verification

`pnpm check` passed all 69 tests in 14 files, including type and boundary checks. A new Fastify/PostgreSQL integration case verifies customer-name matching before one-row pagination, all cursor pages, line/customer identity, no matches and rejection of a foreign workspace. Existing authorization, revoked-access, tenant isolation and stock correctness cases remain enabled.

`pnpm test:load` without profiling passed locally at **104 ms reads / 172 ms confirmation**. [Report](local-load.json). All four application builds passed. All 17 selected Chromium journeys covering order workflows, pagination, bulk operations, tenant switching and offline behavior passed against the rebuilt API. Formatting passed. Remote CI results will be recorded against the exact candidate commit before OPS-07 is marked verified.

## Remote result and repeatable diagnostics

[CI run 35056056304](https://github.com/mateoltd/gabs/actions/runs/35056056304), commit `383a4b2`, passed 69 unit/PostgreSQL tests, 59 browser journeys, all builds and three unsigned desktop packaging jobs. Read p95 was **670 ms** (fails 500 ms); confirmation was **726 ms** (passes 1,000 ms). Restore was skipped by the previous combined load/restore step. OPS-07 remains active.

`pnpm test:load --profile` now captures the 50-read phase after warmup with Node's in-process CPU sampler and Kysely query timing. No inspector port or SQL parameter values are recorded. Outputs are ignored locally at `docs/verification/load-diagnostics/` and included in CI's verification artifact: `reads.cpuprofile`, `queries.json`, and a separate diagnostic `load.json`. CPU profiles may contain source paths and fixture function names. Query elapsed times overlap and are not database CPU time.

CI keeps the uninstrumented load acceptance result and unchanged budgets. After failure it runs diagnostics against a fresh fixture in the same database; profile latency is not acceptance evidence or a directly comparable benchmark. The restore drill now runs independently after an attempted load gate, so a latency failure no longer hides restore results. The original failed load step still fails the job.

Local diagnostic smoke run produced 196 CPU samples and 750 queries grouped into 15 SQL statements, with parameter fields absent. Its instrumented p95 was 116/175 ms; that only verifies tooling and does not close the remote gate.

## Current authorization candidate

The first diagnostic-enabled remote run passed, but the following candidate again exceeded the read budget (552 ms). Both restore drills passed. Captured remote timings support consolidating current authorization reads into one statement without caching permissions. [Exact run reports, profiling limits, candidate change and acceptance](authorization/README.md). OPS-07 remains open pending this candidate's remote result.
