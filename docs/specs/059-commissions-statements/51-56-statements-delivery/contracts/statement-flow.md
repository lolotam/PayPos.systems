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
| 51-1 PR 2 | `GET …/:period` | `read:commissions:business`, branch scope CS-Q20 | the view: `generated`, both current fingerprints, blocking issues, rows filtered to the reader's branch set; writes nothing | 403 on an empty branch set | FR-026, FR-027 |
| 52-1 | `POST …/:period/review` `{ expected_fingerprint, expected_statement_fingerprint }` | `review:commissions:business`, business-wide reader | REVIEWED | 422 `COMMISSION_STATEMENT_BLOCKED`, 409 `COMMISSION_FINGERPRINT_STALE` | FR-029 |
| 52-1 | `POST …/:period/return` `{ reason }` | as FR-031 states | DRAFT | 422 `COMMISSION_RETURN_REASON_INVALID`, 409 `COMMISSION_STATEMENT_NOT_REVIEWED` | FR-031 |
| 53-2 | `POST …/:period/approve` `{ expected_fingerprint, expected_statement_fingerprint }` | `approve:commissions:business`, business-wide reader | APPROVED | 409 `COMMISSION_UPDATES_PENDING` (retryable), 409 `COMMISSION_FINGERPRINT_STALE`, 409 `COMMISSION_STATEMENT_NOT_REVIEWED`, 422 `COMMISSION_STATEMENT_BLOCKED` | FR-032…FR-036 |
| 54-1 | `POST …/:period/mark-paid` `{ paid_method, paid_on }` plus the optional note of CS-Q6 | `pay:commissions:business` | PAID | 409 `COMMISSION_STATEMENT_NOT_APPROVED`, 409 `COMMISSION_STATEMENT_ALREADY_PAID` | FR-037, FR-038 |
| 56-1c | `POST …/:period/exports` | `read:commissions:business`, branch scope | 202 `{ render_id }` | as FR-050 | FR-050 |
| 56-1c | poll and collect-once by `render_id` | `read:commissions:business`; the requester's scope is re-checked at collect | status / the xlsx bytes; audit `commission_statement.exported` per collected download | the ADR-0049 transport's codes | FR-052, plan-56-1.md §1 |

## Invariants every write route keeps

1. One `withTenant(companyId, tx => …, { userId })` transaction; access is re-checked inside it before any replay.
2. One ascending `lockStatementPeriods` call; no status is read before its lock.
3. The outbox event and the audit entry are written in that transaction.
4. A fingerprint mismatch reports `changed` (`INPUTS` or `STATEMENT`; `INPUTS` when both differ) and `return_required`.
5. No amount, salary or employee name is placed in a notification payload (spec 059 §6 _Events_).

## Non-HTTP contracts

| Part | Contract |
| --- | --- |
| 53-1 | `public.statement_pending_commission_events(approval_started_at)` called with the transaction's own timestamp as lossless text (ADR-0012 §1) |
| #1032 | The coverage report: overall `COVERED` only when every section was checked and covered; a tips state «not checked»; a non-zero exit otherwise; `COMMISSION_COVERAGE_SCOPE_INVALID` for a foreign or empty business list (research R9) |
| 56b-1 | The reminder job and the recovery contract of FR-053 _CS-Q32_, fixed by ADR-0061 |
| 52-1, 56b-1 | Recipients and channels of statement notices come from a commissions `AlertRulesPort` adapter (spec 060 §Relates) |
