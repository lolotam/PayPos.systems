# Feature Specification: Void an attendance session (applied on owner approval)

**Feature Branch**: `feat/p1-26c-void-attendance-session`

**Created**: 2026-10-10

**Status**: Draft — owner questions **ANSWERED** (Waleed, 2026-10-10, the recommended option on all) in the shared file
[044 owner-questions.ar.md](../044-staff-attendance-change-requests/owner-questions.ar.md) (ACR-Q11, ACR-Q13,
ACR-Q19…ACR-Q22). Implemented after 26a merges.

**Input**: User description: "`void-attendance-session` (kept, marked voided with who/when/why, out of reports — spec
035 CA-Q6) — applied only after owner approval through 26a."

**Phase 1 row**: 26c (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:75`, depends on 26 and 26a). Runs in parallel with
26b ([spec 045](../045-staff-add-manual-session/spec.md)) after 26a ([spec 044](../044-staff-attendance-change-requests/spec.md))
merges.

**What the documents already decide**

- CA-Q6 (2026-10-08): "remove" means **void**: the session stays, marked voided with who, when and why, and is left
  out of reports. Financial/attendance facts are never deleted (`CLAUDE.md` §5).
- CA-Q6 update (2026-10-09): a void applies **only after the owner approves** (spec 044).
- Spec 035 "Room for 26b and 26c": `revision` is a plain counter that the void also increments; 26c adds "voided
  session → refused" and "voided sessions are ignored by the overlap check" to `planAttendanceCorrection`; void is
  recorded by its own columns and audit entry, never as a fake correction row.
- Attendance never touches commission (SPEC A7).

## Owner questions

All in [044 owner-questions.ar.md](../044-staff-attendance-change-requests/owner-questions.ar.md). Waleed decided all on
2026-10-10 (the recommended option each time); the decisions are:

- **ACR-Q19** — which sessions. CLOSED, MISSED_OUT or MANUAL only; an OPEN session waits until it is closed
  (as CA-Q5).
- **ACR-Q20** — the session's exceptions and corrections. corrections stay in history unchanged; OPEN exceptions
  of a voided session are hidden with it (board/report filters) and are **not** modified (PR 25's resolution CHECK is
  untouched).
- **ACR-Q21** — undo. **Changed 2026-10-10 to option 2** (partner Abu Salem's pick, confirmed by Waleed):
  «أيوه، بطلب «رجوع عن الإلغاء» وموافقتك». A third request kind `RESTORE_SESSION` (User Story 4). The earlier answer
  (no undo; re-add with `ADD_SESSION`) is kept as history in the owner-questions file.
- **ACR-Q4** — approval is now the grantable permission `decide:attendance-change:company` (owner by default; spec 044
  BR-004). Wherever this spec says "the owner approves", read "a holder of the decide permission approves".
- **ACR-Q11** — one PENDING void per session.
- **ACR-Q13** — at approval every rule is re-checked (state, revision, not already voided); a failure leaves the
  request PENDING.
- **ACR-Q22** — any past date, device refused, no commission effect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A wrong day disappears from the report, but not from history (Priority: P1)

Huda scanned in by mistake from home on her day off; the day was recorded and closed. The branch manager files a
`VOID_SESSION` request with the reason "scanned by mistake on her day off". The owner approves. The session stays in
the database, marked voided with the approver, the time and the request (which holds the reason). It no longer
counts anywhere.

**Why this priority**: the reason the row exists.

**Independent Test**: file a void request for a CLOSED session, approve it (spec 044), read the session back with its
void marks and `revision` + 1, the request APPROVED, and the audit entries.

**Acceptance Scenarios**:

1. **Given** a CLOSED session on branch A and a requester on branch A, **When** she files `{kind: 'VOID_SESSION',
   session_id, session_revision, reason}`, **Then** the request is PENDING and the session is unchanged.
2. **Given** that PENDING request, **When** the owner approves it with matching revisions, **Then** the session gets
   `voided_at`, `voided_by` (the approver), `void_request_id` (the request), `revision` + 1; status, times and all
   scan facts are unchanged; the request is APPROVED; one audit entry `attendance_session.voided` with before/after.
3. **Given** the owner herself files the void, **Then** it is approved in one step (044 ACR-Q2).

---

### User Story 2 - What cannot be voided (Priority: P1)

**Acceptance Scenarios**:

1. **Given** an OPEN session, **When** a void is filed, **Then** `ATTENDANCE_SESSION_OPEN` (409) (ACR-Q19, decided 2026-10-10).
2. **Given** an already voided session, **When** a void is filed or approved, **Then** `ATTENDANCE_SESSION_VOIDED`
   (409).
3. **Given** a void request filed at session revision 3, **When** the session is corrected (revision 4) before
   approval, **Then** approval is refused with `ATTENDANCE_SESSION_REVISION_CONFLICT` (409) and the request stays
   PENDING (ACR-Q13, decided 2026-10-10).
4. **Given** a PENDING void for a session, **When** a second void for it is filed, **Then**
   `ATTENDANCE_CHANGE_DUPLICATE_PENDING` (409) (ACR-Q11, decided 2026-10-10).

---

### User Story 3 - A voided day is inert (Priority: P2)

A voided session cannot be corrected, does not block a correction or a manual day that would overlap it, and is left
out of the board and reports (PR 27).

**Acceptance Scenarios**:

1. **Given** a voided session, **When** `correct-attendance` targets it, **Then** `ATTENDANCE_SESSION_VOIDED` (409).
2. **Given** a voided session 10:00–19:00, **When** another session of the same employee is corrected to 12:00–15:00
   (or a manual day for those hours is requested, 26b), **Then** the voided one is not counted as an overlap.

---

### User Story 4 - Undo a wrong void (Priority: P2)

Huda's Thursday was voided by mistake. The branch manager files a `RESTORE_SESSION` request for that session with a
reason. A holder of the decide permission approves. The session counts again; the void request stays in history.

**Acceptance Scenarios**:

1. **Given** a voided session, **When** a restore is filed with `{kind: 'RESTORE_SESSION', session_id,
   session_revision, reason}`, **Then** the request is PENDING and the session stays voided.
2. **Given** that PENDING restore, **When** it is approved, **Then** `voided_at`, `voided_by` and `void_request_id`
   become NULL, `revision` + 1, one audit entry `attendance_session.restored` (before/after), the original
   `VOID_SESSION` request row is unchanged, and the restore request is APPROVED.
3. **Given** a voided session whose hours now overlap another session of the employee (a manual day was added in the
   meantime), **When** the restore is approved, **Then** `ATTENDANCE_RESTORE_OVERLAP` (422) and the request stays
   PENDING.
4. **Given** a session that is not voided, **When** a restore is filed, **Then** `ATTENDANCE_SESSION_NOT_VOIDED` (409).
5. **Given** a PENDING restore for a session, **When** a second restore (or a void) for it is filed, **Then**
   `ATTENDANCE_CHANGE_DUPLICATE_PENDING` (409).

---

### Edge Cases

- A MISSED_OUT session is voidable; its `status` and `closed_by` stay MISSED_OUT (the void is a separate mark).
- A MANUAL session (26b) is voidable — the recommended way to fix a wrong manual day (ACR-Q10).
- A session with past corrections: the correction rows stay as they are (ACR-Q20, decided 2026-10-10).
- A session with OPEN exceptions: exceptions are not modified (ACR-Q20, decided 2026-10-10); PR 27's queries hide exceptions
  of voided sessions.
- An employee's latest scan result replay (5-minute rule) is harmless: it replays the stored scan answer only.
- The missed-out job only reads OPEN sessions, so it never meets a voided one (only closed sessions are voidable).
- A void of a very old date is accepted (ACR-Q22a, decided 2026-10-10).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `VOID_SESSION` kind MUST carry the session id, the session revision seen, and the request reason.
- **FR-002**: Its rules (state ACR-Q19, not voided, revision) MUST be checked when filed and again at approval under
  the employee's `AttendanceState` lock and the session row lock (044 BR-003).
- **FR-003**: Approval MUST mark the session voided (who, when, which request) and increase its `revision`, in the
  approval's transaction; nothing is deleted; times, status and scan facts are unchanged.
- **FR-004**: A voided session MUST be refused by the correction and ignored by every overlap check (correction and
  manual day).
- **FR-005**: A voided session MUST be excluded from attendance reports and the board (PR 27 queries filter
  `voided_at IS NULL`).
- **FR-006**: A void MUST be undoable only through an approved `RESTORE_SESSION` request (ACR-Q21, option 2,
  decided 2026-10-10). The restore clears `voided_at`, `voided_by` and `void_request_id`, increases `revision`, writes
  one audit entry `attendance_session.restored`, and keeps the original void request row unchanged as history.
- **FR-008**: A restore MUST be re-checked at approval under the locks of 044 BR-003: the session must still be voided
  by the void the request saw (`session_revision` match), and its times must not overlap another non-voided session of
  the employee (CA-Q8 overlap rule, OPEN session included); otherwise `ATTENDANCE_RESTORE_OVERLAP` (422) or
  `ATTENDANCE_SESSION_REVISION_CONFLICT` (409) and the request stays PENDING (ACR-Q13).
- **FR-007**: A void MUST NOT change exceptions or correction history (ACR-Q20, decided 2026-10-10) and MUST NOT create any
  commission input.

### Key Entities

- **Attendance session** (exists): gains `voided_at`, `voided_by`, `void_request_id`.
- **Attendance change request** (spec 044): the `VOID_SESSION` and `RESTORE_SESSION` shapes use its `session_id`
  and `session_revision`.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: One pure function `planAttendanceVoid(session, request, context)` in
  `domain/attendance-void.ts`: state CLOSED | MISSED_OUT (MANUAL sessions are CLOSED), not voided, `session.revision
  === request.session_revision`; returns `{ voided_at: now, voided_by, revision: revision + 1 }` or a named refusal.
- **BR-002**: Registered as the `VOID_SESSION` kind in 044's kinds port: `check` at file and approval; `apply` updates
  the session row under the locks of 044 BR-003 (State → identity → request → session).
- **BR-003**: `planAttendanceCorrection` gains "voided → `ATTENDANCE_SESSION_VOIDED`" before the state check, and the
  neighbour read excludes voided sessions (`voided_at IS NULL`). 26b's overlap read applies the same filter; whichever
  of 26b/26c merges second adds the filter to the other's read.
- **BR-005 (restore)**: `planAttendanceRestore(session, request, context)` in `domain/attendance-void.ts`: the session
  must be voided and at `session_revision`; its times must not overlap any non-voided session of the employee
  (OPEN included); returns the cleared void marks and `revision + 1`. Registered as the `RESTORE_SESSION` kind. The
  overlap read is the voided-aware neighbour read of BR-003.
- **BR-004**: `voided_by` is the approver (the person whose decision made it effective); the requester and the reason
  are on the linked request.

### Schema changes

One expand migration (plan from 0111, numbered at merge after 26a's).

| Table | Columns added / changed | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_sessions` | add `voided_at timestamptz NULL`, `voided_by uuid NULL` → user, `void_request_id uuid NULL`; CHECK all three NULL or all three NOT NULL; CHECK voided ⇒ `status <> 'OPEN'`; `pospay_app` gains column UPDATE on the three columns (ADR-0033 style CHECKs `NOT VALID` then validated) | unchanged | `(company_id, voided_by)`, `(company_id, void_request_id)` built `CONCURRENTLY`; the board index stays (PR 27 adds a partial `WHERE voided_at IS NULL` index if `EXPLAIN` asks) | `(company_id, void_request_id)` → `attendance_change_requests` |
| `attendance_change_requests` | `kind` CHECK extended to IN ('ADD_SESSION','VOID_SESSION','RESTORE_SESSION') (drop + re-add `NOT VALID`, then validate); CHECK `kind NOT IN ('VOID_SESSION','RESTORE_SESSION') OR (session_id IS NOT NULL AND session_revision IS NOT NULL)` | unchanged | 044's partial UNIQUE becomes one PENDING void **or restore** per session: replace it with `(company_id, session_id) WHERE status='PENDING' AND kind IN ('VOID_SESSION','RESTORE_SESSION')` (new index built `CONCURRENTLY`, old one dropped after) | — |

- No new grant: `pospay_app` already holds table-level UPDATE on `attendance_sessions` (0072), so `privileges.spec.ts`
  is unchanged (plan research R2, 2026-10-10).

### API contract

- No new endpoint. The `VOID_SESSION` member joins 044's union: `{ kind: 'VOID_SESSION', session_id,
  session_revision: int ≥ 0, reason }`. The list/response `requested` field carries `{ session_id, working_date,
  clock_in, clock_out }` (read from the session); the decide response carries the voided session.
- The `RESTORE_SESSION` member joins the union: `{ kind: 'RESTORE_SESSION', session_id, session_revision: int ≥ 0,
  reason }`; the decide response carries the restored session.
- **Errors (new)**: `ATTENDANCE_SESSION_VOIDED` 409 (also returned by PR 26's endpoint), `ATTENDANCE_SESSION_NOT_VOIDED`
  409, `ATTENDANCE_RESTORE_OVERLAP` 422. Reused:
  `ATTENDANCE_SESSION_OPEN` 409, `ATTENDANCE_SESSION_REVISION_CONFLICT` 409.

### Permissions

- None new; 044's request and decide permissions apply.

### Events

- **Published**: none (no business consumer; 044's `AttendanceChangeDecided` carries the notice).
- **Consumed**: none.

### Test plan

- **Domain unit** (`attendance-void.spec.ts`): each state (OPEN refused, CLOSED, MISSED_OUT, MANUAL), already voided,
  revision match/mismatch; in `attendance-correction.spec.ts`: voided target refused, voided neighbour ignored.
- **Integration** (`AVS-01`…): `AVS-01` file → PENDING, session unchanged · `AVS-02` approve → void marks, revision
  + 1, audit · `AVS-03` owner one-step · `AVS-04` OPEN refused · `AVS-05` already voided refused at file and approval ·
  `AVS-06` correction between file and approval → approval revision conflict, request PENDING · `AVS-07` duplicate
  PENDING void refused · `AVS-08` correction of a voided session refused; voided neighbour does not block a
  correction · `AVS-09` exceptions and correction rows unchanged after the void · `AVS-10` approve vs a concurrent
  correction: exactly one commits · `AVS-11` restore filed and approved → void marks cleared, revision + 1, audit,
  void request row unchanged · `AVS-12` restore refused on a non-voided session · `AVS-13` restore approval refused on
  overlap, request PENDING · `AVS-14` duplicate PENDING restore refused · `AVS-15` restore vs a concurrent void
  approval: exactly one commits.
- **RLS negative**: a `void_request_id` of company B cannot be referenced by company A; column grants limit
  `pospay_app` UPDATE to the granted columns.
- **Queries**: none new here; PR 27's board/report tests assert voided sessions are excluded.

### Files this slice touches (26c)

- New: `apps/api/src/modules/staff/domain/attendance-void.ts` (+ `__tests__`), `persistence/void-session-writes.ts`,
  `persistence/void-session-kind.ts` and `persistence/restore-session-kind.ts` (kind registrations), migration `01xx_…_attendance-session-void.sql`.
- Edited: `packages/db/schema/staff-attendance.ts` (void columns + CHECKs), `packages/db/schema/staff-attendance-change-requests.ts`
  (VOID shape CHECK), `packages/db/src/__tests__/privileges.spec.ts`, `staff/domain/attendance-correction.ts`
  (voided refusal, voided neighbours), `staff/persistence/attendance-correction-records.ts` (select `voided_at`,
  neighbours filter), `staff.module.ts`, `packages/contracts/src/staff/attendance-change-request{,-openapi}.ts`,
  `packages/contracts/src/staff/attendance-correction.ts` (new error code if listed there), `apps/api/src/shared/errors.ts`,
  `packages/i18n/src/{ar,en}.ts`, `openapi/openapi.json`, `apps/{admin,pos}/src/shared/api/schema.d.ts`.
- **Not touched**: `staff/domain/clock-attendance.ts`, `staff/persistence/attendance-context.adapter.ts`,
  `staff/persistence/attendance-writes.ts`, the worker jobs.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A wrong day stops counting only after the owner approves, and 100 % of voided days remain readable with
  who asked, who approved, when and why.
- **SC-002**: No attendance row is ever deleted, and a wrong void can be undone only with an approval.
- **SC-003**: A voided day never blocks a legitimate correction or manual day, and is never counted in a report.

## Assumptions

- No production data; existing sessions get NULL void columns.
- PR 27 implements the "out of reports" filter; until then nothing reads sessions for reporting.
