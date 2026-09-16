# Order-list performance acceptance (OPS-07)

16 September 2026. Candidate optimization; remote acceptance is pending until the matching commit passes CI. The 500 ms read and 1,000 ms confirmation p95 targets remain unchanged.

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
