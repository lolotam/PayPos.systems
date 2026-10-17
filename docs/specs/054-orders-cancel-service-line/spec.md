# Spec 054 — Cancel a saved service line (Phase 1 row 37)

> **Status:** Draft · 2026-10-17 · docs-only PR. Owner answers CX-Q1…CX-Q4 (batch 26) and CX-Q5 (batch 30), all
> Waleed's picks and the recommended option in each, are recorded in [owner-questions.ar.md](owner-questions.ar.md); no
> question is open. CX-Q5 settled that a cancellation is final (no «reinstate» button), so D-4, FR-005, the `UNIQUE` and
> the one-way trigger, and LC-21 stand as written. Abu Salem has not answered batches 26 or 30; if his pick differs,
> his pick binds and the rule changes in a follow-up (`CLAUDE.md` §1 5b). **No code starts before this spec is merged.**
> **Extends:** [spec 050](../050-orders-record-service-session/spec.md) (lines, revisions, the 20-line cap) and
> [spec 35d](../050-orders-record-service-session/spec-35d.md) (the audited edit writer, whose patterns this slice copies).
> **Relates to:** [spec 053](../053-orders-record-tip/spec.md) (tips; CX-Q4 and TP-Q6, see §3.2).
> **Depends on:** row 35 (merged) and the merged pieces of 35d (event `change` block, permission/storage, label function).
> **Consumed later by:** row 50/55 (commission removal or correction), row 59 (rating scheduling, `NO_ACTIVE_LINE`).
> **Design advisors:** not required (docs-only lane; the slice moves no money itself, parses no file and changes no auth model).

## 1. What and why

A manager can cancel one saved service line. A cancelled line **keeps its figures** but leaves the visit total, takes its
commission away from its performers (in the same month before approval, as a correction on the next month after it),
and stays on the day list with a «cancelled» mark and the date. It is the same shape as the price edit of 35d: one
line per request, a written reason, a bell to the branch manager, an audit entry, an immutable history row.

**Worked example (salon «صالون الأميرة», branch السالمية, `Asia/Kuwait`).** Visit of نورة: صبغة 60.000 by سارة and قص
20.000 by هبة, net 80.000. The customer complained about the cut. The branch manager ليلى cancels the قص line with the
reason «شكوى من العميلة». The visit total becomes 60.000, هبة's commission on the line is removed, the line stays on the
day list as «اتلغى 17/10/2026», and the branch managers get a bell. ليلى could not cancel a line that she performed herself.

## 2. Scope and what this spec settles

| Item | Decision | Where |
|---|---|---|
| Who may cancel (CX-Q1) | new delegable permission `cancel:service-lines:branch`; defaults to owner, general manager, business manager, branch manager; nobody cancels a line he or she performs | §3, D-2, FR-002, FR-006 |
| How long (CX-Q2) | the recording window (back to the first day of the previous month); an approved month gets a correction on the next month | FR-007, D-5 |
| What is required (CX-Q3) | written reason + bell to the branch managers + a «cancelled» mark with its date | FR-008, FR-013, FR-015 |
| A tip on the visit (CX-Q4) | the cancellation **stops** while the performer would be left with a tip and no active line, until a manager removes the tip by hand | §3.2, FR-009, D-3 |
| Records, events, split | see §4 and §5 | — |

**Not in 37:** reinstating a cancelled line (CX-Q5: a cancel is final; a line cancelled by mistake is fixed by recording the service
again, which counts against the 20-line cap because cancelled lines keep their slot); changing performers (37b);
cancelling a **redeemed** package line or a package **sale** line (rows 44 and 46 own those; the writer refuses them with
a named code once rows 42/43 add the marker, see D-6); commission arithmetic and statement corrections (rows 50/55);
rating scheduling (59); payments, printing, sync (Phase 2).

### Decisions record (technical; none is an owner question)

| ID | Decision | Alternative rejected |
|---|---|---|
| D-1 | One line per request; a second line is a second request, a second revision, a second bell | batch cancel (partial-failure semantics with no owner request behind them) |
| D-2 | New permission `cancel:service-lines:branch`, not the edit permission and not the record permission | reusing `edit:service-line-prices:branch` (cancelling is a different act and the owner asked for a new permission) |
| D-3 | The tip guard (CX-Q4) is a **refusal**, never an automatic removal; orders reads its own tip tables under the visit lock | auto-removing the tip (the owner chose "stop until the manager removes it by hand"); a statement/commission read (D-5) |
| D-4 (CX-Q5) | Cancellation is terminal: `status` goes `ACTIVE → CANCELLED` once; a database trigger refuses any change on a cancelled line; one history row per line (`UNIQUE (company_id, line_id)`). A line cancelled by mistake is not reinstated: the manager records the service again in the visit (the owner chose this as simpler and safer for money: no «back» state in which a corrected commission is edited again) | allowing `CANCELLED → ACTIVE` with a `LINE_REINSTATED` kind and more than one history row per line (a «reinstate» button, rejected by CX-Q5) |
| D-5 | Orders reads no statement status. A cancellation in an approved or paid month is stored like any other; rows 50/55 derive the correction from the event and the history row | orders reading commission statements (35d D-5) |
| D-6 | A line that carries a package redemption or is a package sale line is refused by this writer (`SESSION_LINE_NOT_CANCELLABLE`) as soon as rows 42/43 add the marker; rows 44/46 extend the same writer with the reversal or refund | cancelling such a line here and leaving the slot or the sale unreversed |
| D-7 | The cancel does not join the ADR-0042 recovery proof (same reason as 35d D-6) | widening `service_session_recoveries.operation` |
| D-8 | The typed reason is stored in the history row only: never in the event, the bell, the audit entry or any log (35d D-7) | copying it into the audit entry |
| D-9 | `expected_revision` is required (compare-and-set); the refusal order is fixed (FR-011) | last-write-wins |

## 3. Owner rules and how they meet the tip rules

### 3.1 Final owner answers (batches 26 and 30 — Waleed's picks; Abu Salem's may replace them later)

| ID | Rule |
|----|------|
| CX-Q1 | A **new permission** for the owner, general manager, business manager and branch manager (grantable to anyone), and **nobody cancels a line he or she performs** (same "even the owner" rule as the price edit, SS-25 / ED-Q4). |
| CX-Q2 | Same period as recording a visit (back to the first day of the previous month). Before the statement is approved the cancellation removes the commission from the same month; after approval it becomes a **correction** on the next month (SPEC §6). |
| CX-Q3 | A **written reason**, a **bell to the branch manager**, and a **«cancelled» mark with its date** — the same package as the price edit (ED-Q5, ED-Q6, ED-Q8). |
| CX-Q4 | A performer with a tip on the visit whose only line is cancelled: the cancellation **stops** until the manager removes the tip by hand. |
| CX-Q5 | A line cancelled by mistake is **not** reinstated: **the cancellation is final, and if it was a mistake the service is recorded again** (simpler and safer for money: no «back» state in which a corrected commission is edited again; mistakes are rare and the branch manager fixes them with a new record). Batch 30. |

### 3.2 CX-Q4 and spec 053 (TP-Q6 is answered in spec 053; it is referenced here, not decided)

Spec 053 TP-Q6 (batch 29, Waleed's pick) says a tip stays recorded after the performer's lines are
cancelled or reassigned. This spec does **not** decide TP-Q6. It implements the answered CX-Q4 for the **cancel path only**:

- Cancelling line L is refused when, after L is cancelled, a performer of L would have **no ACTIVE line left in the visit**
  and the visit's **current tip set** (the entries of its highest revision, spec 053 §5.3) holds an entry for her
  (any method). The refusal is `SESSION_CANCEL_BLOCKED_BY_TIP` and names the employee ids, never the amounts.
- A performer who still has another ACTIVE line is unaffected, and so is a visit whose current tip set is empty
  (including a latest revision that removed every entry). Her tip stays valid, which is consistent with spec 053 BR-02/TP-05.
- The manager clears the block with the existing row 36 replacement («remove the entry, written reason»), which needs
  `record:service-sessions:branch`; the canceller may lack it, in which case the message tells her to ask a person who has it.
  Then the cancel is retried. Nothing here removes a tip.
- **Race:** the tip writer (spec 053, "after the session lock") and this writer take the **same visit lock** as recording,
  append and edit. If the tip is recorded first the cancel is refused; if the cancel commits first, a new tip entry for the
  now line-less performer is refused by spec 053 TP-05 (`TIP_EMPLOYEE_NOT_PERFORMER`). A tip and a cancel never both win.
- **If Abu Salem's TP-Q6 pick differs later** (for example "remove the tip automatically"), the answered CX-Q4 prevails on
  the cancel path until the owners say otherwise, and the TP-Q6 answer applies to the reassignment path of 37b; a conflict
  is reported to the manager and this section is amended by follow-up.

## 4. User scenarios and acceptance criteria *(mandatory)*

Named tests; each is an integration test against real Postgres (T2 stack) unless marked unit. Example people as in §1;
منى is the cashier who recorded; سارة and هبة performed; ليلى is the branch manager (her employee record is linked).

### Story 1 — A manager cancels a line (P1)

- **LC-01** ليلى cancels the قص line (revision 1, expected 1) with a reason. In **one** transaction: the line becomes
  `CANCELLED` with `revision` 2 (compare-and-set), one `service_line_cancellations` row is inserted, one audit entry is
  written, one `ServiceLineChanged` is appended with `change.kind = 'LINE_CANCELLED'`, `change.previous = {revision 1,
  price, discount, net}` and `change.changed_by` = ليلى (not منى), and the idempotent response is stored. The visit
  `total_net` goes from 80.000 to 60.000 with no write of its own: `total_net` is **derived on every read** from the ACTIVE lines only (it is not a stored column, `session-snapshot.ts` and `session-write.ts` sum `status = 'ACTIVE'` lines), so the status change alone moves it, and no grant or step exists for it.
- **LC-02** The cancelled line keeps `price`, `discount`, `net`, `recorded_by`, performers and shares unchanged, stays on the day
  list, and still counts toward the 20 persisted lines of the visit.
- **LC-03** The event is the full line state with `status = CANCELLED`, so row 50 removes the commission in a DRAFT month and
  row 55 posts a negative correction in an approved month (SPEC M4: cancelling a line can also move a tier of another line);
  this slice asserts the event, rows 50/55 assert the money.

### Story 2 — Authority and "not your own line" (P1)

- **LC-04** A caller without `cancel:service-lines:branch` at that branch, or a device, or a feature-disabled company → uniform
  403 / `FEATURE_DISABLED`; nothing written. The four default roles have it; a company role granted it can cancel.
- **LC-05** The canceller's user is linked to a performer of the line (snapshot `line_performers.linked_user_id` **or**
  the current `employees.user_id`) → 403 `SESSION_PERFORMER_SELF_FORBIDDEN`, even for the unlimited owner.
- **LC-06** The #250 cases of 35d (LE-11…LE-13): link removed or moved after recording, performer linked later, several
  performers — all refuse by either source.
- **LC-07** (fail closed, ADR-0045) A line whose performers have `linked_user_snapshotted = false` → 422
  `SESSION_LINE_IDENTITY_UNKNOWN`; nobody, owner included, cancels it.

### Story 3 — The window (P1)

- **LC-08** Session `business_date` before the first day of the previous month (business timezone, at the fresh instant after
  all waits) → 422 `SESSION_TIME_TOO_OLD`.
- **LC-09** A session inside the window whose month is already APPROVED or PAID → accepted; orders writes nothing about the
  statement (D-5); the correction is rows 50/55's.

### Story 4 — Reason, bell and mark (P1/P2)

- **LC-10** The reason is required, trimmed of leading/trailing space, tab, CR, LF, then 1…500 characters
  (counted as characters); otherwise 422 `SESSION_CANCEL_REASON_INVALID`. It lives only in the history row.
- **LC-11** One bell per cancelled line (a second line of the same visit rings again) to the four scoped manager roles of the
  branch, **including the canceller** (the same recipient rule as the price-edit bell, ED-Q9/ED-Q10); no manager in scope → a ledger
  row with count 0, no notice event, no error.
- **LC-12** Every caller who can see the line gets `status` and `cancelled_at` (rendered as a business-timezone date) on the line
  snapshot; the reason and who cancelled are readable only through the guarded read (`read:service-sessions:branch`).
- **LC-13** The payload privacy test: the event, the audit entry and the bell contain no reason, no phone, no customer name.

### Story 5 — A tip on the visit (P1, CX-Q4)

- **LC-14** سارة's only line is cancelled while the visit's current tip set has an entry for her → 422
  `SESSION_CANCEL_BLOCKED_BY_TIP`, `details.employee_ids = [سارة]`, no amounts; zero rows, zero events.
- **LC-15** The manager replaces the tip set without her (row 36, reason), then the same cancel succeeds.
- **LC-16** She also has another ACTIVE line → the cancel succeeds and the tip stays (spec 053 BR-02).
- **LC-17** The latest tip revision is an empty set → not blocked. A CASH-only or CARD-only entry blocks equally.
- **LC-18** Race: a tip recording and a cancel of the same performer's last line, run concurrently → exactly one commits; the
  loser gets `SESSION_CANCEL_BLOCKED_BY_TIP` or spec 053's `TIP_EMPLOYEE_NOT_PERFORMER`.

### Story 6 — Retries, races, authority (P2)

- **LC-19** Same key, same body, same actor → the original 200 replays with no write and no second bell; changed body or actor →
  422 `IDEMPOTENCY_KEY_REUSED`; concurrent duplicates wait then replay; only a claim timeout returns 409.
- **LC-20** Two managers race on revision 1 with different keys: the first commits; the second gets 409
  `SESSION_LINE_REVISION_STALE` with `details.current_revision` only. A retry under a **new** key after an unknown outcome is
  stale too, so a double cancel is impossible.
- **LC-21** A second cancel that carries the **current** revision of an already cancelled line → 422 `SESSION_LINE_ALREADY_CANCELLED`.
- **LC-22** The permission is revoked, the membership expires or a DENY is added while the request waits → 403 at the recheck
  inside the transaction, **also on an idempotent replay**.
- **LC-23** A price edit (35d) of a line cancelled meanwhile is refused with `SESSION_LINE_NOT_EDITABLE`; a cancel of a line
  edited meanwhile gets the stale-revision refusal.

### Edge cases

- Cancelling the last ACTIVE line of a visit is allowed; the visit then has no active line (rating scheduling cancels with
  `NO_ACTIVE_LINE`, row 59) and a total of 0.000.
- Line, session, branch or business not matching the route, or belonging to another company → uniform 403 (no existence oracle).
- Several eligible canceller memberships without `canceller_membership_id` → 422 `SESSION_CANCELLER_MEMBERSHIP_REQUIRED`
  (mirrors `SESSION_EDITOR_MEMBERSHIP_REQUIRED`); one supplied that is foreign, inactive or not covering the branch → uniform 403.
- A bell recipient list of zero never fails or rolls back the cancellation.
- The customer opted out of ratings, the line is late, or the session is `PARTIAL`: none of these changes cancel rights.

## 5. Requirements

- **FR-001** `POST …/service-sessions/:sessionId/lines/:lineId/cancellation` cancels **one** line (D-1). No `DELETE`: money rows are never removed.
- **FR-002** Require `cancel:service-lines:branch` on the route's branch and the `orders` feature, individual admin login (not a
  device), rechecked inside the transaction through the 35d `SessionEditAccessPort` pattern (`lock()` then `read()`), before an
  idempotency replay returns and after every line and performer wait.
- **FR-003** Body (strict Zod): `{ reason?: string, expected_revision: int ≥ 1, canceller_membership_id?: uuid }` (`reason` is optional **in the Zod schema on purpose**, like the edit contract: a missing or blank value must reach the domain rule and return 422 `SESSION_CANCEL_REASON_INVALID`, not a 400 `VALIDATION_FAILED` from the pipe). No client field names
  the canceller, the time or the status.
- **FR-004** The single transaction, in the 35d lock order with the tip read added: idempotency claim → `access.lock()` → visit advisory
  lock → load the line `FOR UPDATE` → `performers.lock(employeeIds)` → `access.read` at the fresh instant → **load, without judging**: the performer
  snapshot and current links, and the visit's current tip set (under the visit lock) → evaluate the rules in **one** place, the FR-011 order
  (pure functions, no I/O) → CAS `UPDATE` of `status` and `revision` → history row → audit → emit → store the response. This list is the order of
  locks and reads; **FR-011 is the single authoritative order of refusals**. Any failure rolls all of it back.
- **FR-005** `revision` increments by one; `status` goes to `CANCELLED`; no money column changes and nothing is written to `service_sessions`: the visit total is derived from the ACTIVE lines on read, never stored. The `UPDATE` column grant on `service_lines`
  gains **only** `status` (it already has `revision`).
- **FR-006** (CX-Q1) The self-cancel rule is the **same pure domain function** as the self-edit rule of 35d (`selfEditForbidden`, snapshot ∪ current
  link, null never matches, fail closed on `linked_user_snapshotted = false`); it is not re-implemented. Its input also includes the performers a row-37b change removed from the line (retained identities, spec 055 FR-017).
- **FR-007** (CX-Q2) `validateAppendWindow(session.business_date, now, session.business_timezone)` at the fresh instant after all lock waits;
  the first of the previous month, inclusive.
- **FR-008** (CX-Q3) The reason is mandatory (LC-10); a database `CHECK` mirrors the rule as in `service_line_edits_reason`.
- **FR-009** (CX-Q4) The tip guard of §3.2 as a pure function `cancelBlockedByTip(lineId, activeLines, performersByLine, currentTipEmployeeIds)`
  returning the blocking employee ids; the use case only calls it.
- **FR-010** Idempotency-Key required; COMPANY scope, operation `cancel-service-line`; fingerprint over `{method, route, query, body,
  params:{businessId, branchId, companyId, actorUserId, sessionId, lineId}}` with the shared helper; the response is stored in full (status 200)
  and **projected on every return, replays included**, by the caller's effective `read:service-sessions:branch` (§6).
- **FR-011** Refusal order: authority → scope (uniform 403) → performer identity (`SESSION_LINE_IDENTITY_UNKNOWN`, then `SESSION_PERFORMER_SELF_FORBIDDEN`) →
  stale revision (409) → already cancelled → not cancellable (D-6) → window → reason → tip guard. `expected_revision` is compared against the loaded line
  before preparation, so two racing identical requests give the loser the stale refusal.
- **FR-012** The history row stores the canceller's user and membership, the active employee's names **in the line's business** when one exists, the role
  snapshot of the membership used, the previous revision and figures, `cancelled_at`, and the reason. The label shown to a human comes from the 35d
  `editorLabel` function (names first, then role per LE-22), used **only by the guarded history read** (FR-016); the bell never carries the canceller's identity.
- **FR-013** (CX-Q3) Event `ServiceLineChanged` with `change.kind = 'LINE_CANCELLED'`, emitted once per cancelled line in the cancel transaction. Row 50/59 consume it as
  the full line state with the increased per-line revision (ADR-0041 §4). The consumer-side bell is §7.
- **FR-014** Audit entry `service_line.cancelled` on entity `service_line`: session, line, cancellation id, revision before/after, canceller user and membership,
  `cancelled_at`, the line's figures. No reason, no customer data, no phone (D-8).
- **FR-015** (CX-Q3) The mark: the saved-line contract carries `status` (already) and an additive optional `cancelled_at`; the day list shows «اتلغى» with that date.
  Clients never derive the mark from `revision`.
- **FR-016** History read: `GET …/lines/:lineId/cancellation` under `read:service-sessions:branch` and the `orders` feature → `{ cancelled_at,
  canceller_label_ar, canceller_label_en, reason, previous: {revision, price, discount, net} }`; route mismatch → uniform 403. A `queries/` file: read-only,
  no `domain/` or `use-cases/` import.

## 6. Slice design

### Business rules

- **BR-01** A cancelled line leaves the visit total, never the record: its figures, performers and shares stay for audit and for the commission correction.
- **BR-02** The canceller is never (now, or when the line was recorded) a performer of that line, whatever the role (the 35d BR-002 in time).
- **BR-03** A revision is consumed only by a real cancellation; the reason and the who-label are mandatory facts of every cancellation.
- **BR-04** Orders owns the line, the history and the snapshots; it never reads `user`, a statement or a rating (35d BR-004).
- **BR-05** A tip never moves silently (CX-Q4): the cancellation waits for a person.

### Response projection (derived from 35d FR-014, not a new owner rule)

With `read:service-sessions:branch`, evaluated across all the principal's active memberships covering the branch in the same locked transaction:
`{ line: <saved line snapshot, status CANCELLED, cancelled_at>, session: { id, total_net } }`. Without it: `{ cancelled: true }` and **no figure at all**; a stale refusal carries
`current_revision` only. The cancellation response never carries the reason or the canceller's identity.

### Schema changes

| Table | Change | Notes |
|---|---|---|
| `service_lines` | grant `UPDATE (status)` to `pospay_app` (in addition to the seven columns of 35d-3); a `BEFORE UPDATE` trigger (SECURITY INVOKER) refuses any change of a `CANCELLED` row and any `status` change other than `ACTIVE → CANCELLED` | grant allowlist and `privileges.spec.ts` updated; a negative test per refusal |
| `service_line_cancellations` (new) | `company_id`, `id` (UUID v7), `business_id`, `line_id` (the session is derived from `service_lines`, as `service_line_edits` does; no stored `session_id`, so it cannot disagree with the line), `revision` (the revision written), `previous_revision`, `previous_price`, `previous_discount`, `previous_net`, `cancelled_by` (user), `cancelled_by_membership_id`, `cancelled_at timestamptz`, `reason text`, `canceller_name_ar/en` (nullable), the role snapshot columns of 35d-3b (`canceller_role`, `canceller_role_is_system`, `canceller_role_name_ar`, `canceller_role_name_en`) | PK `(company_id, id)`; `UNIQUE (company_id, line_id)` (terminal); `CHECK` on the reason (trimmed 1…500) and the all-or-nothing role snapshot, and `canceller_name_en IS NOT NULL OR canceller_role IS NOT NULL`; tenant-qualified FKs to `service_lines` (`service_lines_business_id_key`) and `memberships`; `FORCE` RLS; `SELECT, INSERT` grants only; allowlist, tenant-table inventory, negative isolation test |
| `service_line_cancel_notices` (new, consumer PR) | the insert-only ledger of the bell: `company_id`, `id`, `business_id`, `line_id` (no stored `session_id`, derived from `service_lines`), `revision` (the line revision the cancel event carries), `source_event_id`, `decided_at`, `recipient_count >= 0` | `UNIQUE (company_id, line_id, revision)`: one bell per cancel event, valid whether a cancellation is final or CX-Q5 later allows cancelling again after a reinstatement (a new cancel carries a higher revision); same shape as `service_line_edit_notices` of 35d-2 |

Expand-only: new tables, one added column grant and one trigger, no change to existing data. Indexes on the new tables are created with them.

### Events, module map and the bell (consumer first, writer later — the 35d order)

- **Published:** `ServiceLineChanged` gains the kind `'LINE_CANCELLED'` (ADR-0044 §1 reserved the kind slot for 37). The contract refinement of 35d-1 becomes **kind-dependent**:
  for `PRICE_DISCOUNT_EDIT` the status is `ACTIVE`; for `LINE_CANCELLED` the status is `CANCELLED`; both require `revision = change.previous.revision + 1`. The reason, names and recipients never enter it.
- **Consumed (bell):** a sibling worker `orders` consumer `orders.line-cancel-notice-v1` handles only `LINE_CANCELLED` (the price-edit consumer already ignores other kinds). It resolves the same
  recipients (`identity.branchManagerRecipients`, the four scoped roles, the canceller **not** excluded), claims the ledger row, and appends one `ServiceLineCancelNoticeRequested` per group of at most 100
  recipients to `notifications` (an **event** arrow like `ServiceLineEditNoticeRequested`, never an import). The module-map §4 row, the consumer-owned port rows and the exact §6 reads
  (separate adapter files) and an **ADR-0044 addendum** ship with the first code sub-PR (37-1), ahead of any behaviour, as 35d did. No new import arrow.
- **Bell content (proposed copy; fixed in 37-1):** service name, the cancelled line's net, branch and date; never the reason and never the canceller's identity (that is readable only through the guarded history read, FR-016). Template key `service_line_cancelled`, ar and en,
  money through the strict money parameter of 35d-1.
- **Recovery (ADR-0041 §6):** no `LINE_CANCELLED` exists before its consumer (the order of §7), so the bell has no recovery obligation; rows 50 and 59 keep theirs.

### Permissions

- `cancel:service-lines:branch` (new, 37-2): owner, general manager, business manager, branch manager by default; grantable to any human role; refused to devices. It is independent of the edit and
  record permissions, and the self-cancel rule is independent of grants and of the owner's unlimited limit.
- `read:service-sessions:branch` for the history read; not implied by the cancel permission.

### Error codes (`message_ar` / `message_en`; added to `src/shared/errors.ts`, never inlined)

- `SESSION_LINE_ALREADY_CANCELLED` 422 — «السطر ده ملغي بالفعل.» / "This line is already cancelled."
- `SESSION_CANCEL_REASON_INVALID` 422 — «اكتب سبب الإلغاء (لحد 500 حرف).» / "Enter the reason for the cancellation (up to 500 characters)."
- `SESSION_CANCEL_BLOCKED_BY_TIP` 422 — «فيه بقشيش مسجّل لموظفة ملهاش خدمة تانية في الزيارة. امسحي البقشيش الأول وبعدين الغي.» / "A tip is recorded for a performer who has no other service on this visit. Remove the tip first, then cancel." (`details.employee_ids` only)
- `SESSION_LINE_IDENTITY_UNKNOWN` 422 — «مينفعش نتأكد مين نفّذ الخدمة دي (سطر قديم)، فمينفعش تتلغي.» / "This older line has no performer identity record and cannot be cancelled."
- `SESSION_CANCELLER_MEMBERSHIP_REQUIRED` 422 — details `canceller_membership_ids`.
- `SESSION_LINE_NOT_CANCELLABLE` 422 — reserved for rows 42/43/44/46 (D-6); the message is added when they land.
- Reused: `SESSION_LINE_REVISION_STALE` (409), `SESSION_PERFORMER_SELF_FORBIDDEN`, `SESSION_TIME_TOO_OLD`, `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN`, `FEATURE_DISABLED`; the shared self-refusal message is generalized from «تعديل» to «الإجراء» in 37-4a.

## 7. Delivery: the sub-PR split (owner rule 2026-10-12: at most three subtasks per PR)

Consumer **before** writer, as in 35d, so no cancellation event exists without its bell and the storage never lags the writer. Sizes are hand-written lines including tests and copy.

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **37-1** | Contracts, template, registrations, map; no behaviour | 1. `change.kind = 'LINE_CANCELLED'` (kind-dependent refinement), `ServiceLineCancelNoticeRequested`, OpenAPI. 2. Template `service_line_cancelled` ar/en, admin bell render, registration in `NOTIFICATION_SOURCE_EVENTS` and the worker's known types. 3. Module-map §3/§4/§6 rows + generated YAML + ADR-0044 addendum | this spec merged; 35d-1 (merged) | 220–340 |
| **37-2** | Permission and storage | 1. `cancel:service-lines:branch` and its four default roles. 2. `service_line_cancellations` + `UNIQUE`, `CHECK`s, `FORCE` RLS, `SELECT, INSERT` grants. 3. `UPDATE (status)` grant + one-way trigger on `service_lines`, allowlist, inventory, negative tests | this spec merged; 35d-3, 35d-3b (merged) | 300–420 |
| **37-3** | The bell works for any `LINE_CANCELLED` event | 1. Migration + RLS + grants for `service_line_cancel_notices`. 2. Worker `orders` use case, recipients/place adapters, history-row read, consumer registration. 3. Delivery tests (consume once, tenant and scope isolation, no manager, groups, ignored kinds, notification side) | 37-1, 37-2; 35d-2 pattern (merged or in flight) | 380–520 |
| **37-4a** | Contracts and pure rules of the writer | 1. `cancelServiceLineInput/Response` (full and narrow), optional `cancelled_at` on the saved-line contract, OpenAPI. 2. Pure domain: reason, canceller selection, preparation (status, not-cancellable, no money change), `cancelBlockedByTip`, response projection. 3. Error codes ar/en + unit tests | 37-1, 37-2; 35d-4a (merged) | 220–320 |
| **37-4b** | The use case and its storage access | 1. Orders ports (the 35d access/performer/name ports reused, a `SessionTipsReadPort`, the cancellation repository) and adapters. 2. `CancelServiceLineUseCase` in the §5 FR-004 lock order, status-200 idempotent store, audit, event emit. 3. Integration tests LC-01…LC-07, LC-09, LC-14…LC-23 | 37-4a; 35d-4b (the access port); **36-1** (the tip tables, for the tip guard) | 400–550 |
| **37-4c** | HTTP and end-to-end | 1. `POST` route, guard, error mapping, OpenAPI and clients. 2. LC-08, LC-10…LC-13 over HTTP. 3. End to end: cancel → outbox → dispatcher → consumer → notice event → in-app row | 37-4b, 37-3 | 220–350 |
| **37-5** | Manager day list | 1. Cancel button with reason, the «اتلغى» mark and date. 2. Guarded history read (FR-016) with `EXPLAIN`. 3. ar/en keys and component tests | 37-4c | 220–340 |

**CX-Q5 is answered** (a cancel is final): D-4, FR-005 and LC-21 stand as written, and no sub-PR waits on an owner answer.

The dependency of 37-4b on **36-1** exists only for the tip guard (CX-Q4); 36-1 is the storage PR of spec 053 and does not depend on TP-Q5…TP-Q8 (the reason column is nullable
there), and batch 29 is answered, so the manager decides the order. If 36-1 were later than 37-4b, the guard must not ship without the tables: 37-4b stays blocked.

## 8. Success criteria

- **SC-001** A manager cancels a wrong or complained-about line in under one minute, and the branch managers are notified without an extra step.
- **SC-002** 0 cancellations are accepted from a user who is, or was when the line was recorded, a performer of that line.
- **SC-003** 0 tips change silently: a cancellation that would leave a tipped performer without a line is always refused until a person removes the tip.
- **SC-004** 100% of committed cancellations show a readable «who» and the written reason in the manager's history and a date on the mark; the receptionist-visible payloads carry no reason and no identity.
- **SC-005** Sending the same cancel twice, or from two screens, cancels the line once and rings the bell once.
- **SC-006** The commission projection (row 50) removes the cancelled line's commission before approval and posts a correction after it, from this slice's event alone.

## 9. Assumptions

- Bell wording and the template parameters are proposed copy, like the 35d fallback label; changing them needs no migration.
- The bell recipients (the four scoped roles, canceller included) repeat the price-edit rule because CX-Q3 asks for "the same package"; if Abu Salem picks otherwise, only the recipient list changes.
- The `status`/`cancelled_at` mark is visible to everyone who can see the line; the reason and the canceller only through the guarded read (the ED-Q12 shape). This is derived, not asked.
- The response projection for a caller without the branch-read permission copies the answered ED-Q14 shape; if the owners want a different one it is a small change in 37-4a.
- AS-15 of the manager's brief was not found in the repository (searched `docs/` and `.specify/`); the negative-commission behaviour is tied to SPEC §6 and scenario M4 instead.
- Phase 1 has no production data; lines that predate the performer snapshot are staging test lines and stay non-cancellable (LC-07), as for edits.
