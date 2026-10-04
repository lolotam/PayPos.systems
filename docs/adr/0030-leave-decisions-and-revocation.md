# ADR-0030 — Leave decisions and revocation

Date: 2026-10-04. Status: Accepted technical implementation of PR 18.
Business questions DL-Q1–Q4 are settled in spec 025 (owner decision 2026-10-04, recommended options).

## Context

PR 17 captured branch-local periods as UTC instants and reserved APPROVED/REJECTED.
PR 18 must serialize decisions against cancellation and preserve a decision when an
approved request is subsequently revoked. ADR-0026's ownership and privacy rules,
ADR-0025's default bundles/Owner immunity and PR 20's LIMITED sessions still apply.

## Decision

Reuse the existing authority → employee → request lock order for every leave transition.
Sample Clock once after waits and pass its instant to grants, feature expiry and domain rules.
Decision/revocation authorization uses the saved branch, including an inactive branch's
existing requests, as pending manager cancellation does. Before diagnostics, prove both
employee relationship and scoped permission. Compare Employee.user_id to the actual global
actor for self-decision/revocation, including before an idempotent replay; neither another
membership nor Owner immunity bypasses this invariant. Validation pipes remain before lookup.

Keep rejection_reason for existing clients; add a generic decision_reason and separate
revoked_by/at/revocation_reason. A revoked approval has CANCELLED status, retains its original
decision, and leaves cancelled_by/at NULL. A cancelled pending request uses cancelled_by/at
and has no decision/revocation metadata. Expand checks and column-scoped UPDATE privileges
in new migrations, retaining FORCE RLS and the active-interval GiST exclusion.
Idempotency fingerprints additionally include leave id, preventing a body/key for one
request from replaying another request's result. Recorded timestamps use the shared Clock.

Publish LeaveApproved/LeaveRejected/LeaveRevoked atomically with revision and actor metadata,
without free-form reasons or health notes in audit/outbox snapshots. Read contracts carry the
decision and reasons to the employee. No new cross-module import or dependency is needed.
PR 4b's normal-session notification inbox cannot serve either staff session purpose. Record
DL-Q3 rather than adding an unapproved personal capability or silently delivering an unreadable
staff notification. Outbound WhatsApp/email remain off. Phase 1 screens poll committed state.

## Consequences

Default decide/revoke branch codes cover the four approver roles. Other human roles retain
explicit personal delegation, with separate read authority for manager lists; Device never
receives those cells. Covering DENY still wins for non-owners. Scope filtering precedes cursor
pagination; date filters intersect stored local dates with a company/business/branch/date index.
The branch filter belongs to the manager inbox only: own history stays business-wide, and a
personal session's branch_id selects the session, never narrows the list.
Pre-start revocation (DL-Q2) and approved-overlap refusal (DL-Q1) live in pure domain functions;
they are owner decisions 2026-10-04 (recommended options) recorded in spec 025, the domain code
comments and tests. No balance, attendance correction, transport activation or change to staff
session issuance ships here.
