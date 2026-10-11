# Research — 046 void and restore an attendance session

All business rules come from the owner (ACR-Q10, ACR-Q11, ACR-Q13, ACR-Q19 … ACR-Q22, 2026-10-10; ACR-Q21 changed to
option 2 the same day). This file records the technical choices.

## R1 — No new ADR

- **Decision**: no ADR. The request → approval mechanism, the kinds port and the lock order are ADR-0040 (26a). The
  void columns and the restore kind are business rules (spec CA-Q6, ACR-Q19 … ACR-Q21).
- **Alternatives**: ADR-0042 for "void as a mark, not a row" — rejected, CA-Q6 already decided it and `CLAUDE.md` §5
  already forbids deleting financial/attendance facts.

## R2 — No new grant

- **Decision**: no `GRANT` in the migration; `privileges.spec.ts` unchanged.
- **Rationale**: migration 0072 grants `SELECT, INSERT, UPDATE ON attendance_sessions TO pospay_app` at table level, so
  the three new columns are already updatable; the spec's "column UPDATE on the three columns" would be a no-op next
  to the table grant. Narrowing `attendance_sessions` to column grants would touch lane 16b-2's write path
  (`attendance-writes.ts`), which is fenced.
- **Alternatives**: revoke the table UPDATE and grant per column (out of scope; would need its own slice).

## R3 — The owner one-step and `void_request_id`

- **Decision** (revised 2026-10-11 after 26a bf763299): the FK
  `attendance_sessions (company_id, void_request_id) → attendance_change_requests (company_id, id)` is a normal,
  immediate FK, added `NOT VALID` in 0120 and validated in 0121. The request id is allocated by the use case
  (`scope.requestId`), and 26a's `scope.hold()` inserts the request row PENDING before the kind's `apply` runs, on the
  owner one-step path as on the decide path, so the referenced row always exists when the void writes it.
- **Rationale**: the first design (`DEFERRABLE INITIALLY DEFERRED`) existed only because 26a used to run
  `check → apply → save(insert)` on the owner one-step. With `hold()` that ordering is gone, and an immediate FK fails
  at the offending statement instead of at commit.
- **Alternatives**: keep the deferred FK (no longer needed, later failure point); no FK (loses tenant-qualified
  integrity).

## R4 — One PENDING void or restore per session

- **Decision**: replace 26a's partial UNIQUE `attendance_change_requests_one_pending_void` with
  `attendance_change_requests_one_pending_session` on `(company_id, session_id) WHERE status = 'PENDING' AND kind IN
  ('VOID_SESSION','RESTORE_SESSION')`, created `CONCURRENTLY` before the old one is dropped `CONCURRENTLY` (ADR-0033).
  The kinds also check for a PENDING sibling under the locks, so the owner one-step (status APPROVED, not covered by
  the partial index) cannot slip past a waiting request.
- **Rationale**: ACR-Q11 (one PENDING void per session) extended by ACR-Q21 (a void and a restore of the same session
  must not wait at the same time, or the later approval would act on a stale state).

## R5 — Constraint rollout

- **Decision**: up to four migrations: `0116` expand (columns; CHECKs and FK `NOT VALID`; FK deferrable; `kind` CHECK
  dropped and re-added `NOT VALID`; session-shape CHECK `NOT VALID`), `0117` `VALIDATE CONSTRAINT` (separate file so the
  `ADD COLUMN` lock is released first, 0110 precedent), `0118` concurrent indexes (`attendance_sessions (company_id,
  voided_by)`, `(company_id, void_request_id)`, the new partial UNIQUE), `0119` `DROP INDEX CONCURRENTLY` of the old
  partial UNIQUE. Numbers are provisional; the later of 26b/26c renumbers at merge.
- **Rationale**: expand/contract and ADR-0033 (each concurrent statement in the leading prefix of its file).

## R6 — Overlap for restore

- **Decision**: reuse PR 26's interval rule (touching edges are not an overlap, OPEN = open-ended) by exporting it from
  `attendance-correction.ts`; the neighbour read is PR 26's `correctionNeighboursStatement`, now with
  `voided_at IS NULL`.
- **Rationale**: CA-Q8's overlap rule must be the same everywhere (spec BR-003/BR-005).
