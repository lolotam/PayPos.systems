# ADR-0040 — Attendance change requests

Date: 2026-10-10. Status: Accepted technical design for spec 044, Phase 1 row 26a.
Owner decisions: ACR-Q1–ACR-Q22, Waleed, 2026-10-10.

## Context

Adding and voiding attendance require an approver's decision. The lifecycle must merge
before the independent applying slices 26b and 26c, without permitting requests
that wait for unavailable code. Ordinary corrections remain unchanged.

## Decision

The production `ATTENDANCE_CHANGE_KINDS` provider uses
`createAttendanceChangeKinds([])`. Missing kinds fail before any write. Tests
override this provider with a test-only planner. The kinds port enables testing
the lifecycle independently and the two forthcoming implementations justify it
under architecture §12. Its transaction capability stays opaque to use cases;
kind persistence adapters apply their effects on that same tenant transaction.

Request authority is `request:attendance-change:branch`. ACR-Q4 moved to option 2
on 2026-10-10: decision authority is `decide:attendance-change:company`, evaluated
server-side on the request's business and branch. Only the owner role receives it
by default; the owner can delegate it through personal ALLOW or a custom role.
Migration 0113 adds the permission and owner default without altering tenant data.

Orchestrator defaults pending owner review: only owners may grant, deny or revoke
the decide permission (`PERMISSION_OWNER_ONLY` otherwise); devices cannot hold it;
non-owner holders cannot decide requests they filed or requests about their own
attendance (`ATTENDANCE_CHANGE_SELF_FORBIDDEN`). Missing authority stays `NOT_FOUND`.
The canonical owner flag still identifies every active global Owner membership
at COMPANY scope. Owners may decide their own attendance (ACR-Q22c), and only their
filing is recorded APPROVED immediately, with both requested and approved audits
(ACR-Q2). A delegated holder's filing remains PENDING.

Every write performs a non-locking authority precheck, locks AttendanceState,
then identity's company and ordered memberships, then the request row. It samples
the injected clock again and re-reads authority before acting. This follows
ADR-0028 and serializes decisions, withdrawals, scans and corrections. Approval
re-runs the kind check under locks; a refusal rolls back and leaves PENDING.
All writes are idempotent and retain effects, audit and outbox in one transaction.

Events carry facts without reasons. Pending requests notify active holders of the
decide permission on the request's business/branch, always including owners.
They exclude the requester and the employee unless that employee is an owner
(orchestrator defaults pending owner review), in deduplicated, sorted groups of
at most 100. Identity resolves candidate memberships and grants in batches using
the same role/override eligibility and DENY precedence as the access reader.
Decisions notify only the requester unless they made the decision. Zero recipients still produces an event
without notification recipients; withdrawal produces none. Names use the
ADR-0037 safe display-name fallback. A decision reason enters only the requester's
notice and is replaced by `-` when missing, over 255 characters or unsafe.

The read adapter reuses the declared staff-to-identity and staff-to-tenancy reads;
the list joins only staff-owned requests and employees. Decide holders see the business;
other callers see branches covered by their request permission. `can_decide` also
requires permission on the row's branch, PENDING, and the self rules. No new module
import arrow is introduced.

## Consequences

This release cannot create a production change request until an applying kind
is registered. It nevertheless provides and tests the complete approval lifecycle.
The new tenant table has FORCE RLS, limited column UPDATE and no DELETE grant.
No attendance session schema or correction/exception behavior changes.
The kind CHECK remains the explicit `IN ('ADD_SESSION','VOID_SESSION')` list.
26c adds `RESTORE_SESSION` in its own expand migration (ACR-Q21 option 2).

## ADD_SESSION (26b)

The registry now includes ADD_SESSION. The kind scope carries a pre-generated
`requestId`; requested clock-in/out, working date and timezone are stored on filing.
Approval rechecks the manual-day rules under AttendanceState and inserts one CLOSED
MANUAL session. The tenant-qualified session-to-request FK is checked immediately (not
deferrable): 26a's `hold()` persists the request PENDING before `apply`, also on the owner
one-step, so the row the session points at always exists (045 research R1). A partial UNIQUE
index gives each request at most one session, and the CHECK
`attendance_change_requests_add_linked` requires an APPROVED ADD_SESSION to name its session.
VOID_SESSION remains unavailable until 26c. Manual sessions cannot be corrected.

## Addendum 2026-10-21 — the two emitters read the effective alert rule (sub-PR 62-2b)

`AttendanceChangeRequested` and `AttendanceChangeDecided` take their recipients and their channel from the
effective alert rule of their kind, read through settings' public reader on the same transaction (spec 060
D-B13, FR-B17, row 62-2b). The rule gates and adds, it does not replace: `attendanceChangeRecipients`,
`attendanceDecisionRecipients` and `attendanceChangeRecipientGroups` stay as they are, so with no stored rule
and the master switch null the recipients, the groups of a hundred and the payload are exactly what they were.
A closed rule (the kind off, its branch override off, or the master switch off) skips the approver and
requester authority reads entirely and leaves the event in the outbox with its facts and no
`notification_recipients`: the event stays for the rest of the system and only the bell goes away. The rule's
`recipientRoles` add recipients: the users who hold one of those system roles in the event branch's scope (a
company, business or branch membership covering the branch, active at the event time), unioned with the fixed
recipients and deduplicated; the acting user (the requester on a request, the decider on a decision) never
receives the bell, and the employee herself is left out unless she is an owner, exactly as the fixed
recipients are. Those role holders are read through staff's `AlertRulesPort.roleHolders`, whose adapter calls
identity's public `readBranchRoleHolders` on the same transaction (the `staff → identity` arrow already exists,
module-map §1); this addendum is the decision that authorizes that port read, which the ADR-0010 addendum's
settings-only rule for `AlertRulesPort` adapters does not cover.
