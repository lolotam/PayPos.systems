# Feature Specification: Attendance change requests (request → owner approval)

**Feature Branch**: `feat/p1-26a-attendance-change-requests`

**Created**: 2026-10-10

**Status**: Ready for planning — owner questions ACR-Q1…ACR-Q22 **ANSWERED** (Waleed, 2026-10-10: «موافق على كل المقترح في
دفعة 6», the ⭐ option on all 22; [owner-questions.ar.md](owner-questions.ar.md)).

**Input**: User description: "staff-attendance-change-requests — Phase 1 row 26a. A manager requests a manual
attendance day (26b) or a void of a day (26c); the owner approves or rejects; both steps audited (owner decision
2026-10-09, CA-Q6 update)."

**Phase 1 row**: 26a (`docs/specs/phase-1/IMPLEMENTATION-PLAN.md:73`, depends on 26). Rows 26b
([spec 045](../045-staff-add-manual-session/spec.md)) and 26c ([spec 046](../046-staff-void-attendance-session/spec.md))
depend on this one and can run in parallel after it merges. The three slices share **one** owner-question file:
this folder's `owner-questions.ar.md`.

**What the documents already decide**

- **CA-Q6 (Waleed, 2026-10-08)**: managers may add a missing session and remove a wrong one, always recorded under
  the actor's name; "remove" means **void**, never delete (spec 035, `CLAUDE.md` §5).
- **CA-Q6 update (Waleed, 2026-10-09, after partner Abu Salem's review)**: an add or a void is a **request**. It takes
  effect only when the **owner approves** it. The request and the decision are both recorded
  (`docs/specs/phase-1/owner-review-2026-10-09.ar.md`, CA-Q6; spec 035 owner-questions "تحديث 9 أكتوبر").
- The ordinary time correction (PR 26, `correct:attendance:branch`) is **unchanged** and still applies at once (CA-Q3).
- Attendance never touches commission (SPEC §7 and A7). Nothing here moves money.
- The PRD already lists `MANUAL` as an attendance source (`docs/PRD.md:215`).
- In-app notices to managers/owners go through a staff event carrying IN_APP recipients, consumed by the worker
  `notifications` module (spec 036 / ADR-0037 pattern; spec 004 admin bell).

## Owner questions

All 22 decided by Waleed on 2026-10-10 (the recommended ⭐ option each time, batch 6). Later the same day Waleed
**changed two answers to partner Abu Salem's (محمد العنزي) pick**, confirmed in the orchestrator chat and on the
decisions page (choice index 1):

- **ACR-Q4 → option 2**: «المالك افتراضيًا، وتقدر تدي صلاحية الموافقة لحد تثق فيه (مثلًا المدير العام)». Approval is a
  grantable permission `decide:attendance-change:company`, held by the owner by default (BR-004).
- **ACR-Q21 → option 2**: «أيوه، بطلب «رجوع عن الإلغاء» وموافقتك». An undo-void request kind `RESTORE_SESSION` lands in
  26c (spec 046); 26a only keeps the `kind` CHECK extendable.

Each rule below cites its decision as `ACR-Qn, decided 2026-10-10`. Rules marked **orchestrator default** follow from
the purpose of the feature (no manipulation). Waleed approved them on 2026-10-10 ("نعم"), and they are recorded as ACR-Q23.
They are posted for the partner's review; per the owner's 2026-10-10 rule, a different pick by Abu Salem would win.

| ID | Topic | Decision (Waleed, 2026-10-10) | Slice |
|---|---|---|---|
| ACR-Q1 | Who may request | new `request:attendance-change:branch`, defaults GM, business manager, branch manager | 26a |
| ACR-Q2 | The owner adding/voiding | one step: a request recorded and approved at once, both under the owner's name | 26a |
| ACR-Q3 | Requesting for oneself | refused (as CA-Q2) | 26a |
| ACR-Q4 | Who approves | **changed 2026-10-10 to option 2**: the owner by default, and anyone the owner grants `decide:attendance-change:company` (e.g. the general manager) | 26a |
| ACR-Q5 | How the owner learns | in-app bell to every approver (every holder of the decide permission in scope; owners always) + a pending-requests list | 26a |
| ACR-Q6 | Screens | API only; screens with PR 27 | 26a |
| ACR-Q7 | Decision reason | required on reject (1–500), optional on approve | 26a |
| ACR-Q8 | Withdraw | the requester only, while PENDING | 26a |
| ACR-Q9 | Expiry | none | 26a |
| ACR-Q10 | Edit request / correct a manual day | no edit; a MANUAL session is not correctable by PR 26 | 26a, 26b |
| ACR-Q11 | Concurrent requests | one PENDING void per session; PENDING adds of one employee may not overlap | 26a, 26b, 26c |
| ACR-Q12 | Telling the requester | in-app bell to the requester; nothing to the employee | 26a |
| ACR-Q13 | World changed before approval | approval refused with the reason; request stays PENDING | 26a |
| ACR-Q14…Q18 | Manual day content and rules | see spec 045 | 26b |
| ACR-Q19…Q21 | Void rules (Q21 **changed to option 2**: an undo-void request, kind `RESTORE_SESSION`) | see spec 046 | 26c |
| ACR-Q22 | Remaining defaults (no date limit, leave not read, owner self-approval, audit, device, commission) | as listed | all |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A branch manager asks; the owner approves (Priority: P1)

Reem worked all of Thursday at the Salmiya branch but never scanned. The Salmiya branch manager files a request "add
a day for Reem" with a reason. The owner sees a notice in the bell, opens the pending list, and approves. Only then
does the change happen (26b adds the session, 26c voids one). The request, its requester, the approver, the times and
the reasons are all kept.

**Why this priority**: it is the owner's 2026-10-09 decision; without it 26b and 26c cannot ship.

**Independent Test**: file a request, see one PENDING row, one audit entry and one in-app notice per approver;
approve it; see APPROVED with the approver and time, one more audit entry, and the kind's effect applied in the same
transaction.

**Acceptance Scenarios**:

1. **Given** a holder of the request permission on branch A, **When** they file a request for an employee of branch A
   with a reason, **Then** the request is PENDING, `requested_by`/`requested_at` are set, one audit entry
   `attendance_change.requested` exists, and one `AttendanceChangeRequested` event carries one IN_APP recipient per
   approver (ACR-Q4, ACR-Q5, decided 2026-10-10).
2. **Given** a PENDING request, **When** an approver approves it with the current `revision`, **Then** in one
   transaction the kind's change is applied (spec 045 / 046), the request is APPROVED with `decided_by`/`decided_at`,
   `revision` + 1, one audit entry `attendance_change.approved`, and the requester gets an in-app notice (ACR-Q12,
   decided 2026-10-10).
3. **Given** the same request is sent twice with the same `Idempotency-Key`, **Then** the second answer replays the
   first and nothing more is written.

---

### User Story 2 - The owner rejects; the manager withdraws (Priority: P1)

The owner rejects a request because the cameras show Reem was absent, writing the reason. Another time the manager
notices she typed Wednesday instead of Thursday and withdraws her own request before the owner sees it.

**Independent Test**: reject a PENDING request (with the reason rules of ACR-Q7); withdraw another one as its
requester. Neither changes attendance.

**Acceptance Scenarios**:

1. **Given** a PENDING request, **When** the approver rejects it, **Then** it is REJECTED with the decision reason,
   nothing in attendance changes, one audit entry `attendance_change.rejected`, and the requester is notified
   (ACR-Q7, ACR-Q12, decided 2026-10-10).
2. **Given** a PENDING request, **When** its requester withdraws it, **Then** it is CANCELLED with
   `cancelled_by`/`cancelled_at` and one audit entry `attendance_change.cancelled` (ACR-Q8, decided 2026-10-10).
3. **Given** a request that is no longer PENDING, **When** anyone approves, rejects or withdraws it, **Then**
   `ATTENDANCE_CHANGE_NOT_PENDING` (409) and nothing changes.

---

### User Story 3 - Nobody approves their own manipulation (Priority: P1)

A branch manager tries to file a request for her own missing day; she is refused. A general manager without the
decide permission tries to approve a request; he is refused. A general manager to whom the owner granted the decide
permission approves a branch manager's request, but cannot decide a request he filed himself or one about his own
attendance. The owner adds a day herself and it is recorded as a request
approved at once under her name (ACR-Q2, decided 2026-10-10).

**Acceptance Scenarios**:

1. **Given** a non-owner requester whose `user_id` is the employee's, **When** they file a request for themselves,
   **Then** `ATTENDANCE_CHANGE_SELF_FORBIDDEN` (403) (ACR-Q3, decided 2026-10-10).
2. **Given** a user without `decide:attendance-change:company`, **When** they approve or reject, **Then** `NOT_FOUND`
   (404); the answer never confirms the request exists (ACR-Q4, decided 2026-10-10).
3. **Given** the owner, **When** she files a request, **Then** it is stored APPROVED in the same transaction, with
   `requested_by = decided_by = owner`, two audit entries, and no in-app notice to approvers (ACR-Q2, decided 2026-10-10).
4. **Given** a non-owner holder of the decide permission, **When** he decides a request he filed, or a request about his
   own attendance, **Then** `ATTENDANCE_CHANGE_SELF_FORBIDDEN` (403) and nothing changes (orchestrator default).
5. **Given** an owner, **When** she decides a request about her own attendance filed by a manager, **Then** it is
   allowed (ACR-Q22c).

---

### User Story 4 - The owner sees what is waiting (Priority: P2)

The owner opens "pending requests" and sees every PENDING request of the business, newest first, with the employee,
branch, kind, the requested change, the requester, the time and the reason. A manager sees the requests of the
branches she may request for.

**Acceptance Scenarios**:

1. **Given** PENDING, APPROVED and REJECTED requests on two branches, **When** the owner lists with `status=PENDING`,
   **Then** only PENDING rows of the business return, cursor-paginated, with `can_decide` true.
2. **Given** a branch manager of branch A, **When** she lists, **Then** only branch A rows return, with `can_decide`
   false and `can_cancel` true only on her own PENDING rows.

---

### Edge Cases

- Reason empty, only spaces, or over 500 characters → `VALIDATION_FAILED` (400) (same bounds as spec 034/035).
- A stale `revision` on approve, reject or withdraw → `ATTENDANCE_CHANGE_REVISION_CONFLICT` (409). Approve racing
  withdraw: exactly one commits; the other gets `ATTENDANCE_CHANGE_NOT_PENDING`.
- Approval when the kind's rules no longer hold (the employee scanned in the same hours, the session was corrected or
  voided meanwhile) → the kind's own error (spec 045/046), the request stays PENDING (ACR-Q13, decided 2026-10-10).
- A kind whose applying slice has not merged yet (26a before 26b/26c) → `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` (422).
  No request of that kind can be stored, so no PENDING row can ever wait for code that does not exist.
- Two requests for the same thing (ACR-Q11, decided 2026-10-10) → `ATTENDANCE_CHANGE_DUPLICATE_PENDING` (409).
- Caller without the permission on the employee's/session's branch, or an id of another business/company →
  `NOT_FOUND`; the response never confirms existence.
- The paired device → `FORBIDDEN` (403); personal staff sessions are refused by the shared guard (401) (ACR-Q22e,
  decided 2026-10-10).
- A request on a day of approved leave is accepted and leave is not read (ACR-Q22b, decided 2026-10-10).
- No expiry: a request may wait indefinitely (ACR-Q9, decided 2026-10-10).
- Zero approvers resolvable (cannot happen while the company keeps its last owner, migration 0013) → the event is
  still emitted, without recipients, as spec 036 BR-004 does.
- A non-owner tries to grant or revoke `decide:attendance-change:company` → `PERMISSION_OWNER_ONLY` (403), the OD-Q5
  pattern (orchestrator default).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A holder of the request permission on the target branch MUST be able to file a change request of a
  kind (`ADD_SESSION` from spec 045, `VOID_SESSION` from spec 046) with a reason of 1–500 trimmed characters
  (ACR-Q1, decided 2026-10-10).
- **FR-002**: A request MUST NOT change attendance. Only an approval applies it, in the approval's transaction
  (CA-Q6 update).
- **FR-003**: The kind's rules MUST be checked when the request is filed **and** again, under locks, when it is
  approved (ACR-Q13, decided 2026-10-10).
- **FR-004**: Only a holder of `decide:attendance-change:company` (the owner by default, or whoever the owner granted
  it to) MUST be able to approve or reject (ACR-Q4, decided 2026-10-10 — option 2). A non-owner holder MUST NOT decide a
  request he filed or one about his own attendance (orchestrator default). A reject MUST carry a reason;
  an approve MAY carry one (ACR-Q7, decided 2026-10-10).
- **FR-005**: The requester MUST be able to withdraw their own PENDING request (ACR-Q8, decided 2026-10-10). A request MUST
  NOT be edited (ACR-Q10, decided 2026-10-10).
- **FR-006**: The system MUST refuse a non-owner filing a request for their own attendance (ACR-Q3, decided 2026-10-10, as
  CA-Q2).
- **FR-007**: When the owner files a request, it MUST be recorded and approved in one step under her name
  (ACR-Q2, decided 2026-10-10).
- **FR-008**: Filing, approving, rejecting and withdrawing MUST each write one audit entry with the before and after
  status, the actor and the time, in the same transaction (ACR-Q22d, decided 2026-10-10).
- **FR-009**: Approvers MUST be told in-app when a request waits; the requester MUST be told in-app of the decision;
  the employee MUST NOT be told (ACR-Q5, ACR-Q12, decided 2026-10-10).
- **FR-010**: Approvers MUST be able to list pending (and past) requests of the business; requesters MUST be able to
  list the requests of their branches (ACR-Q5, ACR-Q6, decided 2026-10-10).
- **FR-011**: Every write MUST require `Idempotency-Key`; replay returns the stored answer and writes nothing.
- **FR-012**: Requests MUST never be deleted. There is no expiry (ACR-Q9, decided 2026-10-10).

### Key Entities

- **Attendance change request** (new): one row per request. Kind (`ADD_SESSION` | `VOID_SESSION`), status
  (`PENDING` → `APPROVED` | `REJECTED` | `CANCELLED`), employee, branch, target session (void) or created session
  (add, set on approval), the session revision seen (void), the kind's requested values (added by 26b), the reason,
  requester and time, decider, time and reason, canceller and time, and a `revision` counter.
- **Attendance session** (exists): gains its MANUAL source in 26b and its void marks in 26c. 26a does not change it.
- **Audit entry** (exists): one per step.

## Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001**: The request lifecycle is a pure domain module `domain/attendance-change-request.ts`:
  `planChangeRequest(input, context)` (reason bounds, self rule, owner one-step), `planChangeCancel(request,
  context)` (PENDING only, requester only, revision), `planChangeDecision(request, decision, context)` (PENDING only,
  approver only, revision, reason rules). Each returns the new row values or throws a named
  `AttendanceChangeError`. No arithmetic, no I/O.
- **BR-002 (kinds)**: each kind is a **planner** the use cases call through a port
  `ports/attendance-change-kinds.port.ts`: `check(scope)` validates a request (file time and approval time) and
  `apply(scope)` writes its effect. 26a ships the port, the registry and **no kind**: a kind with no registered
  planner is refused with `ATTENDANCE_CHANGE_KIND_UNAVAILABLE`. 26b registers `ADD_SESSION`, 26c `VOID_SESSION`.
  Two implementations justify the port (`CLAUDE.architecture.md` §12). The 26a integration tests register a
  test-only kind in the test module to exercise approval end-to-end.
  The additive `AttendanceChangeKindRefusal` error contract extends `Error` with a readonly `code: string` and
  `status: 400 | 403 | 404 | 409 | 422`. Kinds throw it from `check` or `apply` to refuse; the transaction rolls
  back and the request stays PENDING (ACR-Q13). HTTP preserves its code and status, with bilingual messages from
  the i18n error catalog when available and a generic fallback otherwise.
- **BR-003 (locks, ADR-0028 order)**: file / approve / reject / withdraw take the employee's `AttendanceState` lock
  first, then identity's company and ordered membership locks (PR 25/26 pattern), then the request row `FOR UPDATE`,
  then (void) the session row. This serialises a request with scans, the missed-out job and corrections of the same
  employee. A non-locking permission precheck runs first so an unauthorised caller gets `NOT_FOUND`, never a lock
  wait (spec 035 BR-002). The injected Clock is sampled again after the locks; that sample is authoritative.
- **BR-004 (approver)**: ACR-Q4, decided 2026-10-10 — **option 2** (changed from option 1 the same day): approval is
  the permission `decide:attendance-change:company`, evaluated with `evaluateAccess` on the request's
  business/branch, read through identity under the membership locks, never from the client. Default: the owner role
  only. The owner can grant it to a person (personal ALLOW) or a custom role. Orchestrator defaults pending owner
  review:
  - **Granting**: only an owner can grant or revoke it (owner-granted permission, the OD-Q5 / spec 039 pattern;
    `PERMISSION_OWNER_ONLY` otherwise). Device-forbidden.
  - **No self-approval**: a non-owner holder cannot decide a request he filed, nor a request about his own attendance
    (`ATTENDANCE_CHANGE_SELF_FORBIDDEN`).
  - **Owner exceptions**: an owner (`canonicalOwnerSql`, every owner membership) may decide a request about her own
    attendance (ACR-Q22c); the owner one-step path (ACR-Q2) is unchanged and applies to owners only.
- **BR-005 (self)**: "the actor is the employee" uses `employees.user_id` (spec 034/035). ACR-Q3, ACR-Q22c, decided 2026-10-10.
- **BR-006 (recipients)**: approvers are resolved at file time inside the transaction: every active member of the
  company for whom `decide:attendance-change:company` evaluates true on the request's business/branch (an owner always
  counts), deduplicated, minus the requester, and minus the employee the request is about unless she is an owner (she
  could not decide it). Groups of ≤100 per event (spec 036 FR-006) (ACR-Q5, orchestrator default).
- **BR-007**: a request stores the branch it concerns: the session's branch (void) or the requested branch (add).
  Authority is checked on that branch.

### Schema changes

One expand migration, numbered at merge time (from **0111**; main at 720a8397 ends at 0110 after #146).

| Table | Columns | RLS | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `attendance_change_requests` (new) | `company_id`, `id` (UUID v7), `business_id`, `branch_id`, `employee_id`, `kind` CHECK IN ('ADD_SESSION','VOID_SESSION'), `status` CHECK IN ('PENDING','APPROVED','REJECTED','CANCELLED'), `session_id uuid NULL`, `session_revision int NULL` (≥0), `reason` (trimmed 1–500), `requested_by` → user, `requested_at`, `decided_by` → user NULL, `decided_at` NULL, `decision_reason` NULL (trimmed 1–500), `cancelled_by` → user NULL, `cancelled_at` NULL, `revision int NOT NULL DEFAULT 0` (≥0). Status-shape CHECKs: PENDING ⇒ decided/cancelled all NULL; APPROVED/REJECTED ⇒ `decided_by`,`decided_at` set, cancelled NULL; CANCELLED ⇒ `cancelled_by`,`cancelled_at` set, decided NULL; REJECTED ⇒ `decision_reason` NOT NULL (ACR-Q7, decided 2026-10-10) | ENABLE + FORCE; tenant policy `company_id = app.company_id`; `pospay_app` SELECT, INSERT, and column-scoped UPDATE (`status`, `decided_*`, `decision_reason`, `cancelled_*`, `session_id`, `revision`); no DELETE | PK `(company_id, id)`; `(company_id, business_id, status, requested_at)` (owner inbox); `(company_id, business_id, branch_id, status, requested_at)` (branch list); `(company_id, employee_id, requested_at)`; `(company_id, session_id)`; `(company_id, requested_by)`; `(company_id, decided_by)`; `(company_id, cancelled_by)`; partial UNIQUE `(company_id, session_id) WHERE status='PENDING' AND kind='VOID_SESSION'` (ACR-Q11, decided 2026-10-10) | `(company_id, business_id, employee_id)` → employees; `(company_id, business_id, branch_id)` → branches; `(company_id, session_id)` → attendance_sessions |
| `permissions`, `role_permissions` | insert `request:attendance-change:branch` (defaults owner, GM, business manager, branch manager; ACR-Q1) and, in a follow-up expand migration, `decide:attendance-change:company` (default owner only; ACR-Q4 option 2) | — | — | — |

- The kind-specific columns and their shape CHECKs are added by 26b (`ADD_SESSION`) and 26c (`VOID_SESSION`), each in
  its own expand migration.
- `packages/db/src/__tests__/privileges.spec.ts` gains the table and its column-scoped UPDATE.

### API contract

All under `@Authenticated()` + the use-case permission check (PR 25/26 pattern); feature flag none. Zod in
`packages/contracts/src/staff/attendance-change-request.ts` (+ `-openapi.ts`).

- **File**: `POST /v1/businesses/:businessId/attendance-change-requests` — body `{ kind, employee_id, reason, ...kind
  fields }` (a discriminated union; 26a ships the envelope, 26b/26c add their members). `Idempotency-Key` required.
  **201** → the request.
- **Withdraw**: `POST /v1/businesses/:businessId/attendance-change-requests/:requestId/cancel` — `{ revision }`.
  `Idempotency-Key` required. **200** → the request.
- **Decide**: `POST /v1/businesses/:businessId/attendance-change-requests/:requestId/decide` — `{ decision:
  'APPROVED'|'REJECTED', revision, reason? }`. `Idempotency-Key` required. **200** → the request (+ the kind's result,
  e.g. the created or voided session).
- **List**: `GET /v1/businesses/:businessId/attendance-change-requests?status&branch_id&employee_id&kind&cursor&limit`
  — `queries/attendance-change-requests.query.ts`. Items: `{ id, kind, status, employee {id, name_ar, name_en},
  branch_id, session_id, requested (kind values), reason, requested_by, requested_at, decided_by, decided_at,
  decision_reason, cancelled_by, cancelled_at, revision, can_decide, can_cancel }`.
- **Request shape (response)**: the same item shape.
- **Errors**: `NOT_FOUND` 404 · `FORBIDDEN` 403 · `ATTENDANCE_CHANGE_SELF_FORBIDDEN` 403 ·
  `ATTENDANCE_CHANGE_NOT_PENDING` 409 · `ATTENDANCE_CHANGE_REVISION_CONFLICT` 409 ·
  `ATTENDANCE_CHANGE_DUPLICATE_PENDING` 409 · `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` 422 · `VALIDATION_FAILED` 400 ·
  `IDEMPOTENCY_KEY_REUSED` · `TRANSACTION_RETRY_REQUIRED` · `NOT_READY` 503 — plus the kind's own codes (045/046).
  Each carries `message_ar` / `message_en`.

### Permissions

- `request:attendance-change:branch` (new) — ACR-Q1, decided 2026-10-10. Defaults: owner, general_manager,
  business_manager, branch_manager (`[...managers, 'branch_manager']`, as `correct:attendance:branch`); the owner
  holds it for the one-step path (ACR-Q2). Device-forbidden. The owner may grant or remove it for anyone. Added to the access catalog, `ROLE_DEFAULTS`,
  `deviceForbidden`, `system-role-policy` and the i18n permission names.
- `decide:attendance-change:company` (new) — ACR-Q4, decided 2026-10-10 (option 2). Default: owner only. Owner-granted
  (only an owner may grant/revoke it; any human role or person may receive it), device-forbidden, i18n name. See BR-004.
- The list is readable by holders of the decide permission (whole business) and by holders of the request permission
  (their branches). **orchestrator clarification 2026-10-11**: it also returns rows where `requested_by = viewer`
  while the viewer is an active member covering the business, using the same membership notion as cancel, even
  after request/decide permission is revoked on that branch. An active member with neither permission receives
  only her own filings, rather than NOT_FOUND; `can_cancel` remains true on her PENDING rows. For every non-owner
  viewer, rows whose employee's `user_id` equals the viewer are excluded (FR-009: the employee is not told).
  Owners still see everything. `can_decide` is false on rows the viewer may not decide (self rules).

### Events

- **Published** (staff, API, in the write transaction; `events/published.ts` with Arabic one-liners):
  - `AttendanceChangeRequested` — emitted when a PENDING request is stored; carries `notification_recipients`
    (IN_APP, template `attendance_change_requested`) for the approvers (BR-006). Not emitted for the owner's one-step
    request (ACR-Q2, decided 2026-10-10).
  - `AttendanceChangeDecided` — emitted on approve and reject; carries one IN_APP recipient, the requester (template
    `attendance_change_decided`) only while she remains an active member covering the business and the decider
    differs from the requester; otherwise the event has no recipients (ACR-Q12, decided 2026-10-10).
  - Withdraw publishes nothing (no consumer).
- **Consumer**: worker `notifications` (`NOTIFICATION_SOURCE_EVENTS`), which stores one in-app row per recipient.
  Event facts hold ids, kind, status, dates and actor ids only — never reasons (spec 025 pattern). The one exception
  is ACR-Q12 ("موافقة أو رفض ومعاه السبب"): the decision reason rides in the **requester's** IN_APP parameters only,
  as safe text, replaced by `-` when it is longer than 255 characters or fails the safe-text rule (plan research R4).
- **Consumed**: none.

### Test plan

- **Domain unit** (`attendance-change-request.spec.ts`): every status × action (file/cancel/approve/reject) ×
  revision match/mismatch; requester-only withdraw; approver-only decide; self rule (owner allowed, managers
  refused); owner one-step; reason bounds 0/1/500/501 and spaces; reject without reason refused.
- **Integration** (`ACR-01`…), with a test-only kind registered in the test module:
  - `ACR-01` file → PENDING, audit, event with one IN_APP recipient per owner, no attendance change
  - `ACR-02` approve → APPROVED, kind applied once, audit, requester notice
  - `ACR-03` reject (reason rules) → REJECTED, no attendance change
  - `ACR-04` withdraw by requester; withdraw by another manager refused
  - `ACR-05` decided/cancelled request → `NOT_PENDING` for every action
  - `ACR-06` approve vs withdraw race and approve vs approve race: exactly one commits
  - `ACR-07` stale revision → 409
  - `ACR-08` self request refused for GM/business/branch manager; owner one-step
  - `ACR-09` user without the decide permission → NOT_FOUND; other branch / business / company → NOT_FOUND with identical envelopes
  - `ACR-15` owner grants the decide permission to a general manager: he decides others' requests and is notified;
    he gets SELF_FORBIDDEN on a request he filed and on one about his own attendance; a non-owner cannot grant it;
    an owner may decide a request about her own attendance
  - `ACR-10` device and personal session refused
  - `ACR-11` idempotent replay and key reuse with another body, for file, cancel and decide
  - `ACR-12` unknown kind (no planner) → `KIND_UNAVAILABLE`, nothing stored
  - `ACR-13` approval re-checks the kind under locks and keeps the request PENDING on refusal
  - `ACR-14` the approval transaction rolls back the kind's effect, audit and event together on any failure
- **RLS negative**: `attendance_change_requests` cross-tenant SELECT = 0, INSERT refused, UPDATE limited to the
  granted columns, no DELETE; a request of company B is NOT_FOUND for company A.
- **Queries**: `attendance-change-requests.query.ts` — result-shape test + `EXPLAIN ANALYZE` asserting the inbox
  index for `status=PENDING` and the branch index for a branch filter.
- **Worker**: the notifications consumer stores one in-app row per recipient for both events, and acknowledges an
  event without recipients unsent (spec 036 pattern).

### Files this slice touches (26a)

- New: `packages/db/schema/staff-attendance-change-requests.ts`, migration `packages/db/migrations/01xx_…_attendance-change-requests.sql` (+ RLS/grants, journal), `apps/api/src/modules/staff/domain/attendance-change-request.ts` (+ `__tests__`), `ports/attendance-change-transactions.port.ts`, `ports/attendance-change-kinds.port.ts`, `persistence/drizzle-attendance-change-transactions.ts`, `persistence/attendance-change-records.ts`, `persistence/attendance-change-writes.ts`, `persistence/attendance-change-context.adapter.ts`, `use-cases/request-attendance-change/`, `use-cases/cancel-attendance-change/`, `use-cases/decide-attendance-change/`, `queries/attendance-change-requests.query.ts`, `http/attendance-change-requests.controller.ts`, `http/attendance-change-http.ts`, `apps/api/src/modules/identity/persistence/attendance-change-access.ts`, `packages/contracts/src/staff/attendance-change-request{,-openapi}.ts`, `packages/notifications/src/templates/attendance-change-{requested,decided}.ts`.
- Shared/edited: `packages/db/schema/index.ts`, `packages/db/src/{access-catalog,role-defaults,system-role-policy}.ts` (+ `role-defaults.spec.ts`, `privileges.spec.ts`), `apps/api/src/modules/staff/events/published.ts`, `staff.module.ts`, `apps/api/src/modules/identity/index.ts`, `apps/api/src/shared/errors.ts`, `packages/contracts/src/{index,openapi,in-app-notifications}.ts`, `openapi/openapi.json`, `apps/{admin,pos}/src/shared/api/schema.d.ts`, `apps/admin/src/notifications/model/render-notification.ts`, `packages/notifications` template registry, `apps/worker/src/modules/notifications/events/handlers/on-notification-request.handler.ts` (`NOTIFICATION_SOURCE_EVENTS`), `packages/i18n/src/{ar,en,permission-name}.ts`, `docs/module-map.md` (event rows + the new synchronous `staff -> identity` adapter line).
- **Not touched**: `staff/domain/clock-attendance.ts`, `staff/persistence/attendance-context.adapter.ts` (lane 16b-2),
  `attendance_sessions`, the correction slice.

### ADR

ADR-0040 (provisional, renumbered at merge) — "attendance change requests: request → owner approval → kind planner
applied in the approval transaction": the kinds port, lock order, the grantable owner-default decide permission and its self rules, one-step owner path, and why
an approval re-checks the kind under locks.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-000**: The `kind` CHECK lists kinds explicitly so 26c can add `RESTORE_SESSION` (ACR-Q21 option 2) with one
  expand migration; nothing in 26a assumes only two kinds.
- **SC-001**: 100 % of manual days and voids are applied only after an approver's decision; no attendance row changes
  on filing, rejecting or withdrawing.
- **SC-002**: For every change, the owner can see who asked, when and why, and who decided, when and why.
- **SC-003**: An approver learns of a waiting request without having to look for it (a notice on the next screen
  load).
- **SC-004**: When a request is approved and withdrawn at the same moment, exactly one outcome is recorded.

## Assumptions

- No production data exists.
- Screens arrive with PR 27 (ACR-Q6, decided 2026-10-10); until then the API and the bell notice are exercised by tests and the
  existing admin bell.
- Times are UTC instants; the future screen converts from the branch timezone.
- The admin bell renders the stored `locale: 'ar'` notice in the viewer's UI locale (spec 036).
