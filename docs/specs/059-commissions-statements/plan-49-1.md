# Plan 49-1 — commission service overrides

Status: the lead reviewed the planner draft once and incorporated independent read-only design advice from
`gpt-6-astra` high on 2026-11-01. The advisor found no new proven P0/P1/P2 after the lead's corrections.
This is one 49-1 delivery and one PR. Base at planning: `origin/main` 077d4a15; branch
`feat/p1-49-1-commission-service-overrides` in the existing task worktree.

## 1. Authorization, decisions and remaining gates

The manager confirmed exclusive ownership on 2026-11-01 at 11:16 Kuwait. Row 48a is done, 48 and 50 are in progress,
and 49, 51, 55 and 55b have not shipped, according to the manager's 11:15 decisions-site API read. There were no
partner suggestions. The dependency, 48-2, merged in #730 (444a7ee1).

CS-Q39 = PP-104.1, batch 89: Waleed selected choice 0 on the decisions page at 2026-11-01T09:01:31Z (12:01 Kuwait), without note text or source. The manager relayed the source at 12:03; the final decisions document also has choice 0 at 09:01:32Z. Work follows that choice while Abu Salem remains pending. Add the override-only kind FOLLOW_SERVICE, effective from its saved date and resolving to the snapshot on each line. FR-011 is resolved on this choice. The earlier four-kind-only authorization remains history in the audit record.

At 12:28 Kuwait on 2026-11-01 the manager accepted the contracts and authorized MiniMax to draft the migration
and RLS in this worktree, and the lead to run unnumbered work on this task's private database only, using provisional
placeholder numbers. The migration lane remains with 32b-pre-1, which has not merged; 34-pre is not ready.
The manager must explicitly release the lane before any push carrying the migration or any 49-1 PR is opened.
No migration number is reserved. Final numbering and metadata are regenerated against main before publication.

The manager approved keeping one use case and using a query-local read interface; neither needs an owner decision.
Existing permissions follow CS-Q1 as clarified by CS-Q27: owner and accountant by default, owner-only granting and
revoking. The manager reported at 12:48 that Waleed said «صحّحه لاختيار أبو سالم» around 12:47 and the manager
corrected the site's CS-Q1 final decision to choice 1 with If-Match and a 200 response. This session did not edit
the site. The audit update was pushed in docs-only PR #755, head 23c0c51a; no specification or code behavior changed.
The manager provided the exact CS-Q1 date/empty note and Abu Salem's CS-Q2b note from the API at 11:35; their audit
repairs were pushed in documentation PR #755, head d4c60928. No permission interpretation changed.

## 2. Scope and invariants

Serve spec 059 FR-011 to FR-013, with authorization from FR-010; CM-11 to CM-13 and CM-R02. Deliver contracts,
insert-only tenant storage, create use case and HTTP, and a current/history list. No 49-2 UI or 50-5 estimate endpoint.
CM-11's calculation proof still belongs here: read a saved override and pass it to the existing engine in a test.

The existing engine resolves rules as follows: among overrides for the same employee/service eligible on the
line's business date, latest `createdAt` wins, then greatest `id`. It does not choose the greatest effective date.
With no eligible override it returns that line's rule snapshot. `FOLLOW_PLAN` means the employee plan, not the
service's snapshot. The original four kinds are FOLLOW_PLAN, ZERO, PCT and FIXED. CS-Q39 adds the override-only FOLLOW_SERVICE kind: once selected by the same eligibility/tie order, it returns the line snapshot and does not resume an older override or read the live catalog.

Preserve the 48-2 write invariants: one tenant transaction; access and feature checks before idempotent replay;
employee row lock; ordered month locks; date validation before statement rows are created; time recheck after a
lock wait; REVIEWED to DRAFT with cleared review evidence; locked access recheck before insert; insert and audit
committed atomically. No arithmetic or database/clock I/O belongs in domain functions.

## 3. Contract stage

The exact bounded stage is [brief-49-1-contracts.md](brief-49-1-contracts.md). MiniMax is the initial implementer,
through T3, with file reads/edits only and no shell, git, network, secrets or publication.

Reuse `serviceCommissionRule` and `serviceCommissionRuleView` from the same contracts package's catalog module:
PCT integer bps 0..10000; FIXED nonnegative numeric(14,3) KWD string with exactly three decimal places.
Export the existing `commissionPlanDate` scalar without changing validation or metadata. The override-specific contract extends the reused four-rule options with a valueless FOLLOW_SERVICE branch; ordinary catalog rules remain unchanged. Request schemas are
strict; responses use `responseObject` without forcing unconditional strict behavior.

POST `/v1/businesses/{businessId}/employees/{employeeId}/commission-overrides` takes `{service_id, rule,
effective_from}` and Idempotency-Key. No whole_period. Response: id, employee_id, service_id, rule, effective_from,
created_at and created_by. GET returns those fields plus is_current, with optional service_id filtering and bounded
opaque cursor pagination. Default limit 20, range 1..100; cursor is base64url, 1..512 characters. Page items max 100.

Register named schemas and both OpenAPI paths. Mismatched idempotency body is 422 IDEMPOTENCY_KEY_REUSED; an in-flight
key is 409 IDEMPOTENCY_KEY_IN_PROGRESS. Other expected refusals include 400 malformed input/cursor, uniform 403,
404 employee/service missing, 409 COMMISSION_PERIOD_CLOSED, and 422 COMMISSION_EFFECTIVE_FROM_PAST.
The parent regenerates openapi.json and admin/pos clients after reading the source changes.

## 4. Schema, constraints and indexes — private draft authorized

Add `packages/db/schema/commissions-service-overrides.ts`, exported from schema/index.ts. Follow
commissions-plan-versions.ts and its migration/RLS/grants tests. The physical rule representation follows services:

| Column | Type |
| --- | --- |
| company_id, id, business_id, employee_id, service_id | uuid NOT NULL |
| rule_kind | text NOT NULL |
| rule_pct_bps | integer NULL |
| rule_fixed_amount | numeric(14,3) NULL |
| effective_from | date NOT NULL |
| created_at | timestamptz NOT NULL, explicitly written from injected Clock |
| created_by | uuid NOT NULL |

PK `(company_id,id)`. Tenant-qualified FKs for business and `(company_id,business_id,employee_id)` and
`(company_id,business_id,service_id)`. Use the existing parent unique keys. created_by references global user.id.
CHECKs admit FOLLOW_PLAN, FOLLOW_SERVICE, ZERO, PCT and FIXED, require exactly the corresponding numeric column for PCT/FIXED, forbid values
for FOLLOW_PLAN/FOLLOW_SERVICE/ZERO, bound bps to 0..10000 and fixed amount to the nonnegative numeric(14,3) range.
Apply the CS-Q39 answer in contracts, this representation and the existing engine resolver/types/tests before delivery; do not add FOLLOW_SERVICE to ordinary service rule snapshots.

Indexes:

- `(company_id,business_id,employee_id,service_id,created_at DESC,id DESC)` for list/current selection and employee FK.
- `(company_id,business_id,service_id)` for the service FK.
- `(created_by)` for the global FK.

Enable and FORCE RLS. Allow SELECT/INSERT only to pospay_app with company-scoped USING/WITH CHECK policies.
No UPDATE/DELETE/TRUNCATE runtime grants. Extend tenant-table inventory and negative isolation/grant/constraint
fixtures in the same PR. No raw client export, runtime bypass or new dispatcher/auth grant.
The bounded draft stage is [brief-49-1-database.md](brief-49-1-database.md). MiniMax authors the Drizzle schema,
RLS draft and tests; the lead reviews them before generating or executing migrations. The lead uses the repository
generator for schema SQL and the custom RLS journal entry. Generated local numbers are placeholders only and are
not merge-order reservations. Keep all application and database work in the same eventual 49-1 PR.

## 5. Reader boundaries and minimal reuse

Reuse BusinessCalendarPort, EmployeeRowLockPort and CommissionPlanAccessPort for writes, bound at app.ts. Widen their
Arabic doc comments to cover overrides in the same commit. Service existence can use root-bound
`readSessionServices(tx, companyId, businessId, [serviceId])`. Use its existence result only; do not replace historical
line snapshots with the current catalog rule.

The list needs a new narrow staff-owned `employeeExistsInBusiness(tx, companyId, businessId, employeeId)` read,
with `deleted_at IS NULL` and no row lock, exported from staff/index.ts. Existing lockEmployeeForUpdate is write-side;
employeeNamesByUser uses a different key; performer readers impose different branch/date eligibility. This small
staff addition is necessary to preserve data ownership. Do not copy another employees-table query into commissions.

Declare a read interface next to `queries/commission-service-overrides.query.ts`, like EmployeeAppLinkNames:

```ts
type OverrideListReadsFactory = (tx: Tx) => {
  timeZone(companyId: string, businessId: string): Promise<string | null>;
  employeeExists(companyId: string, businessId: string, employeeId: string): Promise<boolean>;
};
```

Bind it in app.ts to tenancy.businessTimeZone and the new staff reader, on the caller's Tx. HTTP injects the
query-local factory and calls the query within one withTenant; it imports no write port. Queries import no domain,
use case or engine and perform no cross-context join. Add ADR-0054 section 4 and module-map Port rows for the new
root bindings, without a new import arrow: commissions -> staff is already allowed in both map sources. The adapter receives provider callbacks bound in app.ts; because it imports no staff index itself, this root-bound shape needs no reads entry (ADR-0054 section 4). If implementation instead imports a staff value from a commissions adapter, add its exact file/symbol reads entry in the Markdown YAML source and regenerate docs/module-map.yaml. Run pnpm module-map:check on the final shape.

Extract the shared `lockThroughDecision` orchestration into a narrow helper inside use-cases. It calls the existing
pure plan-periods functions; domain never receives I/O callbacks. Share the concrete lock-scope construction between
the two writers. Keep both withTenant/runIdempotent transaction wrappers explicit; no generic transaction framework.
A small shared HTTP error mapper is reasonable for the two controllers. Keep refactors limited to these real users.

## 6. Write path

New create-commission-service-override use-case folder, transactions/scope/writer adapters, and resource controller.
Use the existing manage:commission-plans:business permission, commissions feature, individual admin principal and
Idempotency decorator. No new permission seed.

Order, matching 48-2:

1. Begin withTenant using the verified actor and recheck access/feature before runIdempotent, including replays.
2. Inside the fresh work callback lock the active employee; missing returns EMPLOYEE_NOT_FOUND.
3. Confirm service exists in this business; missing returns SERVICE_NOT_FOUND.
4. Read business calendar. Reject past ordinary effective_from before lockPeriods can create statement rows.
5. Lock affected months in ascending order. Re-sample Clock after waiting and acquire any newly reached month until
   the lock set is complete, using existing pure month helpers. Recheck effective date at the decision instant.
6. Reject a closed period. Reopen REVIEWED periods to DRAFT and clear all reviewed fields, within this transaction.
7. Recheck locked access/feature. Insert the new row using IdGenerator and the decided Clock time.
8. Insert commission_override.created audit entry, entity commission_service_override, without salary or customer data.
9. Commit the row, audit and idempotent response together; any refusal rolls them all back.

The override is insert-only. This spec requires an audit, not a newly invented business event. Do not add an outbox
contract without a requirement. No whole_period or repair behavior is introduced for overrides.

## 7. Current/history query

Sort `service_id ASC, created_at DESC, id DESC`. Apply tenant/business/employee and optional service filter. A row is
current only if effective_from <= the business-local today and no eligible row for the same employee/service has a
greater `(created_at,id)`. A correlated NOT EXISTS expresses this directly; PostgreSQL max(record) is not a design.
The competitor query must ignore the page cursor, so an off-page winner still makes this row non-current.

Keyset: service greater than cursor's service, or same service and `(created_at,id)` smaller. Preserve raw UTC
microsecond precision (US) in the cursor; do not round-trip it through Date or the millisecond response field.
Validate decoded cursor shape and bind it to the tenant/business/employee/filter context. Invalid/mismatched input
returns a known 400. Read only, no lock, no statement row, no audit. EXPLAIN both filtered and unfiltered list shapes.

## 8. Required proof

| Area | Evidence |
| --- | --- |
| Contracts | Five override kinds, unchanged four-kind catalog rules, valueless FOLLOW_SERVICE, and boundaries, lossless FIXED money, strict body/no whole_period, dates/year zero/leap day, cursor/page bounds, OpenAPI references. |
| CM-11 | Save PCT 1500; read saved row; computePeriod for 20.000 KWD line at 50% share yields 1.500 KWD. Different snapshot/plan prove override priority; exactly one row and audit. |
| CM-12 | FOLLOW_PLAN, FOLLOW_SERVICE, ZERO, PCT and FIXED; missing override and winning FOLLOW_SERVICE use the saved line snapshot. Before the reset date the prior override still applies; after it an older override is not resumed. Different line snapshots remain different; live catalog changes are irrelevant. Latest creation then id wins. |
| CM-13 | Past date, future date, closed period, REVIEWED reopen/rollback, day/month rollover during lock waits, access/feature revoked while waiting, approval race and lock-before-first-write gate. |
| Idempotency | Replay same body once, mismatch 422, concurrency once, failed attempt rollback, revoked access cannot replay stored result. |
| List | DTO, service filter, complete stable pagination, off-page current competitor, equal timestamps/id tie and distinct microseconds within one millisecond, missing employee and wrong business/tenant. |
| CM-R02 | RLS negative reads/writes, insert-only grants, no context leakage, all CHECKs and tenant/business-qualified FKs, two-business service FK rejection. |
| Refactor | Existing 48-2 tests still pass; rollover and access behavior preserved. |

Every new query needs result-shape and EXPLAIN assertions. Real DB integration uses a private worktree-owned local
Postgres lane and cloned database per spec, never staging/shared DB. The parent reviews all authored code before
executing it. No worker's claimed check result is counted as a receipt.

## 9. Delivery and dispatch verification

Stage 1 MiniMax owns only the seven contract/test files listed in brief-49-1-contracts.md. The first provider turn failed after writing its original six files; preserve that partial initial work and resume with the same MiniMax model in a new delegate task. No worktree preparation failed in the original shared dispatch. After that delivery, the parent reads all
changes, runs scoped contracts proof, generates artifacts and records results. The same initial implementer retains
ownership of its unfinished initial delivery. The manager accepted the contracts at 12:28 and authorized the private
database draft described in section 4. Publication still waits for the lane gate; the CS-Q39 scope answer is now
available from Waleed, with Abu Salem still pending.

After every dispatch, read the child's actual worktree metadata and run git rev-parse --show-toplevel there before
trusting writes. A failed worktree preparation is never retried in that thread; create a new delegate_task. The
current MiniMax shared checkout was checked: its root is this task's worktree, actual branch
feat/p1-49-1-commission-service-overrides, distinct from F:/Dev/Projects/PosPay.systems/main.

Then apply clean-code-guard, test-guard and docs-guard; scoped local gates, generated-client checks and relevant builds;
one fresh independent Astra code/database review; and the five current-head GitHub reviews plus CI. The exact-head
full check is mandatory in CI. Keep one PR, no open P0/P1, no silent gate waiver. Merge/backup/release follow the
owner-confirmed pipeline and current manager authorization. No migration lane, server change or publication is
implied by this design document.

## 10. Contract-stage receipts

The lead personally read the delivered sources and generated artifacts before executing them. These checks passed
before the manager's 12:28 acceptance; this record does not claim a database or application implementation exists.

- Contracts typecheck, lint, OpenAPI generation and Node export smoke check.
- Contracts Vitest: 70 files, 1109 tests passed with one worker and no file parallelism.
- Admin and POS API generation and generated-artifact checks; both generated client schemas are identical.
- OpenAPI comparison: only the override routes and six schema components were added; prior API definitions match.
- Documentation lint: zero errors, 28 existing warnings. Module-map check: `module map: ok`.
- `git diff --check` passed.

The contracts OpenAPI registration was grouped under `packages/contracts/src/commissions/openapi.ts` to preserve
the 400-line limit of the root registration file. No dependency or lockfile change was required.

## 11. Private database-stage receipts

MiniMax delivered the nine scoped paths in brief-49-1-database.md. The lead read every source and SQL file before
running it. The lead generated the schema migration with the repository wrapper and a separate custom RLS entry,
then transferred the reviewed RLS and removed the unregistered 9999 draft. Local generated placeholders are
0194_2026-11-01_commission-service-overrides and 0195_2026-11-01_commission-service-overrides-rls. These numbers are
not reserved; regenerate SQL and metadata against main after the manager releases the migration lane.

The private container is pospay-test-commission-49-1, owned by this worktree and listening on 127.0.0.1:55403.
The lead verified its worktree label and published port, then pinned both test host and port in the command.
The repository's cloned test databases and migrated template were used; no shared or staging database was accessed.
The ignored local environment files are not part of the change. The container remains owned by this task for the
remaining application integration tests; do not remove another lane's container.

Passed after the lead's small corrections:

- Dependencies built for @pospay/db, then @pospay/db build, typecheck, lint and Node export smoke check.
- Vitest on commission-service-override-constraints.spec.ts, rls-commission-service-overrides.spec.ts and
  privileges.spec.ts: 3 files, 65 tests passed. Repeated after the final fixture correction: 65 tests passed.
- Documentation lint: zero errors, 28 existing warnings. Module-map check and git diff whitespace check passed.
- Snapshot structure inspection: exactly one added table; every existing table unchanged; custom snapshot
  structurally equivalent to its predecessor; valid snapshot-id chain. The schema SQL adds only the new table,
  its CHECKs/FKs and its three indexes. RLS grants SELECT/INSERT only to pospay_app.

Failures were not waived: the first typecheck found missing built workspace dependencies and an unknown[] SQL
parameter type in the new NOT NULL fixture. Building dependencies and typing its string parameters fixed both.
The first fixture fix used a forbidden non-null assertion; the lead replaced indexed access with Object.entries,
then reran lint and typecheck successfully. The lead also corrected the index assertion to the generator's explicit
DESC NULLS LAST output, expanded missing rule-shape cases, and corrected the fixed-amount column comment to KWD.
An initial JSON-string comparison of snapshots reported reordered object keys as a difference; structural comparison
confirmed equal data. No generated schema was changed to satisfy that diagnostic.

This proves storage and isolation only. Engine support, the writer, HTTP/query paths, race tests, CM-11's saved-row
calculation proof, the independent final review and exact-head CI remain outstanding. No 49-1 branch was pushed
and no 49-1 PR was opened.
