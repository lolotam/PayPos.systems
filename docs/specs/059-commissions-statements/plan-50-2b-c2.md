# 50-2b card 2 — tips and salary projection consumer (implementation plan)

Status: PLAN for batch 2026-11-11 (PP-168). Base `origin/main` 73dbfc2fd. Branch `feat/p1-059-50-projection-consumer`.
History and earlier budgets: `plan-50-2b-c2-planning.md` (Revisions 1–3, unchanged). Card 3 (the staff reader
`readEmployeeBusiness`) is merged as #898; card 1 tables as #844; reducers as #813.

## Scope

`SessionTipsChanged` and `SalaryChanged` join the existing consumer `commissions.project-inputs` (FR-014), with
CM-18, CM-19 and CM-25 (handler half). Out of scope: 50-3 replay/bootstrap (its open items are owner questions
CS-Q41…CS-Q44, PENDING), 50-4 package sales, 55-1 corrections, any producer change, migration, grant, route, UI.

## Rules this card relies on (spec 059)

- FR-015 order per event, one `withTenant` transaction, mark first (deliverer) then handler: identity locks
  ascending → read held state → drop stale → affected periods from locked state → one ascending `lockStatementPeriods`
  for affected + candidates through the current month → classify affected only → write → reopen REVIEWED → done.
- FR-017: malformed money throws `CommissionTipSalaryInputInvalidError` (reducers already do), never zero.
- FR-018b / CM-25: `business_id` absent → staff `readEmployeeBusiness` on the delivery Tx, once; `null` → typed
  `CommissionEmployeeBusinessMissingError`, rollback (no projection, no mark). Present → used as is; the composite
  FK `(company, business, employee)` refuses a mismatch.
- FR-042: a salary entry affects every month whose last day is in `[effective_from, next_from)`, capped at the
  business-current month (injected Clock + tenancy timezone, read once) and floored at the business start month
  (manager decision D2). Empty range → no statement lock, row still written.
- Interim closed-period guard (new sub-bullet under FR-015, this card): an affected APPROVED/PAID month throws
  `CommissionPeriodClosedError` before any write, exactly as 50-1 does for lines; 55-1 replaces it with the
  correction step. Approval (53-2) is not reachable before 55-2 and 50-3, so no real closed month exists yet.
  Manager decision D1 (2026-11-11, option 1) settles this extension (see "Manager decisions").

## Design

Locks (advisory xact, same text shape as 50-1, `app_company_id()::text || ':<kind>:' || <id>`):
tips `commission-tip-session:<session_id>`; salary `commission-salary-employee:<employee_id>` first, then
`commission-salary:<employee_id>:<effective_from>`. The employee lock serializes different-date inserts, which change
`next_from`; the identity lock keeps FR-015's key for 50-3. Lock order is always identity locks, then statements.

Tips: read held head by `(company, session)` (not by business). Reducer `reduceCommissionTips`. Not applied → return.
Held business ≠ event business → `CommissionTipSalaryInputInvalidError('TIP_IDENTITY_CHANGED')`. Branch/date may
change; affected = held period ∪ new period. Write: head upsert `ON CONFLICT (company_id, session_id) DO UPDATE SET
revision, branch_id, business_date, period` (card-1 column grants), `DELETE` the session's tips, insert the new rows
with new UUID v7 ids; an empty set keeps the head (CM-18).

Salary: resolve business; read held row by `(company, employee, effective_from)` and `next_from` = smallest later
`effective_from` of the employee; reducer `reduceCommissionSalaries`. Held business ≠ resolved →
`'SALARY_IDENTITY_CHANGED'`. The business calendar (time zone + `created_at`, one read) gives the current month and
the start month `currentBusinessPeriod(created_at, timeZone)`; a missing business throws
`CommissionBusinessMissingError`. Write: `INSERT … ON CONFLICT (company_id, employee_id, effective_from) DO UPDATE SET
amount, revision`.

Envelope checks: `SessionTipsChanged` needs `aggregate_type='service_session'` and `aggregate_id=session_id`;
`SalaryChanged` needs `'employee'` and `employee_id`. Company always from the envelope. No amount or payload logged.

## Files (CLAUDE.md §1 order; no contract, no migration)

| Layer | File | Owner |
| --- | --- | --- |
| domain | `domain/commission-tip-salary-periods.ts` (new): `salaryAffectedPeriods`, `tipAffectedPeriods`, identity checks | Kimi |
| domain | `domain/errors.ts`: `CommissionEmployeeBusinessMissingError` | Kimi |
| ports | `ports/commission-tip-salary-projection.port.ts` (new): tip and salary scopes | Kimi |
| use case | `use-cases/project-session-tips/project-session-tips.ts`, `use-cases/project-salary/project-salary.ts` (new) | Kimi |
| persistence | `persistence/commission-tip-salary-projection.scope.ts` (new), `EmployeeBusinessReader` and `BusinessCalendarReader` types | Kimi |
| tenancy | worker `tenancy/persistence/business-calendar.ts` (new, mirrors the API `businessCalendar`), add-only export in `tenancy/index.ts` | Kimi |
| events | `events/handlers/on-commission-input-event.handler.ts`: route five types | Kimi |
| wiring | `commissions.module.ts` (required `employeeBusiness`, `businessCalendar`), `apps/worker/src/main.ts` (bind both, add-only) | Kimi |
| tests | domain unit spec; integration specs through `createDeliverer`; 7 existing call sites get the two dependencies | Agy |
| docs | this plan, debate file, spec FR-015/FR-042, module-map Port rows + two event rows, owner questions | Claude |

## Tests (Agy; real Postgres, durable rows and marks, not mock calls)

CM-18 newer/equal/older, empty replacement keeps head, stale cannot resurrect, CASH/CARD apart, distinct event ids
each marked; CM-19 same-date newer wins, equal/older no-op, dates coexist, exact money incl. `0.000` and
`99999999999.999`; CM-25 legacy event resolves and applies once, duplicate event id skips handler and reader, null
reader leaves no row and no mark, active and soft-deleted employee; atomicity (failure after writes rolls back
effect + mark, retry commits once); concurrency with advisory-lock barriers (same session, same salary date,
different dates of one employee); FR-042 range (04-30 vs 05-01 `next_from`, leap Feb, mid-month, future-only, cap,
timezone rollover); closed/reviewed (affected APPROVED fails before writes, candidate-only closed does not, affected
REVIEWED → DRAFT, stale revision does not reopen); isolation (tenant B ids under A refused, no payload override);
regression (three line types unchanged, one consumer id, five event types).

## Size estimate (additions + deletions)

Production 520–700; tests 700–950; docs ~150 (this plan, debate record, spec, module-map, owner questions).
Refuse an implementer delivery above 2× its brief's estimate (§14). Group envelope from the planning file:
production remaining 853, tests 907, docs 83 — docs will exceed the envelope (batch-mandated plan, debate and
owner-question records); reported to the manager, not hidden.

## Manager decisions (2026-11-11)

The manager answered both items below with option 1 on 2026-11-11: D1 adopts the fail-before-write guard for tips
and salary until 55-1 adds corrections; D2 floors salary statements at the business start month (as PP-85 does for
plan periods), the salary row is still written, through a small worker tenancy reader of the business creation date.
The docs overrun is accepted. CS-Q41…CS-Q44 stay PENDING (they block only 50-3). The options as asked:

- **D1 — interim closed-period guard for tips and salary.** Options: (1, recommended) adopt the fail-before-write
  guard above, temporary until 55-1/55-2 corrections, on the evidence that at `73dbfc2fd` no approve route is
  registered (`apps/api/src/modules/commissions/commissions.module.ts`) and 53-2 depends on 55-2 and 50-3; (2) no
  guard, replan card 2 behind 55-1. Blocks: the whole card.
- **D2 — lower bound of the salary month range.** `lockStatementPeriods` creates one DRAFT statement per locked
  month, so an old legacy salary (e.g. 2015) would create about 130 statements in one delivery. Options:
  (1, recommended) clamp the affected and candidate months to the business start month (business `created_at` in its
  time zone), as the API already floors plan periods (`plan-periods.ts`, `lock-through-decision.ts`, PP-85); the
  salary row is still written. Costs an add-only tenancy reader in the worker and roughly +40–60 production and
  +40 test lines. (2) no floor, accept one DRAFT statement per month back to `effective_from` (D-13). Blocks: the
  salary half and its tests.
- Accepted from the advisor without a decision: the API journey fixture binds an inline `employeeBusiness` stub
  instead of a new worker-source import (PP-115 is still PENDING).

## Risks

Salary range can lock many months for an old first entry (one statement row per month, as D-13 requires);
`main.ts` is shared with other sessions (add-only line); the API journey fixture imports the worker consumer
(PP-115) and needs the new dependency.
