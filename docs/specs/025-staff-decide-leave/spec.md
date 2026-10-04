# Staff — decide and revoke leave

Date: 2026-10-04. Phase 1 PR 18. Sources: spec 023, ADR-0026, ADR-0025,
ADR-0018, Phase 1 SPEC §§3–4 and PRD P1-T3.2/T3.4/P1-T11.2.

## Owner decisions — 2026-10-04

Branch Manager, Business Manager, General Manager and Owner approve/reject within
their verified membership scope. Nobody decides their own employee's leave,
including through another membership or when someone else requested it on their behalf.
Compare the locked Employee.user_id to the authenticated global user, never membership id.
Rejection requires a trimmed reason of 1–500 characters. Approval accepts an optional
trimmed reason of 1–500 characters. Only PENDING requests can be decided.
Every decision is audited and emits LeaveApproved or LeaveRejected in the same transaction.
Cancel and decision take the same company → ordered memberships → employee → leave locks:
one succeeds and the other receives LEAVE_NOT_PENDING. Matching revisions are required.
Unknown and inaccessible employees/requests have identical NOT_FOUND envelopes. Pipes
validate before lookup, so identical invalid bodies have identical 400 envelopes too.
One injected Clock instant, sampled after lock waits, drives authority, feature expiry,
recorded timestamps and revocation deadlines. Personal/kiosk sessions remain own-read only
for decisions: they cannot use manager decision/revocation routes or inherit business grants.

## Owner decisions on the recommended defaults — 2026-10-04 (DL-Q1–Q4)

- DL-Q1 — owner decision 2026-10-04 (recommended option): refuse approval overlapping another APPROVED request of the same
  employee across branches with LEAVE_APPROVED_OVERLAP. Ignore the request itself; adjacent
  half-open intervals are allowed. Existing GiST exclusion additionally protects active leave.
- DL-Q2 — owner decision 2026-10-04 (recommended option): an in-scope approver may revoke APPROVED leave with a mandatory trimmed
  1–500 character reason strictly before starts_at. Equality/after start refuses
  LEAVE_ALREADY_STARTED; other statuses refuse LEAVE_NOT_APPROVED. Use CANCELLED with separate
  revoked_by/at/revocation_reason, retaining original decision and its reason. Do not allow
  self-revocation either. No correction after start (attendance PR 26).
- DL-Q3 — owner decision 2026-10-04 (recommended option): no notification delivery in this slice. PR 4b stores in-app notifications
  for normal user sessions, but its /v1/me/notifications route accepts neither ADR-0019 kiosk
  nor ADR-0027 LIMITED personal staff sessions. Recommend adding a staff-purpose own inbox
  before enabling LeaveApproved/LeaveRejected/LeaveRevoked in-app delivery. WhatsApp/email are off.
- DL-Q4 — owner decision 2026-10-04 (recommended option): decide:leave:branch and revoke:leave:branch default to the four approver
  roles. Other human roles may receive personal ALLOW; Device is always forbidden, including
  historical ALLOWs. Delegated users need a separate read:leave:branch ALLOW for the manager
  inbox/history; make that read cell optional for all human roles without changing its defaults.
  Non-owner DENY always wins; canonical Owner immunity remains, but never bypasses self-decision.

## Contract and schema

POST /v1/businesses/{businessId}/employees/{employeeId}/leave-requests/{leaveId}/decide
accepts {decision: APPROVED|REJECTED, expected_revision, reason?}.
POST .../{leaveId}/revoke accepts {expected_revision, reason}. Both require Idempotency-Key
and selected-company admin authentication, and return the full LeaveRequest (200).
Idempotency fingerprints include action, leave id, input and actor; authorization precedes replay.

Existing pending inbox GET /v1/businesses/{businessId}/leave-requests gains branch_id/from/to
filters, applied before cursor pagination. Dates filter intersection with the saved local
inclusive dates; no browser timezone reinterpretation. A reversed range is invalid.
These filters are inbox-only: own history stays business-wide (spec 023), and the personal
session's required branch_id selects the session, never filters the list.
Employee history and own lists expose decision_reason, existing rejection_reason and revocation
actor/time/reason. Manager items expose can_decide/can_revoke; own items are always false.

Keep rejection_reason for compatibility and write the same rejected reason to decision_reason.
Add nullable decision_reason, revoked_by/at and revocation_reason. Expand the status shape to
distinguish pending cancellation from approved revocation and preserve the old decision.
New migrations only: schema/checks/index expansion and custom grants/catalog/default bundles.
FORCE RLS and tenant-qualified employee/branch FKs remain. Update privileges are column-scoped.
Indexes start with company_id for branch/date inbox filters and revocation actor FK.
Audit/event snapshots omit all free-form notes/reasons; employee read responses include them.
Events include stable identity, saved interval, actor/time and revision. No new module import,
dependency, external transport, startup setting, leave balance or financial effect.

## Acceptance scenarios and tests

- DL-01: approval/rejection and optional/required trimmed reasons, 1/500/501 boundaries.
- DL-02: exhaustive status/revision/self-user transition matrix; approval preserves captured
  timezone/interval; revocation at before/equal/after start, both units and DST intervals.
- DL-03: all four default approvers in scope; branch isolation, non-owner covering DENY,
  expired grants/feature using the sampled Clock, Device forbidden, delegated personal ALLOW.
- DL-04: a second membership and an on-behalf requester cannot bypass the self-decision rule.
- DL-05: HTTP full-envelope equality for unknown/inaccessible ids with valid and invalid bodies;
  personal/kiosk manager refusal; own read shows decisions/reasons without manager capability.
- DL-06: replay once, changed body/key conflict, rollback with zero audit/event/idempotency effects;
  cancel-versus-decide and decide-versus-decide races commit one transition.
- DL-07: overlap with another APPROVED request refuses; self/adjacent/rejected/cancelled excluded.
- DL-08: revocation saves original decision and audit/event; deadline uses injected Clock, with
  no direct PostgreSQL now()/clock_timestamp() business decision.
- DL-09: RLS negatives for new decision/revocation updates, column grants, schema checks,
  immutable default migration replay, fresh-database migration order.
- DL-10: inbox branch/date filters, pagination, self action flags, result-shape and EXPLAIN index
  assertions; admin inbox approve/reject/reasons, filters, employee history revoke/decision display,
  bilingual text and generated client hooks with scoped cache invalidation.
- DL-11: pnpm check (FORCE_COLOR unset), API/admin builds and POS build when generated types change.
