# 49-1 — remaining initial implementation brief

The contracts are accepted and CS-Q39's answer is incorporated. On 2026-11-01 at 12:28 Kuwait the manager authorized
the private database draft stage in [brief-49-1-database.md](brief-49-1-database.md): MiniMax may author the schema,
migration/RLS and isolation proof; the lead may run provisional migrations only on this worktree's private database.
The manager explicitly released the lane at 16:06 Kuwait on 2026-11-01 after #757 merged at 185f328f; final generation
starts after main's 0195. The lead publishes only after the four-kind correction, regeneration and required validation.
The approved design and evidence are in [plan-49-1.md](plan-49-1.md), incorporating the independent Astra design advice.
Keep the same initial implementer's ownership and one 49-1 PR; this document is not a new task or PR split.

## Scope and boundaries

Deliver FR-011 to FR-013, CM-11 to CM-13 and CM-R02. CS-Q39's final decision is choice 1 from both owners, relayed 2026-11-01 at 16:06 Kuwait; Waleed confirmed «لأ، الأربع اختيارات بس». Only FOLLOW_PLAN, ZERO, PCT and FIXED are accepted. Remove the earlier fifth-kind implementation before publication.
No UI, estimate endpoint, notification, extra permission seed, generic transaction framework, or live catalog
repricing. Keep every existing 48-2 behavior. Do not touch customers, packages, catalog mutation paths or other lanes.

The necessary out-of-commissions change is a narrow read-only staff export:
`employeeExistsInBusiness(tx, companyId, businessId, employeeId)`, with `deleted_at IS NULL` and no lock.
Implement it in staff persistence, export from staff/index.ts, and test existence, tenant/business ownership and
deleted employees. Existing employeeNamesByUser and performer readers have different keys/eligibility; the existing
write lock is inappropriate for a GET. No second direct employees-table query is added to commissions.

## Implementation order

1. Reuse the four-kind catalog input/response rule contracts directly; no override-specific union extension.
2. Under the 12:28 private-draft authorization, author the override Drizzle schema, tenant-qualified FKs, CHECKs and planned indexes,
   migration/RLS/grants and negative tests. Parent runs generation and tests after reviewing source; the implementer
   does not run commands. Local generated numbers are provisional placeholders, never reservations; final numbers
   are regenerated against main as 0196/0197 under the 16:06 lane grant. A new table and its isolation proof land together.
3. Keep the existing four-kind engine override types and resolver unchanged, including latest-created/id ordering and fallback to the saved snapshot only when no eligible override exists. Reuse domain/plan-periods.ts unchanged where possible. Add SERVICE_NOT_FOUND to the existing typed error union
   and update its Arabic documentation. Move lockThroughDecision into a narrow use-cases helper shared by the two
   writers. No clock calls, async locks or I/O callbacks enter domain/.
4. Share the concrete lock-scope construction. Create the override transaction/scope/writer ports and adapters,
   keeping the two withTenant/runIdempotent wrappers explicit. Do not introduce runCommissionInputWrite<T>.
5. Add create-commission-service-override use case and its thin HTTP controller. Reuse permission/feature,
   Idempotency, actor and exception-mapping patterns. Add no module index export for a repository/use case.
6. Add the current/history query with a query-local reader factory and root bindings on the caller's same Tx.
7. Add integration/lock/race/query tests and update ADR-0054 section 4 and module-map Port rows for actual readers.
   Parent regenerates OpenAPI, admin/pos clients and the module map if required by source changes.

## Mandatory write order

Before runIdempotent, recheck access and commissions feature in the tenant transaction. This applies to stored
replays as well. The fresh callback then locks the active employee, checks service existence in the same business,
reads the business calendar, and rejects an ordinary past effective date before lockPeriods can create statements.

Acquire statement periods in ascending order, re-sample the injected Clock after waiting and lock newly reached
months until the set is complete. Apply the final pure date/status check. A closed period refuses the write.
Reopen REVIEWED to DRAFT and clear all reviewed fields within the same transaction. Recheck locked access/feature,
insert with IdGenerator and the decision time, and append commission_override.created audit with entity
commission_service_override. Row, audit, review invalidation and idempotent response roll back together on failure.
Follow the existing audit pattern without salary or customer data. No newly invented outbox event.

Service existence uses a commissions-owned root-bound reader implemented with
`readSessionServices(tx, companyId, businessId, [serviceId])`. Do not use the returned current catalog rule to price
historical sessions. Root readers reuse the current BusinessCalendarPort, EmployeeRowLockPort and
CommissionPlanAccessPort; widen their Arabic comments in the same commit where their consumers change.

## Read design

Define OverrideListReadsFactory beside queries/commission-service-overrides.query.ts, on the established
EmployeeAppLinkNames pattern. Its same-Tx instance supplies business timezone and employee existence. The adapter receives callbacks bound in app.ts to tenancy.businessTimeZone and staff.employeeExistsInBusiness on the same transaction. The commissions -> staff import arrow already exists; add the Port row in module-map section 3. For this callback-bound form no module imports the staff index, so no reads entry is needed under ADR-0054 section 4. If a concrete commissions adapter directly imports staff instead, declare its exact symbol/file in reads and regenerate module-map.yaml. Run module-map:check for the implemented form. HTTP injects this query-local interface, never a
write-side port; queries import no domain/use-case/engine and perform no cross-context join.

Rows expose saved contract fields, effective_from and is_current. Current means eligible on the business-local date,
with no eligible same-employee/service row whose (created_at,id) is greater. Use correlated NOT EXISTS; its competitor
query has no page cursor condition. Sort service_id ASC, created_at DESC, id DESC. The next page has a larger service,
or the same service and smaller (created_at,id). Cursor timestamps retain raw UTC microseconds, not Date or the
millisecond response representation. Validate decoded shape, scope and optional service filter; bad cursors give a
known 400. Do not add predictive SCHEDULED/SUPERSEDED statuses or application-side current-row selection.

The lookup index is (company_id,business_id,employee_id,service_id,created_at DESC,id DESC); add the service FK index
(company_id,business_id,service_id) and global creator FK index (created_by). Prove list plans for filtered and
unfiltered shapes with EXPLAIN. No additional speculative index or cross-module import arrow.

## Required proof

- CM-11: save PCT 1500, read the saved override and feed it to the existing computePeriod with a 20.000 KWD service
  and a 50% performer share. Expect 1.500 KWD. Make snapshot and plan different to prove precedence; one row/audit.
- CM-12: all four override kinds, missing-override snapshot fallback, rejection of the unapproved fifth kind, unchanged catalog rule union, and same-time id tie breaking.
- CM-13: past/future dates, closed periods, review invalidation and rollback, midnight/month rollover during locks,
  permission/feature revocation while waiting, approval race and lock-before-first-write gate.
- Idempotency: identical replay once, mismatch 422 IDEMPOTENCY_KEY_REUSED, busy 409, concurrent duplicates once,
  rollback, and replay refused after access removal. No guessed success receipts.
- List: complete DTO and stable pages, optional service filter, an off-page winning competitor, equal timestamp/id
  ordering, different microseconds inside one millisecond, missing/deleted employee, wrong business and tenant.
- CM-R02: FORCE RLS and all required tenant negative checks, insert-only runtime grants, every CHECK, and tenant/
  business-qualified employee/service FKs. Use a private local Postgres lane with cloned per-spec databases.
- Existing 48-2 tests continue to pass after extraction. They supplement, not replace, the override path tests.

No check executes before the parent reads every changed file. The parent applies clean-code-guard, test-guard and
docs-guard, runs scoped proof and generated-client checks, then obtains the required fresh independent code/DB review
and current-head CI/GitHub receipts. Full workspace proof is mandatory on CI. No migration, server or release gate is
waived by this brief.

## Dispatch limits

File read/edit only, no shell, git, commands, tests, scripts, network, MCP, secrets, .env*, .git or outside-worktree
reads; no publication or server actions. Declare final file paths in the actual stage dispatch before permitting
writes. Root verifies the child's actual git top-level after every dispatch. Failed worktree preparation means a new
delegate_task, never retrying in that child thread. Do not modify parent-owned audit/plan files or unrelated formatting.
