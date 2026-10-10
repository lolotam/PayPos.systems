# Research — 044 attendance change requests

All business rules come from the owner (ACR-Q1 … ACR-Q22, 2026-10-10). This file records the technical choices.

## R1 — Who is an approver (revised 2026-10-10: ACR-Q4 → option 2)

- **Decision (current)**: approve/reject authority = `decide:attendance-change:company`, owner by default, granted only
  by an owner (OD-Q5 pattern), device-forbidden; non-owner holders may not decide their own filings or their own
  attendance; owners keep ACR-Q2 and ACR-Q22c. Recipients = every holder in scope.
- **Decision (superseded, option 1)**: approve/reject authority = an active membership matching `canonicalOwnerSql`
  (fixed global Owner role id, `role_owner_key = 'global'`, `scope_type = 'COMPANY'`, `scope_id = company`). No
  `decide:` permission.
- **Rationale**: ACR-Q4 says "anyone registered as owner, never delegable". `canonicalOwnerSql`
  (`packages/db/src/system-role-policy.ts:161`) matches every owner membership, not one legal owner; migration 0013
  only guarantees at least one owner. A permission would invite a grant to a non-owner, which the owner refused.
- **Alternatives**: a `decide:attendance-change:company` permission kept non-grantable (more catalog surface, same
  effect, risk of a later grant); partner Abu Salem's delegable option (not adopted, partner note).

## R2 — How 26a ships without a kind

- **Decision**: a kinds port with an empty production registry; `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` (422) for any
  kind; integration tests override the registry provider in the test module with a test-only kind.
- **Rationale**: orchestrator decision 2026-10-10; keeps 26a, 26b, 26c as three PRs and lets 26b/26c run in parallel.
  No PENDING row can ever exist for a kind that has no code.
- **Alternatives**: ship 26a with `VOID_SESSION` (two use cases in one PR); feature flag (no flag system for this).

## R3 — Lock order and races

- **Decision**: authority precheck without locks → `AttendanceState` → identity company + ordered membership locks →
  request row `FOR UPDATE` → (kinds lock their own rows) → Clock sample → authority re-read. Same order for file,
  cancel and decide.
- **Rationale**: ADR-0028 and specs 034/035 serialise every attendance writer on the employee State row; approve vs
  withdraw then resolves to exactly one transition, and the loser reads a non-PENDING row.
- **Alternatives**: request-row lock only (would not serialise the kind's effect with scans and corrections).

## R4 — Putting the decision reason in the requester's notice

- **Decision**: the `attendance_change_decided` template carries a `reason` safe-text parameter. When the reason is
  absent, longer than 255 characters, or fails the safe-text rule (URL, phone, 4–8 digit code, token words), the
  parameter holds `-` and the bell copy still shows the decision; the full reason is on the request (list endpoint).
- **Rationale**: ACR-Q12 — "إشعار في الجرس للي قدّم الطلب (موافقة أو رفض ومعاه السبب)". The in-app contract caps
  safe text at 255 and refuses digit codes, and a notification must never be dropped for its text (spec 036 rule for
  names). The reason lives only in that one recipient's parameters, never in the event facts or the audit snapshot.
- **Alternatives**: no reason in the bell (contradicts ACR-Q12); truncating the reason (could cut a sentence into a
  misleading one).

## R5 — Events and recipients

- **Decision**: two events, `AttendanceChangeRequested` (to owners minus the requester) and `AttendanceChangeDecided`
  (to the requester unless she decided herself); groups of ≤ 100; zero recipients → event emitted without
  `notification_recipients` (acknowledged unsent, spec 036). Withdraw emits nothing.
- **Rationale**: ACR-Q5, ACR-Q12; outbox events need a consumer (notifications); the staff ⇒ notifications arrow is
  already declared.

## R6 — Data-model choices

- Kind-specific values are columns added by 26b/26c, not a JSON blob, so CHECKs and indexes stay typed.
- `session_id` + `session_revision` are generic (void target; created session for add).
- One PENDING void per session is a partial UNIQUE index created now (ACR-Q11) so 26c only adds its CHECK.
- Column-scoped UPDATE for `pospay_app`: `status, decided_by, decided_at, decision_reason, cancelled_by,
  cancelled_at, session_id, revision`.

## R7 — Numbering

- Migration from **0111** (main at 720a8397 holds up to 0110 after #146); ADR **0040**. Both are renumbered at merge
  if needed.
