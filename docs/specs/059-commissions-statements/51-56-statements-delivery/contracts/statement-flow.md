# Contracts: statement flow routes

Shapes are fixed as Zod schemas in `packages/contracts/src/commissions/` by the part named; this file gathers the
surface so parallel parts do not collide. All routes are under `/v1`, behind the `commissions` feature, refused to
devices, with the error envelope `{ code, message_ar, message_en, details? }`. Money on the wire is a KWD string with
three decimals. Every `POST` takes `Idempotency-Key`.

`…` stands for `/v1/businesses/:businessId/commission-statements`, the prefix spec 059 FR-025 fixes. Paths and bodies
below are quoted from the FR named in the last column. The export's poll and collect paths are not written in any FR;
they follow the ADR-0049 transport and are fixed by 56-1c, which records them in its PR.

| Part | Method and path | Guard | Success | Refusals (codes of spec 059 §6) | Source |
| --- | --- | --- | --- | --- | --- |
| 55-2f | `POST /v1/businesses/:businessId/employees/:employeeId/commission-period-repairs` `{ period, plan }` | `manage:commission-plans:business` | 201 `{ version, blocked_correction: { id, code, resolved } }` (research R3) | 422 `COMMISSION_REPAIR_NOT_ALLOWED`, 422 `COMMISSION_PLAN_INVALID`; a period rollover is refused as retryable | FR-047, plan-55-2.md §9 |
| 51-1 PR 2 | `POST …/:period/generate` | `review:commissions:business`, business-wide reader | the statement view | 422 `COMMISSION_PERIOD_NOT_ENDED` | FR-025, FR-028 |
| 51-1 PR 2 | `GET …/:period` | `read:commissions:business`, branch scope CS-Q20 | **two response shapes** (FR-025, CM-28c): a business-wide reader gets the view with `generated`, both current fingerprints, the changed-since-review flag and cause, and the blocking issues; any other reader gets the status and her filtered rows only, with **no** whole-statement field (no fingerprint, no `reviewed_*`, no changed flag). Two Zod shapes, never optional fields on one. Writes nothing | 403 on an empty branch set | FR-025, FR-027 |
| 52-1 | `POST …/:period/review` `{ expected_fingerprint, expected_statement_fingerprint }` | `review:commissions:business`, business-wide reader | REVIEWED | 422 `COMMISSION_STATEMENT_BLOCKED`, 409 `COMMISSION_FINGERPRINT_STALE` | FR-029 |
| 52-1 | `POST …/:period/return` `{ reason }` | a holder of `review:commissions:business` **or** `approve:commissions:business` **who is a business-wide reader** (FR-031 with CS-Q26 and FR-036: branch grants that together cover every branch are not business-wide; she gets the uniform 403, CM-33d, CM-38b) | DRAFT | 422 `COMMISSION_RETURN_REASON_INVALID`, 409 `COMMISSION_STATEMENT_NOT_REVIEWED` | FR-031 |
| 53-2 | `POST …/:period/approve` `{ expected_fingerprint, expected_statement_fingerprint }` | `approve:commissions:business`, business-wide reader | APPROVED | 409 `COMMISSION_UPDATES_PENDING` (retryable), 409 `COMMISSION_FINGERPRINT_STALE`, 409 `COMMISSION_STATEMENT_NOT_REVIEWED`, 409 `COMMISSION_PERIOD_CLOSED` (a second approver after the wait), 422 `COMMISSION_STATEMENT_BLOCKED` | FR-032…FR-036 |
| 54-1 | `POST …/:period/mark-paid` `{ paid_method, paid_on }` plus the optional note of CS-Q6 | `pay:commissions:business` | PAID | 409 `COMMISSION_STATEMENT_NOT_APPROVED`, 409 `COMMISSION_STATEMENT_ALREADY_PAID` | FR-037, FR-038 |
| 56-1c | `POST …/:period/exports` with the workbook language chosen by the caller (`ar` or `en`, CS-Q33) | `read:commissions:business`, branch scope | 202 `{ render_id }`; the request row stores the scope, and for `BRANCHES` both `branch_ids` (= _R_) and `employee_ids` (from the statement's frozen `EMPLOYEE` rows overlapping _R_), and the language (plan-56-1.md §3) | as FR-050 | FR-050, CS-Q33 |
| 56-1c | poll and collect-once by `render_id` | `read:commissions:business`; the requester's scope is re-checked at collect | status / the xlsx bytes; audit `commission_statement.exported` per collected download | the ADR-0049 transport's codes | FR-052, plan-56-1.md §1 |

## Invariants every write route keeps

1. One `withTenant(companyId, tx => …, { userId })` transaction; access is re-checked inside it before any replay.
2. One ascending `lockStatementPeriods` call; no status is read before its lock.
3. The outbox event and the audit entry are written in that transaction.
4. A fingerprint mismatch reports `changed` (`INPUTS` or `STATEMENT`; `INPUTS` when both differ) and `return_required`.
5. No amount, salary or employee name is placed in a notification payload (spec 059 §6 _Events_).

## Name readers (51-1 PR 2)

The service, customer and branch name readers return **every referenced id**, including historical and deleted ones: an id with no row gets the one shared placeholder (`MISSING_NAME_PLACEHOLDER`, D-21) and never `null`, because the statement builder refuses a missing required name with a `RangeError`. The completion is one function (`completeNames`) used for all three readers, and a test proves that every requested id comes back.

## Non-HTTP contracts

| Part | Contract |
| --- | --- |
| 53-1 | `public.statement_pending_commission_events(approval_started_at)` called with the transaction's own timestamp as lossless text (ADR-0012 §1) |
| #1032 | The coverage report keeps **every** check it has today (missing, stale, and retained counted events without the consumer's mark) and adds: a tips state «not checked»; overall `COVERED` only when no existing check fails **and** every section was checked; a non-zero exit otherwise; the printed result names the businesses and the date range it checked; `COMMISSION_COVERAGE_SCOPE_INVALID` for a foreign or empty business list (research R9) |
| 56b-1 | The reminder job and the recovery contract of FR-053 _CS-Q32_, fixed by ADR-0061 |
| 52-1, 56b-1 | Statement notices read the alert rule through a commissions `AlertRulesPort` adapter (spec 060 §Relates): the rule decides whether the kind is on and its channel. For the approval notice and its reminder the **recipients** are everyone who can approve at the time of the event — holders of `approve:commissions:business` who are business-wide readers, the FR-030 predicate shared with the guard — and the rule's roles do not select them (CS-Q52 = PP-227) |
