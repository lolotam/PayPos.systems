# Plan 49-1 — commission service overrides

Status: the lead reviewed the planner draft once and incorporated independent read-only design advice from
`gpt-6-astra` high on 2026-11-01. The advisor found no new proven P0/P1/P2 after the lead's corrections.
This is one 49-1 delivery and one PR. Base at planning: `origin/main` 077d4a15; branch
`feat/p1-49-1-commission-service-overrides` in the existing task worktree.

## 1. Authorization, decisions and remaining gates

The manager confirmed exclusive ownership on 2026-11-01 at 11:16 Kuwait. Row 48a is done, 48 and 50 are in progress,
and 49, 51, 55 and 55b have not shipped, according to the manager's 11:15 decisions-site API read. There were no
partner suggestions. The dependency, 48-2, merged in #730 (444a7ee1).

CS-Q39 = PP-104.1, batch 89, final decision 2026-11-01: retain only FOLLOW_PLAN, ZERO, PCT and FIXED. Waleed changed his page choice from 0 to 1 at 2026-11-01T10:58:53.996Z; Abu Salem chose 1 at 2026-11-01T12:05:48.706Z. Both notes have empty text and no source. The manager relayed the API records at 16:06 Kuwait, correcting the erroneous 16:04 direction. At 16:07 he relayed Waleed's verbatim confirmation «لأ، الأربع اختيارات بس», dated 2026-11-01, channel «كارت في شات مدير الويب». FR-011 is resolved on four kinds; remove the previous FOLLOW_SERVICE implementation before publication. The full chronological record, including the superseded choice 0, remains in owner-questions.ar.md §41.

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
service's snapshot. The only kinds are FOLLOW_PLAN, ZERO, PCT and FIXED. CS-Q39's final decision rejects a reset-to-service kind; preserve the existing engine resolver and its four-kind types.

Preserve the 48-2 write invariants: one tenant transaction; access and feature checks before idempotent replay;
employee row lock; ordered month locks; date validation before statement rows are created; time recheck after a
lock wait; REVIEWED to DRAFT with cleared review evidence; locked access recheck before insert; insert and audit
committed atomically. No arithmetic or database/clock I/O belongs in domain functions.

## 3. Contract stage

The exact bounded stage is [brief-49-1-contracts.md](brief-49-1-contracts.md). MiniMax is the initial implementer,
through T3, with file reads/edits only and no shell, git, network, secrets or publication.

Reuse `serviceCommissionRule` and `serviceCommissionRuleView` from the same contracts package's catalog module:
PCT integer bps 0..10000; FIXED nonnegative numeric(14,3) KWD string with exactly three decimal places.
Export the existing `commissionPlanDate` scalar without changing validation or metadata. Reuse the catalog's four-kind input and response rule schemas directly; do not extend their unions. Request schemas are
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
CHECKs admit only FOLLOW_PLAN, ZERO, PCT and FIXED, require exactly the corresponding numeric column for PCT/FIXED, forbid values
for FOLLOW_PLAN/ZERO, bound bps to 0..10000 and fixed amount to the nonnegative numeric(14,3) range.
Apply the final CS-Q39 answer in contracts and this representation; the engine keeps its existing four-kind behavior.

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
  access(companyId: string, userId: string, businessId: string): Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
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
| Contracts | Four reused rule kinds; reject the unapproved fifth kind; boundaries, lossless FIXED money, strict body/no whole_period, dates/year zero/leap day, cursor/page bounds, OpenAPI references. |
| CM-11 | Save PCT 1500; read saved row; computePeriod for 20.000 KWD line at 50% share yields 1.500 KWD. Different snapshot/plan prove override priority; exactly one row and audit. |
| CM-12 | FOLLOW_PLAN, ZERO, PCT and FIXED only; no eligible override uses the saved line snapshot. Future overrides do not supersede today's winner. Different line snapshots remain different; live catalog changes are irrelevant. Latest creation then id wins. |
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

## 12. Engine-stage receipts

MiniMax changed only commission-types.ts, service-rule.ts and two new focused specs. The lead read all four files.
The existing eligibility/ranking loop is unchanged; the final resolver consumes FOLLOW_SERVICE and returns the
line's saved four-kind snapshot. No catalog type, public export, dependency, rounding or pricing implementation
changed. The lead corrected three test weaknesses before running them: the claimed later-effective-date example
now has that ordering; wrong-employee/service resets compete with an older explicit override so ignoring them has
an observable result; the compile-time exclusion uses Extract instead of a non-distributive union comparison.

Passed: @pospay/commissions-engine typecheck, lint, build, Node export smoke check and all 18 Vitest files,
483 tests. Documentation lint has zero errors and 28 existing warnings; git diff whitespace check passed.
The next bounded initial stage is [brief-49-1-writer.md](brief-49-1-writer.md). HTTP and listing follow that stage
within this same delivery. The private database lane remains owned by this task and no publication gate changes.

## 13. Writer-stage receipts

The lead read the 22 delivered paths. The new writer follows the employee/service/calendar/month-lock sequence,
uses the existing pure date rules, invalidates review evidence and appends the override and audit in one tenant
transaction. The two transaction wrappers remain explicit. Common lock orchestration stays under use-cases and
the shared concrete scope stays in persistence. No arithmetic, new event or cross-module import was introduced.

Executed locally on verified private Postgres 127.0.0.1:55403, with Redis verified local on 127.0.0.1:6379:

- All API workspace dependencies built successfully; final API typecheck passed.
- ESLint on src/modules/commissions and test/harness.ts passed, including layer boundaries. The two existing
  eslint-plugin-boundaries deprecation warnings remain. Documentation lint: zero errors, 28 existing warnings.
- Module-map check and git diff whitespace check passed.
- The commissions Vitest run covered 13 files / 91 tests: 11 files passed, while 4 assertions failed in 2 files.
  After correcting those test defects, the two affected files were rerun: 21 tests passed. Existing 48-2 tests,
  the new lock/replay tests and the scope refactor passed in the first run. This is not recorded as a green run of
  the original full command; the assembled HTTP/query stage will rerun the relevant full commissions suite.

Failures and corrections were retained in the review: TypeScript rejected a malformed it.each satisfies type,
possibly undefined clock samples and unbounded count-array indexing. The lead fixed the test types without casts.
The lead moved the saved-row/engine proof to persistence/commission-service-override-writer.spec.ts: the original
module-root test path cannot import the engine, and a use-cases test cannot import module-root fixtures. The
persistence test placement satisfies both existing rules without a lint exemption. Service-refusal test keys used
spaces (outside the actual visible-ASCII key contract); the keys were corrected. The forced audit error is wrapped
by Drizzle, so the test now asserts its PostgreSQL cause, code P0001 and exact message, and compares all restored
review-evidence fields. No production rejection was weakened to pass a test.

The lead strengthened two other proofs: replay now saves as a granted user, revokes that same user's real grant,
then verifies refusal of the saved response; rollover is tested with real blocking on both October and newly
required November, so forgetting the second month's lock fails. Concurrent contenders must either return the same
saved id or a typed busy error. Minor source corrections derive the stored kind from the accepted contract and
make the Arabic comments describe service existence and the actual lock order accurately.

The next bounded initial stage is [brief-49-1-http-query.md](brief-49-1-http-query.md). Production root binding,
HTTP status/error/access proof, history/current query, staff existence reader, EXPLAIN, module-map Port rows and the
final independent review remain outstanding. No 49-1 branch push or PR has occurred.

## 14. HTTP/list-stage receipts and initial handoff

MiniMax delivered the 19 scoped HTTP/query/staff paths. The lead read each file, completed the root-bound Port
rows in module-map section 3 and the narrow read-interface wording in ADR-0054 section 4, and checked the source
against the approved boundaries. The existing commissions -> staff arrow covers the provider. Callback-only
bindings import no provider inside commissions, so no reads entry or generated YAML change is needed; the final
module-map check passed. Staff owns the new unlocked employee-existence query.

POST/GET are wired through the accepted contracts and existing permission/feature guards. Both input writers
share the existing error mapping. The list uses one tenant transaction, provider-owned timezone and employee
existence, SQL projection into the rule DTO, a cursor-independent current competitor, and raw microsecond cursor
positions. The app's commission bindings were extracted as one group to retain the root function's size limit.

Executed local receipts:

- API typecheck, build and scoped ESLint passed. Documentation lint: zero errors, 28 existing warnings; module-map,
  documentation formatting and diff whitespace checks passed. The two pre-existing boundaries deprecation
  warnings remain. Admin and POS generated-client checks passed; contracts/artifacts were not changed in this stage.
- The assembled commissions/staff run covered 20 files and 127 tests: 18 files / 125 tests passed, with 2 failures
  in pagination and EXPLAIN. After fixing the causes, the four affected read specs passed: 4 files, 18 tests.
- An additional transaction-stable timezone/effective-day proof passed with the full query spec: 1 file, 6 tests.
  The two provider timezones span different calendar days for the same PostgreSQL transaction clock. The test
  exercises real SQL and an uncommitted override on that transaction. The original 20-file command is not claimed
  green; exact-head full CI remains a publication/merge gate.

The lead corrected these initial defects before handoff:

- Cursor validation used Date.parse, which normalizes impossible days and could allow a PostgreSQL 500. It now
  reuses commissionPlanDate, bounds UTC time fields, rejects year zero and extra payload fields, and preserves the
  six-digit fractional text. Public HTTP proofs cover impossible dates/times and extra fields as 400s.
- postgres.js serializes a parameter inferred as timestamptz through Date, losing microseconds even when the
  application's value is a string. Both the query cursor and precise test seeds now bind text and cast inside
  PostgreSQL (`::text::timestamptz`). The off-page test reverses timestamp and id ordering, and the cursor test
  asserts its six-digit position. Both real database proofs pass.
- The generated index uses DESC NULLS LAST, while the first SQL order used DESC's default NULLS FIRST. The query
  now names the same null order. EXPLAIN tests analyze their seeded table and prove the planned index, without
  sequential scans or explicit/incremental sorts; no index or constraint was removed or added for a test.
- Test service targets are real FK-valid catalog rows; the no-write count is captured after setup. Staff fixtures
  no longer link multiple active employees to the same user. Wrong-cursor context is tested against an existing
  target employee rather than conflated with a missing-employee 404. A future-reset case now stores FOLLOW_SERVICE.

The initial implementation is ready for the single fresh independent Astra code/database review. The private
Postgres container remains owned by this task. The migration lane, final numbering/rebase, branch push, PR and
GitHub/CI/merge/release gates remain pending; no publication or server change occurred.

## 15. Independent review and remaining lane gate

The single independent internal reviewer, gpt-6-astra high, reviewed the immutable range
077d4a15b4d3eea76cd197a5e134a764fcffec9e..b123a21ec0e40055b87f487d5011dcea706ea591 from fresh context.
It verified the actual task root and branch before reviewing production code, contracts/engine, database
constraints/FORCE RLS/grants, atomicity/locks/replay, cursor precision and behavior tests. Verdict: no confirmed
P0/P1/P2 findings. The reviewer ran no tests and changed no files; the lead rechecked the clean tree afterwards.
This review covers the implementation at b123a21e; this subsequent receipt changes documentation only.

A fresh read of GitHub after that implementation checkpoint shows 32b-pre-1 PR #757 still OPEN, mergedAt null.
The manager's migration-lane release is still required. No inference of permission is made from a main fetch,
local green checks or the review verdict. Once released, regenerate/renumber the provisional migrations and
snapshots against main, resolve any prerequisite integration changes, rerun affected checks, then publish the one
49-1 PR. Exact-head full CI, all five GitHub reviews, backup and authorized release gates still apply.

The original assembled API receipt remains 125/127 followed by passing affected reruns and the extra timezone
proof. It is not rewritten as a successful full run. No 49-1 branch push, PR, merge or server change has occurred.

## 16. Manager-confirmed queue; explicit release still pending

The manager's 2026-11-01 14:17 Kuwait instruction confirms 49-1 is next after 32b-pre-1 PR #757 merges;
34-pre-1 follows 49-1. This confirms queue order only. The manager will separately send the explicit message
«lane granted». Until that message arrives, do not push this branch, open a PR or reserve migration numbers.
0194/0195 remain unreserved local placeholders.

After the explicit release:

1. Rebase onto the new main containing #757.
2. Renumber the two placeholders after main's final migration and regenerate SQL/snapshots/journal.
3. Resolve integration changes introduced by the prerequisite and rerun affected gates.
4. Rerun the full assembled API suite on the final rebased head. The previously failing command must have a
   complete successful receipt, not only passing reruns of selected files:
   `pnpm --filter @pospay/api exec vitest run src/modules/commissions src/modules/staff/__tests__/employee-exists.spec.ts --maxWorkers=1 --no-file-parallelism`.
   The complete API/package checks and exact-head full CI remain required by the delivery pipeline.
5. Publish one 49-1 PR, with its final numbers and current validation receipts. All five GitHub reviews and
   merge/backup/release gates still apply.

Keep pospay-test-commission-49-1 running from this task worktree while it is needed. Tear it down from this same
worktree when done, through the repository's lane helper and its ownership checks. No other lane is part of cleanup.
This instruction does not grant the lane, authorize a push or waive the original 125/127 failure receipt.

## 17. Final four-kind decision and migration-lane release

On 2026-11-01 at 16:06 Kuwait the manager explicitly granted the migration lane after #757 merged at
185f328f3b0ff50c916a6c62eea5ec96a188c1db. Main's last migration is 0195. The lead rebased this branch onto
that commit, preserving main's 0194/0195 snapshots and journal when the provisional metadata conflicted.
The provisional override SQL files remain unregistered until replacement by fresh generation as 0196/0197;
no previous main migration or snapshot is changed. 34-pre-1 follows this task and waits for the manager's handoff.

The same message corrected CS-Q39: both owners selected zero-based choice 1, retaining only the four agreed
kinds. Waleed's earlier choice 0 was superseded on the page at 10:58:53.996Z. Abu Salem selected 1 at
12:05:48.706Z. Neither wrote note text or a source. At 16:07 the manager relayed Waleed's exact confirmation
«لأ، الأربع اختيارات بس», dated 2026-11-01, channel «كارت في شات مدير الويب». See owner-questions.ar.md §41
for the raw API records and all earlier answers and corrections.

This decision supersedes the fifth-kind instructions and historical receipts in sections 10–16. Update active
briefs, spec and index; remove FOLLOW_SERVICE from production contracts, storage, engine and positive fixtures;
retain negative rejection proofs. The engine returns to its unchanged four-kind implementation. Kimi K3.1 Pro
on T3's OpenCode provider, variant max, owns the bounded correction at baseline a37f4f8a; the lead owns docs,
metadata generation and execution. All earlier test and review receipts describe their original heads and do
not certify this changed head. Regenerate OpenAPI and both clients, test the final migrations on the private
lane, rerun the full assembled API command, complete the affected gates and obtain a fresh independent review
before publishing one PR. Report lane completion to the manager; no merge or release gate is waived.
