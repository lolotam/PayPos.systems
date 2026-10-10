# ADR-0040 — Attendance change requests

Date: 2026-10-10. Status: Accepted technical design for spec 044, Phase 1 row 26a.
Owner decisions: ACR-Q1–ACR-Q22, Waleed, 2026-10-10.

## Context

Adding and voiding attendance require owner approval. The lifecycle must merge
before the independent applying slices 26b and 26c, without permitting requests
that wait for unavailable code. Ordinary corrections remain unchanged.

## Decision

The production `ATTENDANCE_CHANGE_KINDS` provider uses
`createAttendanceChangeKinds([])`. Missing kinds fail before any write. Tests
override this provider with a test-only planner. The kinds port enables testing
the lifecycle independently and the two forthcoming implementations justify it
under architecture §12. Its transaction capability stays opaque to use cases;
kind persistence adapters apply their effects on that same tenant transaction.

Request authority is `request:attendance-change:branch`. Decision authority is
an active membership matching `canonicalOwnerSql`: the fixed global Owner role
at COMPANY scope. This matches every company owner, not one legal owner.
There is deliberately no decide permission and no delegated approval. A personal
grant or custom role named owner cannot acquire this authority. Owner filing is
recorded APPROVED immediately, with both requested and approved audit actions.

Every write performs a non-locking authority precheck, locks AttendanceState,
then identity's company and ordered memberships, then the request row. It samples
the injected clock again and re-reads authority before acting. This follows
ADR-0028 and serializes decisions, withdrawals, scans and corrections. Approval
re-runs the kind check under locks; a refusal rolls back and leaves PENDING.
All writes are idempotent and retain effects, audit and outbox in one transaction.

Events carry facts without reasons. Pending requests notify active owners except
the requester, in deduplicated groups of at most 100. Decisions notify only the
requester unless they made the decision. Zero recipients still produces an event
without notification recipients; withdrawal produces none. Names use the
ADR-0037 safe display-name fallback. A decision reason enters only the requester's
notice and is replaced by `-` when missing, over 255 characters or unsafe.

The read adapter reuses the declared staff-to-identity and staff-to-tenancy reads;
the list joins only staff-owned requests and employees. Owners see the business;
other callers see branches covered by their request permission. No new module
import arrow is introduced.

## Consequences

This release cannot create a production change request until an applying kind
is registered. It nevertheless provides and tests the complete approval lifecycle.
The new tenant table has FORCE RLS, limited column UPDATE and no DELETE grant.
No attendance session schema or correction/exception behavior changes.
