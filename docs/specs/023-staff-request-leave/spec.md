# Staff — request and cancel leave

Date: 2026-10-04. Phase 1 implementation-plan PR 17. Sources: Phase 1 SPEC §§3–4,
PRD P1-T3/P1-T7.4, ADR-0019/0024/0025 and the owner decisions of 2026-10-04.

## User scenarios and testing

- LR-01: an active linked employee uses the paired or LIMITED personal staff session to request their own leave;
  the server resolves the employee, business and branch. A supplied employee identity is rejected.
- LR-02: a manager requests leave on behalf of an eligible employee in an authorized branch.
- LR-03: full days include both entered dates in the branch timezone; partial leave has one
  date and increasing local start/end times on 15-minute steps. Full-day requests span at
  most 90 inclusive civil days. Persisted UTC intervals are half-open.
- LR-04: OTHER needs a trimmed 1–500 character note; other types accept an optional note.
- LR-05: overlapping PENDING/APPROVED leave for the employee is refused with LEAVE_OVERLAP,
  including cross-branch and concurrent requests. Adjacent intervals are allowed.
- LR-06: the original requester or a manager in scope cancels PENDING leave once with a
  matching revision; other statuses refuse cancellation. Cancellation frees the interval.
- LR-07: retries return the same response with one audit and one event; different body/actor
  with the same key refuses. Rollback leaves no request, audit, outbox or idempotency effect.
- LR-08: unknown, foreign, unlinked, deleted and inaccessible resources share NOT_FOUND;
  expired membership, non-owner covering DENY, revoked session/device and disabled staff feature refuse.
- LR-09: employee history and the manager pending inbox paginate within authorized branches,
  without exposing another employee to an own caller. Result shapes and indexes are tested.
- LR-10: admin employee page offers full/partial on-behalf request, history and pending cancel
  with Arabic/English copy and named errors; staff UI remains PR 57b.
- LR-11: restricted-role tests prove FORCE RLS, cross-company SELECT/INSERT/UPDATE/DELETE,
  company reassignment, tenant-qualified FKs, no-context reads and forbidden role access.
- LR-12: every human system role receives own grants, but needs an eligible Employee link;
  manager defaults cover only their membership scope. Device ALLOW cells are forbidden.
- LR-13: request/cancel/history hide employees with no relationship to the authorized
  branch scope before feature, employment, period or revision diagnostics. HTTP regressions
  compare complete NOT_FOUND envelopes against unknown employees, including own routes.
- LR-14: each leave write/read samples its injected Clock once. That same instant drives
  authority and feature-override expiry, current employee eligibility, branch-local today
  and recorded timestamps;
  a frozen Clock on the contract-end day remains valid when PostgreSQL is on the next day.
  Writes sample after authority/employee/request lock waits, so expired permission cannot
  survive a queued request; the resumed operation still uses one shared instant.
  An override expiring between transaction start and that instant is already expired,
  including at the exact deadline; other feature-reader callers retain transaction time.
- LR-15: owner immunity also covers own leave codes: a historical own-leave DENY does not
  reduce an owner, while the same DENY still refuses a non-owner's own request.
- LR-16: schema-invalid create/cancel bodies return identical complete 400 envelopes for
  unknown and inaccessible identities. Schema validation remains before resource lookup.
- LR-17: ADR-0027 personal sessions create/list/cancel only the caller's leave with live
  own permissions, eligibility, non-owner DENY and owner immunity. Manager routes refuse
  personal credentials even if that user also has a manager membership. Personal requests
  require branch_id in the query, following my-schedule; kiosk requests retain their paired
  branch. Neither employee nor workspace identity is accepted from the personal caller.

## Functional requirements and business rules

Types are ANNUAL/SICK/UNPAID/OTHER. No leave balance, entitlement or deduction exists in
Phase 1. New requests are PENDING. Future statuses APPROVED/REJECTED store decider/time and
rejection reason; PR 18 implements approval, prevents self-decision and requires rejection
reason. This slice exposes no decision endpoint.

Employee eligibility uses employment dates and dated branch attachments for the entire
requested local period, with the same employee lock as HR edits/schedules. Branch timezone
uses the business fallback, captured on the request so later settings cannot reinterpret it.
Ambiguous/nonexistent local times are refused under ADR-0024's existing conversion policy.
Own requests accept ADR-0019 kiosk sessions and ADR-0027 LIMITED personal sessions.
Personal authentication uses the existing origin/session/employee guard with an empty
membership/grant principal. Leave checks live own authority separately inside its transaction.
Cancellation is restricted to the actual requested_by user on the own route (a manager may
cancel in scope). An employee cannot use a client employee id or a manager grant as ownership.
Deactivating a branch prevents new requests there; its existing pending requests remain visible
and cancellable to a manager whose scope still covers that branch.

## Recorded owner decisions

- LR-Q1 — owner decision 2026-10-04 (recommended option): partial-day start and end must
  fall on 15-minute steps in the branch's local time (:00/:15/:30/:45). Refuse otherwise
  with LEAVE_TIME_STEP_INVALID and Arabic/English messages. DST gap/fold refusal remains.
- LR-Q2 — owner decision 2026-10-04 (recommended option): full-day requests span at most
  90 inclusive civil days, independent of elapsed UTC hours. Refuse longer periods with
  LEAVE_SPAN_TOO_LONG and Arabic/English messages; no leave balance is introduced.
- LR-Q3 — owner decision 2026-10-04 (recommended option): retain refusal of overlaps with
  the employee's PENDING/APPROVED leave using LEAVE_OVERLAP; adjacent intervals are allowed.
- LR-Q4 — owner decision 2026-10-04 (recommended option): retain manager backdating and
  refuse own requests whose from date precedes branch-local today (LEAVE_PAST_OWN_FORBIDDEN).
- LR-Q5 — owner decision 2026-10-04 (recommended option): retain own read/create/cancel for all 13
  human roles conditional on employee eligibility; on-behalf read/create/cancel for Owner,
  General Manager, Business Manager and Branch Manager in scope; Device forbidden.

## Key entities

LeaveRequest records the employee, branch context, entered local period, resolved UTC period,
kind/type/note, status, request/cancel actors/times and revision. No financial entity changes.

## Success criteria

All LR scenarios pass; concurrent overlapping writes commit at most one active request;
retries have exactly one effect; no employee/company/scope leaks; every user message exists
in both languages; pnpm check and API/admin builds exit 0.

## Slice design

- Contracts: strict Zod request union FULL_DAY {from,to} or PARTIAL {date,start,end},
  shared type/note; cancel {expected_revision}; record and cursor page responses.
- Admin API: POST/GET /v1/businesses/{businessId}/employees/{employeeId}/leave-requests;
  POST .../leave-requests/{leaveId}/cancel; GET /v1/businesses/{businessId}/leave-requests
  (pending inbox). Request body carries branch_id only on the admin route.
- Own API: POST/GET /v1/staff/me/leave-requests and POST .../{leaveId}/cancel; paired
  session/device context or personal session/workspace plus branch_id query. All writes
  require Idempotency-Key, fingerprint includes actor.
  Creation uses the paired branch; own history is employee-bound within its business, and
  requester cancellation remains possible after a branch transfer under current own authority.
- Access: one Authenticated declaration per route plus the existing staff policy or
  SelectedCompanyGuard; live scoped permission/feature checks inside transactions/queries.
  create/read/cancel:leave:own and create/read/cancel:leave:branch. ADR-0026 introduces
  an ownership target distinct from membership scope, with DENY retained.
- Schema: leave_requests (company_id,id) PK; tenant/business-qualified employee and branch
  FKs; type/kind/status/shape/revision checks; company/employee/start/end and company/business/
  branch/status/id indexes, actor indexes. Separate custom FORCE RLS/grants/exclusion migration.
  GiST exclusion over company/employee/tstzrange protects PENDING/APPROVED overlaps even
  for concurrent writers. Separate immutable permission/default migration avoids PR 7d collision.
- Events: LeaveRequested/LeaveCancelled, stable leave identity and revision with employee,
  branch/business, interval and actual actor; written atomically, no external delivery here.
  Audit snapshots exclude free-form note. No balance/notification consumer/startup setting.
- Tests: pure domain matrix, contract tests, real Postgres use-case/concurrency/rollback,
  HTTP scope/session/idempotency, RLS matrix, query shape and EXPLAIN index assertions,
  bilingual admin form/hooks/cancellation coverage and repository gates.
  Limit coverage includes 89/90/91 inclusive days, leap years, every minute offset for
  both partial endpoints, Asia/Kuwait and America/New_York spring/fall DST transitions.
