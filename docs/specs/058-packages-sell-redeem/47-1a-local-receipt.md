# 47-1a — local readiness receipt

## PP-130 stacked lane update

The manager granted the lane at 17:10 Kuwait on 2026-11-05: stack on
`feat/p1-060-57-1-own-access-codes` (#845), base `12b7f19a`, migration **0211**.
This supersedes the waiting-for-lane statements below, retained as historical evidence.
The branch was rebased without conflicts. Schema SQL was generated against #845's
journal; the preserved permission seed precedes the generated schema changes and the
reviewed trigger/grants follow them. There were no branch-owned numbered artifacts to
remove. `idx=211`, previous `idx=210`, and snapshot `prevId` equals snapshot 0210 `id`.
The API fixture no longer applies draft SQL: tests require the actual migration.
A fresh read-only Astra medium review of this final migration delta reported no
confirmed P0–P3 defects (static review only). Production routes remain unregistered.
The PR base must remain the #845 branch until the manager retargets after its merge;
no merge is authorized. Further #845 pushes require a rebase and fresh head gates.

Final numbered-migration verification on private `packages-47-1a` Postgres:
request/status/production fence **17 passed**, migration-data-steps/migration-client/
RLS-context **14 passed**. Full HTTP warm samples were
`84.5530, 82.0928, 73.0055, 93.0176, 82.1025 ms`, median **82.1025 ms**.
The earlier runs below remain historical. Final lint: 30 successful tasks;
lint:docs: 0 errors/29 warnings; module-map check passed. The three guards were
reapplied to the final migration/fixture/documentation delta without new findings.

Status: **local implementation and independent review complete; awaiting migration
lane**. No final migration number, `db:generate`, push, PR, merge or deployment has
occurred. CI and exact-head bot receipts are still required after publication.

Base checked against `origin/main`: `f8a55d6a98e552dc056347c01513c65348bd533d`;
fetch showed zero incoming commits at the final source check.

## Delivered behavior

- `RequestPackageImportPreviewUseCase` checks live import permission, orders feature
  and READY file facts, then inserts an empty package preview with `status='pending'`
  and an id-only `PackageImportPreviewRequested` outbox row in the same transaction.
  There is no object-storage or workbook-reader dependency in acceptance.
- `events/published.ts` declares the event with Arabic JSDoc. The contract accepts
  exactly `{ preview_id }`. No worker known type or transport is registered prematurely.
- The status query projects pending/ready/failed DTOs directly from SQL and filters
  company, business, creator, entity and id. It never selects candidate rows, file keys
  or phones for the response. Its result shape and EXPLAIN path were tested.
- Production safety fence: `PackageImportPreviewController` is **not** a member of
  `ordersControllers`. POST and GET both return 404 in production composition; tests
  explicitly mount it through the harness. A regression test proves zero pending rows
  and zero preview-request events through the unavailable production endpoint.
- Permission catalog/defaults/device denial/Arabic-English labels and seed SQL are
  included. The unnumbered migration extends the existing table instead of adding
  another preview table: pending is package-only, skipped_count is bounded, and result
  updates are guarded to pending completion. Staff keeps its ready default and normal
  commit transition. Ready/failed previews cannot be overwritten by late preview failure.
- The new files arrow and event/activation lifecycle are documented in module-map,
  ADR-0010, ADR-0034 and spec 058. Manager decisions are recorded verbatim.

## Measured HTTP acceptance

The regression assertion is unchanged: one warm-up, five complete authenticated
`h.app.inject` POST calls, every response checked as 202, median strictly below 200 ms.
The file facts are at the 2 MiB maximum; no bytes are fetched or parsed.

Final isolated local run, in milliseconds:
`192.8530, 270.3620, 149.6410, 158.5151, 189.2421`.
**Median: 189.2421 ms**. This passes the specified median bound; it is not a claim
that every request or percentile is below 200 ms.

An earlier full-HTTP run passed at median 78.8926 ms. A later run overlapping the
workspace typecheck/lint failed at median 257.7918 ms; that failure is retained here,
not rounded up to success. After those commands ended, the complete three-file suite
was rerun alone, preserving the same workload and assertion, and produced the final
passing measurement above. The local timing varies and the final CI gate remains
authoritative; any CI failure must be diagnosed under PP-113.

The earlier 87.2386 ms use-case-only measurement is **not** used as full API evidence.
The original synchronous 719.6987 ms parser preview remains historical evidence in
`47-1-validation-and-blocker.md`; heavy execution belongs to 47-1b.

## Verification

- `pnpm typecheck`: 29 tasks successful, latest verification 28 cached, 30.504 seconds.
- `pnpm lint`: 30 tasks successful; boundaries included. Existing warnings retained.
- `pnpm lint:docs`: 0 errors, 29 existing warnings.
- `pnpm module-map:check`, both frontend `api:check` commands and `git diff --check`:
  passed.
- Request/status/production-fence integration specs: **17 passed**, real Postgres on
  private `packages-47-1a` lane and private loopback Redis. Includes atomic rollback on
  outbox failure, file refusal cases, permission/feature refusal, result-update/terminal
  negatives, staff compatibility, cross-tenant writes and function ACLs.
- Request pure-domain specs: **11 passed**. Contract/OpenAPI specs: **7 passed**.
  Role-default policy spec: **1024 passed**. Permission-label spec: **4 passed**.

The first EXPLAIN test assumed a particular index name and failed despite a legitimate
indexed plan. It was corrected to use 1,000 representative previews plus ANALYZE and
assert indexed tenant/id access without forcing a named index or disabling sequential
scans. The amended test passed. No performance bound was weakened.

The local fixture applies the SQL draft only on its private clone when the final
column is absent. **CI refuses that fallback** and requires the actual final migration;
it also checks that the trigger function exists. Final migration generation and a
new private-cluster migration run are still required after the manager grants the lane.
The function/column-grant inventories are updated for that final migration.

## Review and guard passes

Fresh, read-only `gpt-6-astra` medium review found P2 timing coverage and P3 missing
ADR addenda. Both were fixed. A second independent final review verified the fixes,
schema/grants, atomic outbox, query scope and inactive producer and reported **no
remaining confirmed P0–P3 defect**. Neither reviewer ran tests or independently
certified latency; test evidence above comes from the implementation session.

Clean-code-guard, test-guard and docs-guard were applied to the final scope. No provider
work was added to the transaction, no money code was changed, test fixtures restore
permission/feature mutations, and docs distinguish local evidence from pending CI.

## Carryover and next step

47-1b code is preserved in stash `8595ab7fe7dd0e7db5f58e444b534be923b8420e`.
Its untracked-tree commit is `fabd0041415ae2339c8ca4202069dfcb3efa24dd`.
Do not pop the whole stash onto 47-1a or onto merged main: restore the B-specific
parser/domain/reader files selectively, retain the approved A request/status/schema,
rebase shared files, and regenerate generated artifacts. The same session starts B
only after A merges; the manager owns the merge.

**Recommended next step:** grant the migration lane. Then rebase if needed, generate
the final schema migration, transfer the reviewed seed/trigger/grants without duplicate
DDL, rerun migration/own tests and checks, and push/open exactly one 47-1a PR. No merge
or deployment is delegated to this session.
