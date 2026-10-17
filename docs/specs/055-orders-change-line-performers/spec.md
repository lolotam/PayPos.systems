# Spec 055 — Change the performers and shares of a saved service line (Phase 1 row 37b)

> **Status:** Draft · 2026-10-17 · docs-only PR. Owner answers PF-Q1…PF-Q4 (batch 26, Waleed's picks = the recommended
> option in each) are recorded in [owner-questions.ar.md](owner-questions.ar.md). **One owner question is open: PF-Q5**
> (does a performer who stays on the line get re-checked?), `PENDING` in the same file. It decides the eligibility step only, so everything that depends on it is `TODO(spec)` PF-Q5 and **blocked** (D-11, PC-05, PC-06, FR-008; sub-PRs 37b-4a onward, §7); 37b-1, 37b-2, 37b-3 and 37b-4d do not depend on it. Abu
> Salem has not answered batch 26; if his pick differs, his pick binds and the rule changes in a follow-up
> (`CLAUDE.md` §1 5b). **No code starts before this spec is merged.**
> **Extends:** [spec 050](../050-orders-record-service-session/spec.md) (lines, performers, shares, SS-Q7/SS-Q8, FR-010
> "no post-recording share edit here"), [spec 35d](../050-orders-record-service-session/spec-35d.md) (the audited edit
> writer and the identity snapshot; its `TODO(spec)` 37b in BR-002b) and [ADR-0045](../../adr/0045-performer-identity-snapshot-and-editor-role-label.md).
> **Relates to:** [spec 054](../054-orders-cancel-service-line/spec.md) (same writer family; shares the event kind refinement and one error code),
> [spec 053](../053-orders-record-tip/spec.md) (tips; TP-Q6, see §3.2).
> **Depends on:** row 35 and 35d-2/2b/3/3b/4a (merged); 35d-4b for the access and performer ports this writer reuses.
> **Consumed later by:** row 50/55 (two commission corrections after approval, SPEC §6), row 59 (rating group performers).
> **Design advisors:** required before 37b-2 starts (§7): the storage grants `DELETE` on an insert-only table and moves
> commission shares between employees. Not needed for this docs-only PR.

## 1. What and why

A manager can change **who performed** one saved service line and **how it is split**: swap a performer, add or remove one
(one to four), or change the percentages. The price, discount, net and status of the line do not change; the commission
does, because it follows the performers. It is the same shape as the price edit of 35d and the cancel of 054: one line per
request, a written reason, a bell to the branch managers, an audit entry, an immutable history, a «changed» mark with a date.

**Worked example (salon «صالون الأميرة», branch السالمية, `Asia/Kuwait`).** Visit of نورة: صبغة 60.000, recorded with سارة
alone (100%). Reception actually split the work: سارة did the colour and رنا did the rinse. The branch manager ليلى changes the
line to سارة 70% / رنا 30% with the reason «رنا شاركت في الشطف». The net stays 60.000; the commission shares become 42.000 and
18.000; the line shows «اتغيّر المنفّذين 17/10/2026»; the branch managers get a bell. ليلى could not do this if she were
سارة or رنا, and she could not add herself.

## 2. Scope and what this spec settles

| Item | Decision | Where |
|---|---|---|
| Who may change (PF-Q1) | new delegable permission `change:service-line-performers:branch`; defaults to owner, general manager, business manager, branch manager | §3, D-2, FR-002 |
| Self (PF-Q2) | nobody changes a line he or she performs, and nobody puts himself or herself on a line; the owner is not exempt | FR-006, BR-02, D-3 |
| How long (PF-Q3) | the recording window (back to the first day of the previous month); an approved month gets two corrections | FR-007, D-6 |
| Is a performer who stays on the line re-checked? (PF-Q5, `PENDING`) | `TODO(spec)` PF-Q5: proposed (not adopted) = no, she keeps her original verdict | D-11, PC-05, FR-008 |
| Rules, reason, bell, mark (PF-Q4) | the recording rules, a written reason, a bell to the branch managers, a «changed» mark with its date | FR-008, FR-009, FR-013, FR-015 |
| A removed performer's identity (35d BR-002b, ADR-0045) | **retained**: her recorded identity keeps blocking **every** writer of that line (price edit, cancel, performer change, tips) | D-3, FR-017, §6 *Schema* |
| Tips (TP-Q6, `PENDING` in spec 053) | not touched here under the recommended TP-Q6; the answer is a prerequisite of 37b-4b | §3.2 |

**Not in 37b:** price/discount edits (35d); cancelling a line (037, spec 054); changing the **customer** or the **service** of a line;
adding a new line (35b/35c); a **package** line (a redemption or a sale): rows 42–47 own it, and this writer refuses it with a named
code once their marker exists (D-8); commission arithmetic and statement corrections (rows 50/55); rating scheduling (59);
payments, printing, sync (Phase 2).

### Decisions record (technical; none is an owner question)

| ID | Decision | Alternative rejected |
|---|---|---|
| D-1 | One line per request; a second line is a second request, revision, bell | batch change (partial-failure semantics with no owner request behind them) |
| D-2 | New permission `change:service-line-performers:branch`, independent of edit, record and cancel | reusing `edit:service-line-prices:branch` (a different act; the owner asked for a new permission) |
| D-3 | **Retention.** A performer removed by a change keeps blocking **every** writer of that line (price edit 35d, cancel 054, tips 053 TP-04, and this one): the self rule looks at the current performers, at every performer the line ever had (`BEFORE` rows of its history) and, for this writer, at the performers of the requested set. One shared read serves all four writers (FR-017). A false refusal is accepted, in the safe direction (ADR-0045) | letting a removed performer change the line she was removed from (a way around PF-Q2 later); deleting the snapshot (ADR-0045 forbids a silent delete) |
| D-4 | A change **replaces the whole set** (delete the current rows, insert the new ones, in one transaction); ordinals are `1…n` in request order; the set after the change is what every reader sees. History keeps both sides | updating shares in place (the table is insert-only; ordinals and unique keys would need swaps) |
| D-5 | A performer who stays keeps her **recording-time** identity snapshot (copied from the old row, never re-read); an added performer gets the link at change time with `linked_user_snapshotted = true` (ADR-0045) | re-snapshotting everybody (it would overwrite the recording-time link) |
| D-6 | Orders reads no statement status. A change in an approved or paid month is stored like any other; rows 50/55 post the two corrections from the event | orders reading commission statements (35d D-5) |
| D-7 | The typed reason is stored in the history row only: never in the event, the bell, the audit entry or any log (35d D-7) | copying it into the audit entry |
| D-8 | A package line is refused by this writer (`SESSION_LINE_PERFORMERS_NOT_CHANGEABLE`) once rows 42/43 add the marker; until then no such line exists | changing performers of a redeemed slot here before rows 42–47 decide it |
| D-9 | `expected_revision` is required (compare-and-set); the refusal order is fixed (FR-011) | last-write-wins |
| D-10 | The change does not join the ADR-0042 recovery proof (35d D-6) | widening `service_session_recoveries.operation` |
| D-11 `TODO(spec)` PF-Q5 | **Proposed, not adopted** (PF-Q4 says «same rules» and does not say whether a performer who stays is re-checked; the owner is asked, PF-Q5): eligibility and the attendance/leave warnings are evaluated for the performers the change **adds**, with the recording-time staff check called at the line's original `occurred_at`. A performer who stays keeps her original verdict, flags and identity snapshot (copied from her old row), so a colleague who has since left never forces her removal just to fix another share | re-checking kept performers (a departed colleague could then be fixed only by silently moving her commission to the others, a money consequence nobody chose) |

## 3. Owner rules and how they meet the tip rules

### 3.1 Final owner answers (batch 26 — Waleed's picks; Abu Salem's may replace them later)

| ID | Rule |
|----|------|
| PF-Q1 | A **new permission** for the owner, general manager, business manager and branch manager (grantable to anyone). |
| PF-Q2 | **No**, like ED-Q4, and the owner is not exempt: a manager cannot put himself or herself on a line, nor change a line he or she performs. |
| PF-Q3 | Same period as recording a visit (back to the first day of the previous month); after the statement is approved the change becomes **two corrections** (remove from the old performers, add to the new ones; SPEC §6). |
| PF-Q4 | The recording rules (one to four distinct performers, no zero share, the performer is working and attached to the branch; a missing clock-in or an approved leave only warns) **plus** a written reason, a bell to the branch manager and a «changed» mark with its date. |

### 3.2 Tips (TP-Q6 is `PENDING` in spec 053; it is referenced here, not decided)

Spec 053 recommends (TP-Q6, batch 29) that a tip stays recorded after a performer's lines are cancelled or **reassigned**, and
its TP-05 already skips the performer check for an entry carried unchanged. This spec follows that recommendation: the change
reads no tip table, blocks on no tip and removes no tip. Nothing in PF-Q1…PF-Q4 contradicts it.

- **If TP-Q6 is answered differently** (for example "stop until the manager removes the tip", as CX-Q4 does for a cancel), a
  tip guard like 054's `cancelBlockedByTip` joins 37b-4b before it starts; the answered CX-Q4 still governs the cancel path only.
  `TODO(spec)` TP-Q6 — **blocks 37b-4b** (the use case that writes the change) until the owner answers: if the answer differs, the writer's tip behaviour differs, and a wrong guess would move money. It does not block 37b-1, 37b-2, 37b-3, 37b-4a or 37b-4d.
- **Race:** the tip writer and this writer take the same visit lock. A tip recorded for a performer the change removes stays
  valid (TP-05); a tip *added* after the change for a removed performer is refused by TP-05 (`TIP_EMPLOYEE_NOT_PERFORMER`).

## 4. User scenarios and acceptance criteria *(mandatory)*

Named tests; each is an integration test against real Postgres (T2 stack) unless marked unit. People as in §1; منى is the cashier
who recorded; سارة, رنا and هبة are employees; ليلى is the branch manager (her employee record is linked).

### Story 1 — A manager changes performers and shares (P1)

- **PC-01** ليلى changes the line from سارة 100% to سارة 70% / رنا 30% (revision 1, expected 1). In **one** transaction: the line's
  `revision` becomes 2 (compare-and-set); the two current rows are replaced by two new rows (ordinals 1, 2); one history header and
  three history rows (`BEFORE` سارة 100%; `AFTER` سارة 70%, رنا 30%) are inserted; one audit entry is written; one `ServiceLineChanged`
  is appended with `change.kind = 'PERFORMERS_CHANGE'`, the new `performers`, `change.previous = {revision 1, performers}` and
  `change.changed_by` = ليلى (not منى); the idempotent response is stored.
- **PC-02** Price, discount, net, status, the other lines and the visit `total_net` are unchanged; `edited` (35d) is unchanged
  (it means a price/discount edit, not a revision).
- **PC-03** Swap: سارة → هبة alone; add: a second performer; remove: from two performers to one; shares only: 50/50 → 70/30. Each
  is one change. A change that leaves the same employees with the same shares is refused `SESSION_PERFORMERS_NO_CHANGE`
  (nothing written, no bell, no revision).
- **PC-04** Omitted shares for all performers → equal split with the remainder bps to the first input (SS-Q7); some omitted and some
  explicit, zero or fractional share, sum ≠ 10000, zero or more than four or duplicate performers → `SESSION_PERFORMER_SHARES_INVALID`.
- **PC-05** (`TODO(spec)` PF-Q5 for the last sentence) Every performer the change **adds** must pass the recording-time staff check at the line's original `occurred_at`, never today (active in the business, inside her hire and contract dates, contract end inclusive, attached to this branch
  on the occurred date, `from ≤ date < to`, open-ended `to` allowed); otherwise `SESSION_PERFORMER_NOT_ELIGIBLE` with the employee ids and the whole request rolls back. **Proposed, not adopted (PF-Q5):** a performer who stays is not re-checked (D-11): fixing a co-performer's share works even if she has since left.
- **PC-06** (`TODO(spec)` PF-Q5 for the kept performers) A performer with no clock-in that day, or on approved leave, saves with the per-performer warning and the line flag; the warnings
  never block and never change shares (SS-Q8). They are computed for the added performers; a performer who stays keeps her flags.

### Story 2 — Authority and "not your own line" (P1)

- **PC-07** A caller without `change:service-line-performers:branch` at that branch, or a device, or a feature-disabled company → uniform
  403 / `FEATURE_DISABLED`; nothing written. The four default roles have it; a company role granted it can change.
- **PC-08** The changer's user is linked to a **current** performer of the line (snapshot `linked_user_id` **or** the current `employees.user_id`) →
  403 `SESSION_PERFORMER_SELF_FORBIDDEN`, even for the owner.
- **PC-09** The changer's user is linked to a performer of the **requested** set (putting herself on the line) → 403 `SESSION_PERFORMER_SELF_FORBIDDEN`.
- **PC-10** (retention, D-3) سارة was removed from the line by a first change; later the user linked to سارة holds the permission and tries to change
  the same line → 403 `SESSION_PERFORMER_SELF_FORBIDDEN`. Another manager can.
- **PC-10b** سارة was unlinked when the line was recorded (snapshot `NULL`), was removed by a change, and is **linked later** to the changer's user → 403 `SESSION_PERFORMER_SELF_FORBIDDEN` (her current link is read under the lock, FR-004); a concurrent relink cannot slip between the read and the commit.
- **PC-11** The #250 cases of 35d (LE-11…LE-13): link removed or moved after recording, performer linked later, several performers — all refuse by either source.
- **PC-12** (fail closed, ADR-0045) A line whose current performers have `linked_user_snapshotted = false` → 422 `SESSION_LINE_IDENTITY_UNKNOWN`; nobody, owner included, changes it.
- **PC-13** An added performer is stored with her link at change time and `linked_user_snapshotted = true`; a kept performer keeps her recording-time snapshot (D-5);
  an added performer with no linked user is stored with `linked_user_id NULL` and `true`, so the line stays changeable.

### Story 3 — The window (P1)

- **PC-14** Session `business_date` before the first day of the previous month (business timezone, at the fresh instant after all waits) → 422 `SESSION_TIME_TOO_OLD`.
- **PC-15** A session inside the window whose month is already APPROVED or PAID → accepted; orders writes nothing about the statement (D-6); the two corrections are rows 50/55's.

### Story 4 — Reason, bell and mark (P1/P2)

- **PC-16** The reason is required, trimmed of leading/trailing space, tab, CR, LF, then 1…500 characters; otherwise 422 `SESSION_PERFORMERS_REASON_INVALID`. It lives only in the history row.
- **PC-17** One bell per changed line (a second line of the same visit rings again) to the four scoped manager roles of the branch, **including the changer** (the recipient
  rule of the price-edit and cancel bells); no manager in scope → a ledger row with count 0, no notice event, no error.
- **PC-18** Every caller who can see the line gets `performers_changed_at` (a business-timezone date, the latest change) on the line snapshot; the reason, the names before and after
  and who changed it are readable only through the guarded history read (`read:service-sessions:branch`).
- **PC-19** Payload privacy: the event, the audit entry and the bell contain no reason, no phone, no customer name and no performer name.

### Story 5 — Retries, races, authority (P2)

- **PC-20** Same key, same body, same actor → the original 200 replays with no write and no second bell; changed body or actor → 422 `IDEMPOTENCY_KEY_REUSED`; concurrent duplicates wait then replay; only a claim timeout returns 409.
- **PC-21** Two managers race on revision 1 with different keys: the first commits; the second gets 409 `SESSION_LINE_REVISION_STALE` with `details.current_revision` only. A retry under a **new** key after an unknown outcome is stale too.
- **PC-22** The permission is revoked, the membership expires or a DENY is added while the request waits → 403 at the recheck inside the transaction, **also on an idempotent replay**.
- **PC-23** A change racing a price edit (35d), a cancel (054), an append or a tip on the same visit: the visit lock serialises them; a change of a line cancelled meanwhile is refused `SESSION_LINE_NOT_EDITABLE`; an edit or cancel of a line changed meanwhile gets the stale-revision refusal.
- **PC-24** Two changes in a row (A→B, then B→A) leave a continuous revision chain and two history headers; the visit total never moves.

### Edge cases

- Removing a performer who was **deleted** from the business, or moved to another branch, is allowed: the new set simply does not contain her (D-11).
- A line with a tip for a removed performer: the change is allowed and the tip stays (§3.2).
- Line, session, branch or business not matching the route, or belonging to another company → uniform 403 (no existence oracle).
- Several eligible changer memberships without `changer_membership_id` → 422 `SESSION_CHANGER_MEMBERSHIP_REQUIRED`; one supplied that is foreign, inactive or not covering the branch → uniform 403.
- A bell recipient list of zero never fails or rolls back the change.
- The customer opted out of ratings, the line is late, or the session is `PARTIAL`: none of these changes the right to change. A rating claim that already ran keeps its performers (SPEC §10).

## 5. Requirements

- **FR-001** `PUT …/service-sessions/:sessionId/lines/:lineId/performers` replaces the performer set of **one** line (D-1, D-4). No `DELETE`, no `PATCH` of one performer: a set is the unit.
- **FR-002** Require `change:service-line-performers:branch` on the route's branch and the `orders` feature, individual admin login (not a device), rechecked inside the transaction through the 35d `SessionEditAccessPort` pattern
  (`lock()` then `read()`), before an idempotency replay returns and after every line and performer wait.
- **FR-003** Body (strict Zod): `{ performers: [{ employee_id, share_bps? }] (1…4), reason?: string, expected_revision: int ≥ 1, changer_membership_id?: uuid }`. `reason` is optional **in the Zod schema on purpose** (as in the edit and cancel
  contracts): a missing or blank value must reach the domain rule and return 422 `SESSION_PERFORMERS_REASON_INVALID`, not a 400 from the pipe. No client field names the changer, the time, the status or any figure.
- **FR-004** The single transaction, in the 35d lock order with the set rewrite: idempotency claim → `access.lock()` → visit advisory lock → load the line `FOR UPDATE` → `performers.lock(currentIds ∪ retainedIds ∪ newIds, ascending)` (one global ascending order, taken through repeated calls of at most 80 ids each, because the port refuses a larger batch and a line that was changed many times can retain more than 80 identities) (`retainedIds` = the employees of every `BEFORE` row of the line's history, so their current links are read `FOR SHARE` too) → `access.read` at the fresh instant → **load, without judging**: the
  current performers and their snapshots, every `BEFORE` identity of the line's history with its current link, the eligibility facts and links of the performers the change adds → evaluate the rules in **one** place, the FR-011 order (pure functions, no I/O) → history header → BEFORE rows → CAS `UPDATE` of `revision` → `DELETE` the current rows → `INSERT` the new rows → AFTER rows → audit → emit →
  store the response. **FR-011 is the single authoritative order of refusals.** Any failure rolls all of it back; the deferred consistency trigger (1…4 performers, sum 10000) is checked at commit.
- **FR-005** `revision` increments by one; no money column of `service_lines` changes; nothing is written to `service_sessions`; the visit total is derived and does not move. The `UPDATE` column grant on `service_lines` gains **`has_performer_warning`** (the line flag is derived from the performers' warnings, so it is rewritten with the set, raised or cleared; the deferred consistency trigger of migration 0131 checks it at commit); `revision` is already granted.
- **FR-006** (PF-Q2, D-3) The self rule is the **same pure domain function family** as 35d's (`assertEditorIsNotPerformer`: snapshot ∪ current link, null never matches, fail closed on `linked_user_snapshotted = false`), applied to the union of the current performers, the retained `BEFORE` identities (each with its snapshot **and** its locked current link) and the requested set. It is not re-implemented.
- **FR-007** (PF-Q3) `validateAppendWindow(session.business_date, now, session.business_timezone)` at the fresh instant after all lock waits; the first of the previous month, inclusive.
- **FR-008** (PF-Q4) The recording rules are the recording domain functions unchanged: `validateShares` / `equalShares` (SS-Q7, SS-20) and the staff performer check at the line's `occurred_at` for the performers the change adds (SS-Q8; `TODO(spec)` PF-Q5 whether the performers who stay are checked too, D-11). The reason is mandatory (PC-16); a database `CHECK` mirrors it.
- **FR-009** (PF-Q4) A bell and a mark: see FR-013 and FR-015.
- **FR-010** Idempotency-Key required; COMPANY scope, operation `change-line-performers`; fingerprint over `{method, route, query, body, params:{businessId, branchId, companyId, actorUserId, sessionId, lineId}}` with the shared helper; the response is stored in full (status 200) and
  **projected on every return, replays included**, by the caller's effective `read:service-sessions:branch` (§6).
- **FR-011** Refusal order: authority → scope (uniform 403) → performer identity (`SESSION_LINE_IDENTITY_UNKNOWN`, then `SESSION_PERFORMER_SELF_FORBIDDEN`) → stale revision (409) → cancelled (`SESSION_LINE_NOT_EDITABLE`) → not changeable (D-8) → window → reason → set shape
  (`SESSION_PERFORMER_SHARES_INVALID`) → eligibility → no change. `expected_revision` is compared against the loaded line before preparation, so two racing identical requests give the loser the stale refusal and not the no-change one.
- **FR-012** The history header stores the changer's user and membership, the active employee's names **in the line's business** when one exists, the role snapshot of the membership used (the 35d-3b columns), the previous revision, `changed_at` and the reason; each side row stores the employee, ordinal, share, name snapshots and the identity snapshot
  (`linked_user_id`, `linked_user_snapshotted`). The label shown to a human comes from the 35d `editorLabel` function, used **only by the guarded history read** (FR-016); the bell never carries the changer's identity.
- **FR-013** (PF-Q4) Event `ServiceLineChanged` with `change.kind = 'PERFORMERS_CHANGE'`, emitted once per changed line in the same transaction: the full line state with the new `performers [{employee_id, share_bps}]` and the increased revision; `change.previous = {revision, performers}`.
  The reason, names and recipients never enter it (D-7). Row 50 applies it only if its revision is newer (ADR-0041 §4).
- **FR-014** Audit entry `service_line.performers_changed` on entity `service_line`: session, line, change id, revision before/after, changer user and membership, `changed_at`, employee ids and shares before and after. No reason, no customer data, no phone, no names (D-7).
- **FR-015** (PF-Q4) The mark: the saved-line contract carries an additive optional `performers_changed_at` (the latest change, a business-timezone date), derived from the history table; the day list shows «اتغيّر المنفّذين» with that date. Clients never derive it from `revision`.
- **FR-016** History read: `GET …/lines/:lineId/performer-changes?cursor&limit` under `read:service-sessions:branch` and the `orders` feature → newest first `{ items: [{ revision, changed_at, changer_label_ar, changer_label_en, reason, before: [{employee name, share_bps}], after: [...] }], next_cursor }`;
  route mismatch → uniform 403. A `queries/` file: read-only, no `domain/` or `use-cases/` import.
- **FR-017** (D-3, BR-05) **One retained-identity read for every writer of a line.** Orders exposes, inside the writer's own transaction and under the same `performers.lock`, the line's *identity people*: the current performers, plus the employees of every `BEFORE` row of the line's change history, each with the snapshot `linked_user_id` and the current link. The price edit (35d FR-007), the cancel (054 FR-006), the tip writer (053 TP-04) and this writer feed that one list to the same pure self rule. **The tip writer applies it per entry, never line-wide:** an entry added, changed or removed for employee E is refused when the actor is linked to E (snapshot ∪ current link, retained identities included); an entry carried unchanged is not re-checked, exactly as TP-04 says, so a performer is not barred from other employees' tips. Until the first removal exists the retained part is empty, so wiring it earlier changes nothing; it must be wired **before** the route that can create a removal is live (§7, 37b-4d gates 37b-4c).

## 6. Slice design

### Business rules

- **BR-01** The line's money never moves in a performer change; only who gets which share of it. Net and rule snapshots stay as recorded; the commission arithmetic is rows 50/55 (SPEC §5.2).
- **BR-02** The changer is never (now, when the line was recorded, when she was removed, or in the requested set) a performer of that line, whatever the role (PF-Q2, 35d BR-002 in time).
- **BR-03** A revision is consumed only by a real change; the reason and the who-label are mandatory facts of every change.
- **BR-04** Orders owns the line, its performers, the history and the snapshots; it never reads `user`, a statement or a rating (35d BR-004).
- **BR-05** A removed performer's recorded identity is never deleted: it moves to the history, where the self rule of **every** writer of the line still reads it (D-3, FR-017, ADR-0045).

### Response projection (derived from 35d FR-014, not a new owner rule)

With `read:service-sessions:branch`, evaluated across all the principal's active memberships covering the branch in the same locked transaction: `{ line: <saved line snapshot with the new performers and performers_changed_at>, session: { id, total_net } }`.
Without it: `{ changed: true }` and **no figure at all**; a stale refusal carries `current_revision` only. The response never carries the reason or the changer's identity.

### Schema changes

| Table | Change | Notes |
|---|---|---|
| `line_performers` | grant `DELETE` to `pospay_app` (it keeps `SELECT, INSERT`; **no `UPDATE`**); a `BEFORE DELETE` trigger refuses a `DELETE` of a row that has no field-for-field matching `BEFORE` row under a history header created by the **same transaction** at the line's target revision, and a deferred completion check refuses the commit unless the `AFTER` rows equal the live set | the existing deferred consistency trigger already fires on `DELETE` (migration 0131); allowlist and `privileges.spec.ts` updated; a negative test per refusal |
| `service_lines` | grant `UPDATE (has_performer_warning)` to `pospay_app` (in addition to the columns of 35d-3) | allowlist and `privileges.spec.ts` updated; a test that the flag follows the set up and down |
| `service_line_performer_changes` (new) | `company_id`, `id` (UUID v7), `business_id`, `line_id` (session derived from `service_lines`, no stored `session_id`), `revision`, `previous_revision`, `changed_by`, `changed_by_membership_id`, the changer role and name snapshot columns of `service_line_edits` (35d-3b), `changed_at timestamptz`, `reason`, `write_xid xid8` (stamped by a `BEFORE INSERT` trigger with the creating transaction's id; it is what proves the header belongs to the committing transaction) | `UNIQUE (company_id, line_id, revision)`; `CHECK` on reason 1…500 trimmed; `FORCE` RLS; grants `SELECT, INSERT`; tenant-qualified FKs; index on `(company_id, business_id, line_id, revision DESC)` for the history read |
| `service_line_performer_change_rows` (new) | `company_id`, `id`, `business_id`, `change_id`, `side` (`BEFORE`/`AFTER`), `employee_id`, `performer_ordinal`, `share_bps`, `name_en`, `name_ar`, `linked_user_id`, `linked_user_snapshotted`, `not_clocked_in_warning`, `approved_leave_warning` | `UNIQUE (company_id, change_id, side, employee_id)`; the checks of `line_performers`; `FORCE` RLS; grants `SELECT, INSERT`; tenant-and-business-qualified FKs to the header and to `employees`; the retention read goes `UNIQUE (company_id, line_id, revision)` → `UNIQUE (company_id, change_id, side, employee_id)`; partial index on `(linked_user_id)` for the global-user FK only |
| `service_line_performer_notices` (new, consumer PR) | the insert-only ledger of the bell: `company_id`, `id`, `business_id`, `line_id`, `revision`, `source_event_id`, `decided_at`, `recipient_count >= 0` | `UNIQUE (company_id, line_id, revision)`: one bell per change event |

Expand-only: new tables, one added grant and one trigger, no change to existing data; indexes are created with the tables. The migration numbers are taken at merge.

### Events, module map and the bell (consumer first, writer later — the 35d order)

- **Published:** `ServiceLineChanged` gains the kind `'PERFORMERS_CHANGE'` (ADR-0044 §1 reserved the slot for 37b). The kind-dependent contract refinement of 35d-1 (extended by 054's 37-1 for `LINE_CANCELLED`) gains: status `ACTIVE`,
  `revision = change.previous.revision + 1`, and `change.previous` holds `{revision, performers}` instead of `{revision, price, discount, net}`. The sub-PR that lands second extends the refinement the first one wrote.
- **Consumed (bell):** a sibling worker `orders` consumer `orders.line-performers-notice-v1` handles only `PERFORMERS_CHANGE`, resolves the same recipients (`identity.branchManagerRecipients`, the four scoped roles, the changer **not** excluded), claims the ledger row and appends one
  `ServiceLinePerformersNoticeRequested` per group of at most 100 recipients to `notifications` (an **event** arrow like `ServiceLineEditNoticeRequested`). The module-map §4 row, the consumer-owned port rows and an **ADR-0044 addendum** ship with 37b-1, ahead of any behaviour. No new import arrow.
- **Bell content (proposed copy; fixed in 37b-1):** service name, the line's net, branch and date; never the reason, never a performer's name and never the changer's identity (guarded history read only, FR-016). Template key `service_line_performers_changed`, ar and en.
- **Recovery (ADR-0041 §6):** no `PERFORMERS_CHANGE` exists before its consumer (the order of §7), so the bell has no recovery obligation; rows 50 and 59 keep theirs.

### Permissions

- `change:service-line-performers:branch` (new, 37b-2): owner, general manager, business manager, branch manager by default; grantable to any human role; refused to devices. Independent of the edit, record and cancel permissions; the self rule is independent of grants and of the owner's unlimited limit.
- `read:service-sessions:branch` for the history read; not implied by the change permission.

### Error codes (`message_ar` / `message_en`; added to `src/shared/errors.ts`, never inlined)

- `SESSION_PERFORMERS_NO_CHANGE` 422 — «المنفّذين والنسب زي ما هما، مفيش تغيير يتحفظ.» / "Performers and shares are unchanged; nothing to save."
- `SESSION_PERFORMERS_REASON_INVALID` 422 — «اكتب سبب تغيير المنفّذين (لحد 500 حرف).» / "Enter the reason for the performer change (up to 500 characters)."
- `SESSION_CHANGER_MEMBERSHIP_REQUIRED` 422 — details `changer_membership_ids`.
- `SESSION_LINE_PERFORMERS_NOT_CHANGEABLE` 422 — reserved for rows 42/43 (D-8); the message is added when they land.
- `SESSION_LINE_IDENTITY_UNKNOWN` 422 — «مينفعش نتأكد مين نفّذ الخدمة دي (سطر قديم)، فمينفعش تتغيّر.» / "This older line has no performer identity record and cannot be changed." Defined by whichever of 054's 37-4a and this spec's 37b-4a merges first; the other reuses it.
- Reused: `SESSION_PERFORMER_SHARES_INVALID`, `SESSION_PERFORMER_NOT_ELIGIBLE`, `SESSION_PERFORMER_SELF_FORBIDDEN` (the shared message is generalized from «تعديل» to «الإجراء» by the first of 054 / this spec), `SESSION_LINE_REVISION_STALE` (409), `SESSION_LINE_NOT_EDITABLE`, `SESSION_TIME_TOO_OLD`, `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN`, `FEATURE_DISABLED`.

## 7. Delivery: the sub-PR split (owner rule 2026-10-12: at most three subtasks per PR)

Consumer **before** writer, as in 35d and 054. Sizes are hand-written lines including tests and copy. **Design advisors (Codex astra 6 and Fable 5.1, read-only) review the storage design of 37b-2 before it starts** (skill §3 step 2).

| PR | Result | Subtasks | Blocked on | Size |
|---|---|---|---|---|
| **37b-1** | Contracts, template, registrations, map; no behaviour | 1. `change.kind = 'PERFORMERS_CHANGE'` (refinement), `ServiceLinePerformersNoticeRequested`, OpenAPI. 2. Template `service_line_performers_changed` ar/en, admin bell render, registration in `NOTIFICATION_SOURCE_EVENTS` and the worker's known types. 3. Module-map rows + generated YAML + ADR-0044 addendum | this spec merged | 200–320 |
| **37b-2** | Permission and storage | 1. `change:service-line-performers:branch` and its four default roles. 2. The two history tables, `UNIQUE`s, `CHECK`s, `FORCE` RLS, `SELECT, INSERT` grants. 3. `DELETE` on `line_performers` + the delete-needs-history trigger, `UPDATE (has_performer_warning)` on `service_lines`, allowlist, inventory, negative tests | this spec merged; **the design advisors' review** | 300–450 |
| **37b-3** | The bell works for any `PERFORMERS_CHANGE` event | 1. Migration + RLS + grants for `service_line_performer_notices`. 2. Worker `orders` use case, recipients/place adapters, history-header read, consumer registration. 3. Delivery tests (consume once, tenant and scope isolation, no manager, groups, ignored kinds, notification side) | 37b-1, 37b-2 | 380–520 |
| **37b-4a** | Contracts and pure rules of the writer | 1. `changeLinePerformersInput/Response` (full and narrow), optional `performers_changed_at` on the saved-line contract, OpenAPI. 2. Pure domain: reason, changer selection, the set rewrite plan (kept / removed / added with the snapshot rules), no-change, response projection. 3. Error codes ar/en + unit tests | 37b-1, 37b-2; 35d-4a (merged); **PF-Q5 answered** (its eligibility step; 37b-4b, 37b-4c and 37b-5 follow it) | 240–340 |
| **37b-4b** | The use case and its storage access | 1. Orders ports (the 35d access/performer/name ports reused; the change repository) and adapters. 2. `ChangeLinePerformersUseCase` in the FR-004 lock order, status-200 idempotent store, audit, event emit. 3. Integration tests PC-01…PC-15, PC-20…PC-24 | 37b-4a, 37b-4d; **35d-4b** (the access port); **TP-Q6 answered** (spec 053, §3.2) | 420–560 |
| **37b-4d** | Retained identities for the other writers (FR-017) | 1. The retention-aware self rule (pure domain, extends 35d's `assertEditorIsNotPerformer`) and the shared orders read (`SessionLineIdentityPort`: current performers ∪ `BEFORE` employees, locked, each with snapshot and current link). 2. Wire it into the 35d price-edit loader and 054's cancel loader (whichever is merged; the other adopts it when it lands) with tests that a removed performer is refused by each. 3. Wire it into the tip identity read of spec 053 (TP-04) when row 36 code exists, with the same test | 37b-2; 35d-4b merged (does not wait for 37b-4a or PF-Q5) | 220–340 |
| **37b-4c** | HTTP and end-to-end | 1. `PUT` route, guard, error mapping, OpenAPI and clients. 2. PC-16…PC-19 over HTTP. 3. End to end: change → outbox → dispatcher → consumer → notice event → in-app row | 37b-4b, 37b-3, **37b-4d** | 220–350 |
| **37b-5** | Manager day list | 1. Performer editor with reason, shares and the «اتغيّر المنفّذين» mark and date. 2. Guarded history read (FR-016) with `EXPLAIN`. 3. ar/en keys and component tests | 37b-4c | 240–360 |

**File overlap:** 37b-1 and 054's 37-1 both extend the kind-dependent event refinement, the ADR-0044 addendum and the module map; 37b-4a and 054's 37-4a both touch the saved-line contract and the shared error messages. They run **one at a time** (pipeline rule: disjoint files in parallel). The second to land rebases on the first.

## 8. Success criteria

- **SC-001** A manager fixes a wrong performer or split in under one minute, and the branch managers are notified without an extra step.
- **SC-002** 0 changes are accepted from a user who is, was when recorded, was removed from, or would be put on the line as a performer.
- **SC-003** 100% of committed changes show a readable «who», the written reason and the before/after sets in the manager's history and a date on the mark; the receptionist-visible payloads carry no reason and no identity.
- **SC-004** Sending the same change twice, or from two screens, changes the line once and rings the bell once.
- **SC-005** The commission projection (row 50) moves the line's commission from the old performers to the new ones, and posts two corrections after approval, from this slice's event alone.
- **SC-006** The visit total, price, discount and net of the line are bit-identical before and after every change.

## 9. Assumptions

- The retention rule (D-3) extends PF-Q2's "nobody tampers with their own commission" to time: a removed performer is still "a performer of that line" for the self rule. It is the fail-closed reading, consistent with ADR-0045 and 35d BR-002b. If the owners prefer that a removed performer stops
  blocking, only the shared retained-identity read (37b-4d, FR-017) and its use in the four writers change (the history rows stay).
- D-11 (**proposed, not adopted; asked as PF-Q5, `PENDING`**) reads PF-Q4's «same rules» as the recording rules **for the performers the change adds**: a performer who stays keeps her original verdict, so fixing a co-performer's share never forces a departed colleague off the line (which would move her commission to the others). If the owners
  want every performer re-checked, only the eligibility step of 37b-4a changes.
- Bell wording and the template parameters are proposed copy, like the 35d and 054 bells; changing them needs no migration. The bell recipients (the four scoped roles, changer included) repeat the price-edit rule because PF-Q4 asks for "the same package"; if Abu Salem picks otherwise, only the recipient list changes.
- The `performers_changed_at` mark is visible to everyone who can see the line; the reason, the names and the changer only through the guarded read (the ED-Q12 shape). This is derived, not asked.
- The response projection for a caller without the branch-read permission copies the answered ED-Q14 shape; if the owners want a different one it is a small change in 37b-4a.
- A rating claim that already ran keeps its performers (SPEC §10, D-52 amended); orders changes nothing about it.
- Phase 1 has no production data; lines that predate the performer snapshot are staging test lines and stay unchangeable (PC-12), as for edits.
