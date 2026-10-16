# Feature Specification: 35d — Edit the price/discount of a saved service line

**Feature Branch**: `docs/35d-spec` (docs-only; the code lands in 35d-3b, 35d-2b, 35d-4, 35d-5 and 35d-6)

**Created**: 2026-10-16

**Status**: Draft for review. Every owner question for 35d is answered (ED-Q1…ED-Q13, Waleed, 2026-10-13/16; Abu Salem has
not answered, his pick binds if it differs). **No owner question is PENDING.** The three technical gates (#250, #252,
#255) are decided here and in [ADR-0045](../../adr/0045-performer-identity-snapshot-and-editor-role-label.md).

**Input**: "35d: audited edit of price/discount of a saved service line, extending spec 050."

**Extends**: [spec 050](spec.md) (FR-016, SS-Q10 option 2) · [plan-35d](plan-35d.md) (the event, the bell, the split) ·
[ADR-0044](../../adr/0044-service-line-price-edit-event-and-bell.md) · [ADR-0041](../../adr/0041-orders-service-sessions-reads-and-events.md) ·
[owner answers](owner-questions.ar.md) (batch 17 ED-Q1…ED-Q8, batches 22–24 ED-Q9…ED-Q13).

**Already merged**: 35d-1 (event + bell template, PR 253), 35d-3 (permission `edit:service-line-prices:branch`, table
`service_line_edits`, column `UPDATE` grant on `service_lines`, PR 254). **In flight**: 35d-2 (the bell consumer).

## 1. Scope and what this spec settles

This spec is the contract for the **writer** (35d-4) and the two screens (35d-5, 35d-6). It does not restate the bell:
who receives it, what it says and how it is delivered stay in plan-35d §2–§4 and ADR-0044.

It settles the items plan-35d left as `TODO(spec)`:

| Item | Where plan-35d left it | Decision | Section |
|---|---|---|---|
| How the self-edit rule knows a performer's user (#250) | §8 row 35d-4 | recording-time snapshot on `line_performers` **plus** the current link; lines without a snapshot are refused (fail closed) | D-1, FR-007 |
| `editor_role` must cover every delegable role (#252) and a delegated editor without an employee (#255) | §3, schema comment | store the real role code and a name snapshot; render through one label function | D-2, FR-012 |
| Equal values | §2 | refused with `SESSION_EDIT_NO_CHANGE` | D-3, FR-009 |
| Several lines in one request | §6 | one line per request | D-4, FR-001 |
| The correction on the next month after an approved/paid month | §6 | commissions-side (rows 50/55); 35d writes nothing about statements | D-5, FR-011 |

Not in 35d: cancel (37), performer changes (37b), above-limit approvals (38–41), commission arithmetic (50), any
payment, printing or sync.

### Decisions record (technical; none is an owner question)

| ID | Decision | Alternative rejected |
|---|---|---|
| D-1 | Performer identity for ED-Q4 = **snapshot ∪ current link**; a line whose performers have no recording-time snapshot (recorded before 35d-3b, or by an old instance during a rolling deploy) is **not editable** (ADR-0045 §1) | link history table; current link only; a best-effort backfill (it cannot recover a link that moved before the migration, and a tenant backfill needs the ADR-0038 data-step machinery) |
| D-2 | Editor label = real role code + name snapshot, one pure label function (ADR-0045 §2) | two-value enum; refuse the permission for editors without an employee |
| D-3 | An edit that changes neither stored price nor stored discount is refused | silently accept (burns a revision, rings the bell, writes history for nothing) |
| D-4 | One line per request | batch edit (partial-failure semantics with no owner request behind them) |
| D-5 | No statement-status read and no correction marker in 35d | orders reading commission statements |
| D-6 | The edit does not join the ADR-0042 recovery proof | widening `service_session_recoveries.operation` |
| D-7 | The typed reason is stored in the history row only: not in the event, the bell, the audit entry or any log | copying it into the audit entry |
| D-8 | `expected_revision` is required (compare-and-set) | last-write-wins |

## 2. User scenarios and testing *(mandatory)*

Salon example of spec 050 §4: «صالون الأميرة», branch السالمية, `Asia/Kuwait`. Services: صبغة list 25.000 (FOLLOW_PLAN),
مناكير list 7.125. Receptionist منى (`cashier`, 1000 bps). Branch manager ليلى (`branch_manager`, 2000 bps, employee
record linked). Owner (unlimited, no employee record). Performers سارة, هبة, ريم.

### User Story 1 — A manager corrects a saved line (Priority: P1)

منى saved صبغة at price 25.000, discount 2.500, net 22.500 (1000 bps, revision 1). The customer was promised a bigger
discount. ليلى opens the line, sets the discount to 5.000, types the reason «وعد للعميلة» and saves.

**Why this priority**: it is the whole feature (SS-Q10, FR-016); everything else guards or displays it.

**Independent Test**: one `PATCH` against a recorded line, then read back the line, the history row, the audit entry and
the outbox.

**Acceptance Scenarios**:

- **LE-01** Net becomes 20.000 (effective 2000 bps ≤ ليلى's 2000), `revision` 1 → 2. In **one** transaction: the line is
  updated (compare-and-set on the revision), one `service_line_edits` row is inserted, one audit entry is written, one
  `ServiceLineChanged` carries `change.previous = {revision 1, price "25.000", discount "2.500", net "22.500"}`,
  `change.changed_by` = ليلى (not منى), and the idempotent response is stored.
- **LE-02** The line's `limit_source`/`limit_bps_applied` become ليلى's (`PERSON`, 2000); منى's original values stay in the
  history row (`previous_*`). `recorded_by` still names منى.
- **LE-03** Edit price 25.000 → 27.000, discount 0: above list is allowed (SS-Q4), effective discount 0, saved.
- **LE-04** Owner (unlimited) sets price 15.000, discount 0 (40%): saved with `limit_source = OWNER`, unless the owner is
  linked to a performer of that line (LE-10).

### User Story 2 — The editor's own discount limit applies (Priority: P1)

**Why**: ED-Q2. The limit is the **editor's**, not the recorder's.

**Acceptance Scenarios**:

- **LE-05** ليلى sets the discount to 5.500 (net 19.500): effective `ceil(5500·10000/25000)` = 2200 bps > 2000 → 422
  `SESSION_DISCOUNT_ABOVE_LIMIT`, details carry attempted amounts, `limit_bps_applied` 2000, `minimum_net` 20.000 and
  `max_discount_amount` 5.000 (the same `authorizedDiscountAmounts` maxima recording returns). Nothing is written, no
  event, no history, no audit, no surviving idempotency claim.
- **LE-06** مناكير list 7.125, ليلى sets PERCENT 1000 bps with a limit of 1000: amount `roundKwd(7125·1000, 10000)` =
  713 mills (0.7125 → 0.713, half-up, SS-Q5), net 6.412, effective `ceil(713·10000/7125)` = 1001 bps → refused, exactly
  as SS-12 for recording. Never clamped to 0.712.
- **LE-07** Membership with no configured limit (`NOT_CONFIGURED`) is enforced as 0: only a zero effective discount saves.
- **LE-08** A line recorded by the owner at 40% that ليلى edits to a result still above 2000 bps is refused even if her
  edit *lowers* the discount. ED-Q2 says the editor's limit applies to the result; only a result ≤ her limit saves.

### User Story 3 — Nobody edits their own commission (Priority: P1)

**Why**: ED-Q4 «زي التسجيل بالظبط — عشان محدش يلعب في عمولته». No owner exemption (SS-25).

**Acceptance Scenarios**:

- **LE-09** ليلى is one of the line's performers (her employee record is linked to her user) → 403
  `SESSION_PERFORMER_SELF_FORBIDDEN`; nothing written. Even with an unlimited owner membership and the edit permission.
- **LE-10** The owner whose user is linked to a performer of the line → the same refusal.
- **LE-11** (the #250 case) سارة performed; her employee record was linked to user U1 when the line was recorded
  (`line_performers.linked_user_id = U1`). Afterwards the link is removed or moved to U2. **U1 is still refused** (snapshot),
  and **U2 is refused too** (current link). A different manager U3 can edit.
- **LE-12** A performer who was **unlinked** at recording and linked to U4 afterwards: U4 is refused (current link).
- **LE-13** A line with several performers: any one of them, by either source, refuses.
- **LE-13b** (fail closed) A line recorded before the snapshot existed, or inserted by an old instance during a rolling
  deploy (its performers have `linked_user_snapshotted = false`) → 422 `SESSION_EDIT_IDENTITY_UNKNOWN`; nothing written. The
  identity of its performers cannot be proven, so nobody, owner included, may edit it. (Phase 1 has no production data yet: the
  salon pilot, row 63, starts later; the affected lines are staging test lines.)

### User Story 4 — History for managers, a mark for everyone else (Priority: P2)

**Why**: ED-Q8 and ED-Q12 (against the recommendation).

**Acceptance Scenarios**:

- **LE-14** The edit response and every receptionist-visible payload carry the current line and the boolean
  `edited` (true when at least one price/discount edit exists for the line), and **none** of: previous price/discount/net, the editor's identity (user, membership, name,
  role), the edit time, the reason. A caller holding the edit permission but not `read:service-sessions:branch` gets
  none of those fields (acceptance test of plan-35d §8).
- **LE-15** A caller with `read:service-sessions:branch` (35d-5) reads, newest first, for one line: revision, previous and
  new price/discount/net, `changed_at`, who (name, or role label) and the reason. The reason appears **only** here.
- **LE-16** The day list and every saved-line payload (record, append, edit responses) carry the boolean `edited`, derived
  server-side from the existence of a `service_line_edits` row for the line — **not** from `revision`, which cancel (37) and
  performer changes (37b) also bump (a performer reassignment must not show the badge with an empty history). It is `false` in
  the recording and append responses.

### User Story 5 — Retries, races and authority (Priority: P2)

- **LE-17** Same key, same body, same actor → the original 200 replays with no write and no second bell. Changed body or
  actor → 422 `IDEMPOTENCY_KEY_REUSED`. Concurrent duplicate waits then replays; only a claim timeout returns 409.
- **LE-18** Two editors race on revision 1 with different keys: the first commits (revision 2); the second gets 409
  `SESSION_LINE_REVISION_STALE` and writes nothing. The same applies to a retry with a **new** key after an unknown
  outcome: if the first attempt had landed, the second is stale — a double edit is impossible.
- **LE-19** The edit permission is revoked, the membership expires or a DENY is added while the request waits for a lock → 403
  at the recheck inside the transaction, **also on an idempotent replay** (the recheck runs before a replay is returned).
- **LE-20** The editor's discount limit changes while the request waits → the limit read fresh in the locked
  transaction decides, not a value read before it.

### User Story 6 — Who edited is always readable (Priority: P2)

**Why**: #252, #255, ED-Q13. The bell and the history must name the editor for **every** role that can hold the permission.

- **LE-21** Editor is an employee with an active record in the line's business → the label is the employee's name
  snapshot (`name_ar`, falling back to `name_en`; `name_en` for English).
- **LE-22** No active employee in that business (an owner, an accountant, a custom-role member, or an editor who is an
  employee only in a *different* business) → the label is the **role**: owner → «المالك» / Owner; the three manager roles
  → «المدير» / Manager (ED-Q13 as answered); any other system role → its approved name (`accountant` → «محاسب» /
  Accountant, `cashier` → «كاشير» / Cashier …); a company-defined role → its own stored name, snapshotted at the edit.
- **LE-23** The employee is deactivated, renamed or relinked, or the company role is renamed, after the edit → the
  committed bell and history rows keep the original label.

### Edge cases

- Stale `expected_revision` → 409 `SESSION_LINE_REVISION_STALE` (details: `current_revision` only, no money).
- New price **and** discount equal the stored ones (after percent → amount conversion) → 422 `SESSION_EDIT_NO_CHANGE`.
- Line `CANCELLED` (row 37) → 422 `SESSION_LINE_NOT_EDITABLE`.
- Line, session, branch or business not matching the route, or belonging to another company → uniform 403 (same
  as append: no existence oracle).
- Several eligible editor memberships without `editor_membership_id` → 422 `SESSION_EDITOR_MEMBERSHIP_REQUIRED`
  (never the highest-limit pick); a supplied one that is foreign, inactive or not covering the branch → uniform 403.
- Session `business_date` before the first of the previous month at the fresh edit instant → 422 `SESSION_TIME_TOO_OLD`.
  An edit to an APPROVED/PAID month is accepted (D-5).
- Raising a net so the visit total exceeds `numeric(14,3)` → 422 `SESSION_TOTAL_TOO_LARGE`.
- `discount > price`, negative, or more than three decimals → 422 `SESSION_DISCOUNT_INVALID` / Zod `VALIDATION_FAILED`.
- Reason blank (spaces, tabs, CR, LF only), missing, or over 500 characters (counted as characters, not UTF-16 units) →
  422 `SESSION_EDIT_REASON_INVALID`.
- Editor active in two businesses: the name snapshot comes from the employee of the **line's** business only.
- A bell recipient list of zero (no manager in scope) never fails or rolls back the edit (plan-35d §3 step 6).
- The customer opted out of ratings, the line is late, or the session is `PARTIAL`: none of these changes edit rights.

## 3. Requirements *(mandatory)*

### Functional requirements

- **FR-001** `PATCH` edits **one** line's price and discount per request (D-4). A caller that wants two lines sends two
  requests; each is one revision, one history row, one event, one bell.
- **FR-002** Require `edit:service-line-prices:branch` on the route's branch and the `orders` feature, individual admin
  login (not a device), and recheck all of it inside the transaction (FR-013).
- **FR-003** The request is `price`, `discount` (`AMOUNT` or `PERCENT`, same shapes as recording), `reason`,
  `expected_revision` and an optional `editor_membership_id`. No client field names the editor, the limit, the time or
  the revision to write.
- **FR-004** Money arithmetic reuses the recording domain functions unchanged: `lineNet`, `discountFromPercent` (half-up),
  `effectiveDiscountBps` (ceil) against the line's **stored** `list_price` (never re-read from the catalog), and
  `authorizedDiscountAmounts` for the refusal details. Price ≥ 0, `0 ≤ discount ≤ price`, price above list allowed.
- **FR-005** ED-Q2: the limit is the **editor's** effective limit read inside the locked transaction through
  `DiscountLimitPort.read(editorMembershipId)`. `OWNER` → no numeric check; `NOT_CONFIGURED` → 0. An over-limit result is a
  full refusal (one line: there is no PARTIAL).
- **FR-006** ED-Q3: `validateAppendWindow(session.business_date, now, session.business_timezone)` at the fresh instant after
  all lock waits. Same window as recording: from the first day of the previous month, inclusive.
- **FR-007** ED-Q4 (D-1): refuse with `SESSION_PERFORMER_SELF_FORBIDDEN` when the **editor's user id** equals the
  `linked_user_id` snapshot of any performer of the line, **or** the current `employees.user_id` of any performer
  (read through `PerformerCheckPort` after `lock(employeeIds)`, `FOR SHARE`). The comparison is one pure orders domain
  function; null never matches (an unlinked performer cannot be detected as the editor, as in SS-25). Before comparing, if
  any performer row has `linked_user_snapshotted = false`, refuse with `SESSION_EDIT_IDENTITY_UNKNOWN` (LE-13b).
- **FR-008** ED-Q5: `reason` is required, trimmed of leading/trailing space, tab, CR and LF, then 1…500 characters.
  The database `CHECK service_line_edits_reason` of 35d-3 already enforces the same rule; the domain function mirrors it
  and is the unit-tested source (D-7).
- **FR-009** (D-3) If the resulting stored `price` and `discount` both equal the current ones, refuse with
  `SESSION_EDIT_NO_CHANGE`; no revision is consumed.
- **FR-010** The single transaction (in the lock order of §4 *Test plan → Concurrency*): update the line (price, discount,
  net, effective bps, the editor's limit and source, `revision + 1`, only the seven columns the 35d-3 grant allows), insert the
  `service_line_edits` row, write the audit entry, append one `ServiceLineChanged` (plan-35d §2), store the idempotent
  response. Any failure rolls all of it back.
- **FR-011** (D-5) Orders reads no statement status. An edit in an APPROVED/PAID month is stored like any other. The
  correction on the next month is derived by rows 50/55 from `service_line_edits` and the line revisions; 35d writes
  nothing about statements and the bell carries no correction marker (plan-35d §6).
- **FR-012** (D-2) The history row stores, in the same transaction: the editor's user and membership (35d-3, non-null), the
  active employee's names in the **line's business** when one exists (`editor_name_ar`, `editor_name_en`), and always the role
  snapshot of the membership the edit was made under (`editor_role` code, `editor_role_is_system`, `editor_role_name_ar`,
  `editor_role_name_en`). The label shown to a human is computed by one pure function `editorLabel` in `packages/i18n`
  (names first, then role per LE-22), used by the worker bell (35d-2b) and by the history read (35d-5). A label that fails the
  display-name filter falls back to the generic label (Assumptions).
- **FR-013** Authority is rechecked inside the locked transaction through `SessionEditAccessPort` (`lock()` then `read()`),
  before an idempotency replay returns, after every line and performer wait (plan-35d §8).
- **FR-014** The idempotent response (and a replay) contains the current saved line plus `edited`, and the visit total. It
  never contains the history fields of LE-14.
- **FR-015** (D-6) The edit does not issue or consume a session-recovery proof (ADR-0042). A client in doubt re-sends the
  same key (replay) or re-reads the line; a re-send under a new key is made safe by FR-017.
- **FR-016** Audit entry `service_line.price_discount_edited` on entity `service_line`: session, line, edit id, revision
  before/after, editor user and membership, `changed_at`, previous and new price/discount/net, effective bps, limit
  bps and source. No reason, no customer data, no phone (D-7).
- **FR-017** (D-8) `expected_revision` must equal the line's current revision, enforced by the compare-and-set `UPDATE ... WHERE
  revision = expected`; a miss is `SESSION_LINE_REVISION_STALE` (409).
- **FR-018** History read (35d-5): newest first, by `(company, business, line)` and ordered by revision, cursor on revision,
  `limit` default 50 max 200, under `read:service-sessions:branch` with the `orders` feature; route business/branch/session/line
  mismatch → uniform 403.
- **FR-019** The mark: `edited` is an additive boolean on the saved-line contract (35d-4 adds it to the line snapshot, always
  `false` on record/append, true after an edit), and the day-list query of 35d-5 computes it with an `EXISTS` over
  `service_line_edits` (index `service_line_edits_line_fk_idx`, covered by the 35d-5 `EXPLAIN` test). Clients never derive it from `revision`.
  Stored idempotent responses of record/append written before 35d-4 (or by an old instance during a rolling deploy) have no
  `edited` key and are replayed byte for byte: the response contract therefore declares `edited` optional with a default of `false`
  on the record and append responses (a replay never recomputes it), while the edit response always carries it.
  The reception screen (35d-6) uses the edit endpoint and shows only the mark (ED-Q12).

### Key entities

- **Line edit** (`service_line_edits`, 35d-3): one immutable row per accepted edit, keyed `(company_id, id)` and unique on
  `(company_id, line_id, revision)`. Extended by 35d-3b with the role snapshot.
- **Performer snapshot** (`line_performers.linked_user_id` + `linked_user_snapshotted`, new in 35d-3b): the user linked to the
  performer's employee record at the moment the line was recorded (null when unlinked), and whether a snapshot was taken at all.
- **Editor label**: a computed value (name or role), never stored as one string.

## 4. Slice design *(mandatory — `CLAUDE.md` §1)*

### Business rules

- **BR-001** The editor's limit applies to the *result*. Example: list 25.000, edit to price 25.000 / discount 5.000 → net
  20.000 → 2000 bps; allowed at a limit of 2000, refused at 1999 (`ceil` never rounds an excess down).
- **BR-002** The editor must not be (now, or when the line was recorded) a performer of that line, whatever the role
  (SS-25 extended in time). A false refusal is accepted: a user who *was* a performer and was later moved off
  the employee record cannot edit that old line; another manager can.
- **BR-003** A revision is consumed only by a real change. Reason and who-label are mandatory facts of every edit.
- **BR-004** Orders owns the line's money, the history and the snapshots; it never reads `user`, a statement or a rating.

### Schema changes (storage sub-PR **35d-3b**, ~250–350 hand-written lines, before 35d-4)

| Table | Columns added / changed | RLS policy | Indexes | Tenant-qualified FKs |
|---|---|---|---|---|
| `line_performers` | add `linked_user_id uuid NULL` (user linked to the employee at recording) and `linked_user_snapshotted boolean NOT NULL DEFAULT false` (writers set `true`; existing rows and inserts by an old instance get `false`); `CHECK (linked_user_id IS NULL OR linked_user_snapshotted)`. **No backfill and no data step** | unchanged; grants stay `SELECT, INSERT` — the column is immutable after insert, so **no `UPDATE` grant** | `line_performers_linked_user_idx (linked_user_id) WHERE linked_user_id IS NOT NULL` (the FK index) | `FOREIGN KEY (linked_user_id) REFERENCES "user"(id)` — the global `user` table, as `service_line_edits.changed_by` does; no tenant column involved |
| `service_line_edits` | widen `editor_role` from `owner|manager` to a role code (`CHECK editor_role ~ '^[a-z][a-z_]{0,63}$'`, the `roles_code_format` rule); add `editor_role_is_system boolean`, `editor_role_name_ar text`, `editor_role_name_en text`; new CHECKs: `editor_role`, `editor_role_is_system` and `editor_role_name_en` are all-or-nothing (`editor_role_name_ar` stays optional, as `roles.name_ar` is), name lengths ≤ 255, and **`editor_name_en IS NOT NULL OR editor_role IS NOT NULL`** (a row always has a readable who) | unchanged | none | none |

The migration is numbered at merge (after 35d-2's). It follows expand/contract: only additive columns and a looser CHECK.
The recording and append writers (and 37b's performer change) write `linked_user_id` and `linked_user_snapshotted = true` from the
`SessionEmployee.user_id` that `PerformerCheckPort.read` already returns — no new port, no new arrow. The schema file's
`TODO(spec)` comment on `editorRole` (issue #255) is replaced by 35d-3b.

There is deliberately no backfill. A backfilled value would be the link at migration time, not at recording time, so it
cannot close the bypass for a link that moved earlier; and a tenant-row write by the migration owner is outside the
`CLAUDE.md` §5 rule (a data step runs as `pospay_app`, which would need a permanent `UPDATE` grant that defeats immutability).
`ADD COLUMN ... NOT NULL DEFAULT false` is a metadata-only change. The default also covers the rolling deploy: an old instance
that inserts a performer without the new columns produces `linked_user_snapshotted = false`, which the edit refuses (LE-13b),
so no deployment window can create an editable line without a snapshot.

### API contract

- **Edit** — `PATCH /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines/:lineId` · guard
  `@Require('edit:service-line-prices:branch', { branch: 'branchId' })` · `@RequiresFeature('orders')` · `SessionAdminGuard`.
  Zod in `packages/contracts/src/orders/service-session.ts` (strict):
  `{ price: Money, discount: {kind:'AMOUNT', amount} | {kind:'PERCENT', bps}, reason: string, expected_revision: int ≥ 1,
  editor_membership_id?: uuid }` → `200 { line: <saved line snapshot> & { edited: boolean }, session: { id, total } }`.
- **Idempotency-Key**: required; COMPANY scope, operation `edit-service-line-price`; fingerprint over
  `{method, route, query, body, params:{businessId, branchId, companyId, actorUserId, sessionId, lineId}}` using the shared helper.
- **History** (35d-5) — `GET .../service-sessions/:sessionId/lines/:lineId/edits?cursor&limit` · `@Require('read:service-sessions:branch', { branch: 'branchId' })` · `@RequiresFeature('orders')` · `SessionAdminGuard`
  → `{ items: [{ revision, previous: {price, discount, net}, new: {price, discount, net}, changed_at, editor_label_ar,
  editor_label_en, reason }], next_cursor }`. A `queries/` file: read-only, no `domain/` or `use-cases/` import.
- **Errors** (`message_ar` / `message_en`):
  - `SESSION_LINE_REVISION_STALE` 409 — «اتغيّر السطر من حد تاني. افتحه تاني وراجع الأرقام الجديدة.» / "The line was changed by someone else. Reopen it and review the new figures."
  - `SESSION_EDIT_NO_CHANGE` 422 — «السعر والخصم زي ما هما، مفيش تعديل يتحفظ.» / "Price and discount are unchanged; nothing to save."
  - `SESSION_LINE_NOT_EDITABLE` 422 — «السطر ده ملغي ومينفعش يتعدّل.» / "This line is cancelled and cannot be edited."
  - `SESSION_EDIT_REASON_INVALID` 422 — «اكتب سبب التعديل (لحد 500 حرف).» / "Enter the reason for the edit (up to 500 characters)."
  - `SESSION_EDITOR_MEMBERSHIP_REQUIRED` 422 — details `editor_membership_ids`, mirrors `SESSION_RECORDER_MEMBERSHIP_REQUIRED`.
  - `SESSION_EDIT_IDENTITY_UNKNOWN` 422 — «مينفعش نتأكد مين نفّذ الخدمة دي (سطر قديم)، فمينفعش تتعدّل.» / "This older line has no performer identity record and cannot be edited."
  - Reused: `SESSION_DISCOUNT_ABOVE_LIMIT`, `SESSION_DISCOUNT_INVALID`, `SESSION_TIME_TOO_OLD`, `SESSION_PERFORMER_SELF_FORBIDDEN`,
    `SESSION_TOTAL_TOO_LARGE`, `IDEMPOTENCY_KEY_REUSED`, `FORBIDDEN`, `FEATURE_DISABLED`.

### Permissions

- `edit:service-line-prices:branch` (35d-3): owner, general manager, business manager, branch manager by default; grantable
  to any human role; refused to devices. The self-edit rule is independent of grants and of the owner's unlimited limit.
- `read:service-sessions:branch` (SS-Q12) for the history; **not** implied by the edit permission (ED-Q12).

### Events

- **Published**: `ServiceLineChanged` with the `change` block — exactly as plan-35d §2 (contract shipped in 35d-1). Emitted once
  per accepted edit, in the edit transaction. No reason, no names, no recipients in it.
- **Consumed**: none new. The bell consumer (35d-2) reads the history row for the label; 35d-2b widens the label (below).
- **Module map**: no change. The label function is in `packages/i18n`; the role snapshot comes from the identity read that
  `SessionEditAccessPort` already performs (if it needs a new identity export symbol, 35d-4 declares the §6 entry itself).

### Test plan

- **Domain unit (no DB)**: editor limit incl. `OWNER`/`NOT_CONFIGURED` and the half-up/ceil cases of LE-05/06/08; no-change
  detection after percent conversion; reason normalisation (all-whitespace, tab/CR/LF, 500 vs 501 characters, 4-byte
  characters); `selfEditForbidden(editorUserId, snapshots, currentLinks)` (match by snapshot only, by link only, both, null,
  several performers); `editorLabel` for every system role code, a company role with the same code as a system role (must
  use its own name), name present, name absent, label failing the display-name filter.
- **Integration (real Postgres, T2 stack)**: `LE-01…LE-23`, each as a named test; plus: stale/no-change/cancelled each leave
  zero outbox, history and audit rows; replay after revocation → 403; limit change while waiting; two-business editor;
  snapshot unchanged after the employee is deactivated; concurrent edit of the same line (one winner); concurrent edit +
  append on the same visit serialise on the visit lock; total-too-large; end-to-end through the dispatcher (plan-35d test 10).
- **Concurrency / lock order** (copy of the append order, line lock added last): idempotency claim → `access.lock()` → visit
  advisory lock → load the line `FOR UPDATE` → `performers.lock(employeeIds)` → `access.read` + `discount.read(editorMembershipId)`
  at the fresh instant → window → performers' persisted snapshot + `performers.read` current links → prepare → CAS update →
  history row → audit → emit → store the response.
- **RLS negative (35d-3b)**: cross-tenant read of the new columns = 0 rows; the privilege allowlist still shows
  `line_performers` as `SELECT, INSERT` only; the new CHECKs reject `editor_role = 'Owner'`, a missing company-role name and a row with neither
  name nor role.
- **Queries (35d-5)**: result-shape test and an `EXPLAIN` assertion that the history read uses
  `service_line_edits_line_revision_key`.
- **Migration / rollout**: existing rows read `linked_user_snapshotted = false`; an insert that omits the new columns (old
  instance) yields `false`; the CHECK rejects `linked_user_id` set with `linked_user_snapshotted = false`; the edit refuses such a
  line (LE-13b).

## 5. Delivery: the sub-PR split after this spec

Owner rule 2026-10-12: at most three subtasks per PR. Sizes are hand-written lines including tests and copy.

| PR | Result | Blocked on | Size |
|---|---|---|---|
| **35d-3b** | Storage for D-1 and D-2: the migration above (no backfill), `linked_user_id` and `linked_user_snapshotted = true` written by record/append, schema + privilege allowlist + inventory + RLS negative tests | this spec; numbered after 35d-2's migration | 250–350 |
| **35d-2b** | `editorLabel` in `packages/i18n` (+ catalog keys for the other system roles' use and the generic label) and the 35d-2 consumer reading the widened columns, with the LE-21…23 tests | 35d-2 merged, 35d-3b | 120–200 |
| **35d-4** | The writer, as FR-001…FR-017, the `edited` boolean on the saved-line snapshot (FR-019), plus plan-35d delivery tests 1–3 and 10 | this spec; 35d-1, 35d-2, 35d-2b, 35d-3, 35d-3b | 450–600 |
| **35d-5** | Day-list edit form + the guarded history read (FR-018) + the day-list `edited` boolean and its `EXISTS` query (FR-019) | 35d-4 | 250–380 |
| **35d-6** | Reception edit for just-saved lines + the «edited» mark (FR-019) | 35d-4, 35d-5 | 200–320 |

35d-2b is small enough to be absorbed by the 35d-2 session if 35d-2 has not merged when 35d-3b does; either way 35d-4 does not
start before both are merged, so the writer never produces a row the consumer cannot label. 37b (performer changes) must write
`linked_user_id` and `linked_user_snapshotted = true` for the performers it adds.

## 6. Success criteria *(mandatory)*

- **SC-001** A manager corrects a wrong saved price in under one minute, and the manager of the branch is notified without any
  extra step.
- **SC-002** 100% of committed edits show a readable "who" in the history and the bell, for every role that can hold the
  permission; 0 edits are shown as a blank or an id.
- **SC-003** 0 edits are accepted from a user who is, or was when the line was recorded, a performer of that line; a line whose
  performer identity was never recorded cannot be edited at all.
- **SC-004** 0 edits are saved above the editor's discount limit; the refusal always says the largest allowed discount.
- **SC-005** A receptionist without the branch-read permission never sees a previous price, an editor or an edit time, on any
  screen or response.
- **SC-006** Sending the same edit twice, or from two screens, changes the line once and rings the bell once per revision.

## 7. Assumptions

- ED-Q13's labels are kept literally for the roles it names (owner «المالك», the three manager roles «المدير»); the other 9
  system roles use the owner-approved names of 2026-10-03 (`roleName`). The two catalogs say «المالك» here and
  «صاحب الشركة» in the permissions screen: unifying them is a one-word copy change in `in-app-catalog.ts`, not a model change.
- The generic fallback label for an editor whose role name fails the display-name filter is proposed copy: «مستخدم» / "User".
  It is a rare path and changing it needs no migration.
- `edited` means "has a price/discount edit" and is independent of `revision`, so 37 (cancel) and 37b (performer changes) can
  bump the revision without showing the badge.
- Lines recorded before 35d-3b stay non-editable by this endpoint. This costs nothing today (staging test data only, the
  salon pilot has not started); if real lines ever predate the snapshot, a separate, tenant-scoped resolution is a new decision.
- Edits are rare and single-line; the 200 ms rule is expected to hold synchronously, and 35d-4 measures it rather than assumes it.
- Out of scope and unchanged: the bell wording (ED-Q11), recipients (ED-Q9), the editor receiving the bell (ED-Q10), the
  window (ED-Q3) and each answered owner question.
