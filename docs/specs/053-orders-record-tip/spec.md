# Spec 053 — Record the tip of a service visit (Phase 1 row 36)

> **Status:** Draft · 2026-10-17 · docs-only PR. Owner answers TP-Q1…TP-Q4 (batch 26) and TP-Q5…TP-Q8 (batch 29), all
> Waleed's picks, are recorded in [owner-questions.ar.md](owner-questions.ar.md); no question is open.
> Abu Salem has not answered batches 26 or 29 yet; if his pick differs from
> Waleed's, his pick binds and the rule changes in a follow-up (`CLAUDE.md` §1 5b).
> **Depends on:** row 35 (`record-service-session`, spec 050) — merged. **Consumed later by:** row 50 (projection),
> row 55 (corrections of kind TIP), the statement's card-tips column.
> **Design advisors:** not required (docs-only lane; no files, no long work, no auth change).

## 1. What and why

After a visit the customer may leave a tip for the staff who served her. A tip belongs to the **employee in full**: it
is **outside** the visit net, outside commission thresholds and outside commission itself (D-36, decided 2026-10-01).
It is recorded **per employee with a method** (`CASH` or `CARD`). Card tips are paid with payroll and shown as their own
statement column; cash tips are informational (SPEC §6).

**Worked example (salon «صالون الأميرة», branch السالمية).** Visit of customer نورة: صبغة 60.000 by سارة and قص 20.000 by
هبة, net 80.000. Cashier منى records a CARD tip of 8.000. The screen suggests the split by each performer's share of
the **whole visit net** (TP-Q4): سارة 6.000 and هبة 2.000. منى may edit the amounts before saving. سارة's tip 6.000 never
touches her commission, which is computed on 60.000.

## 2. Scope and split (max 3 subtasks per PR; one use case per PR)

| Part | Content | Subtasks | Depends on |
|------|---------|----------|-----------|
| **36-0** | This spec + owner questions + plan row (docs-only PR) | spec, owner file, plan row | — |
| **36-1** | Storage | (a) migration: `session_tip_revisions` (with `event_id`) and `session_tips`, constraints, RLS, grants, `privileges.spec.ts` allowlist; (b) RLS negative isolation tests; (c) constraint tests (revision chain, uniqueness, amount bounds) | 36-0 |
| **36-2** | Pure domain | (a) `suggestTipSplit` (TP-Q4) with the rounding rule of TP-Q8; (b) `validateTipSet` (entries, bounds, performers, self rule); (c) `tipWindowOpen` (TP-Q2, reuses the recording window helper) and exhaustive unit tests | 36-0 |
| **36-3a** | Contracts, error codes, pure rules, event type, ports (no behaviour) | (a) `RecordSessionTipsInput` (with optional `recorder_membership_id`, D-T2), `SessionTips` (PUT and GET body), `SessionTipsChanged` event contract, OpenAPI schemas; (b) error codes `SESSION_NOT_FOUND`, `TIP_REVISION_CONFLICT`, `TIP_REASON_REQUIRED`, `TIP_NO_CHANGE` with ar/en messages; (c) pure `written-reason`, `tip-revision`, `tip-records` builders, the event type in `events/published.ts` and the worker known-type registration, `session-tips.port.ts` | 36-2 |
| **36-3b** | Use case `record-session-tips` and its storage access | (a) adapters behind the 36-3a ports (access, visit lock, people from `line_performers`, current revision, revision + entries insert); (b) use case: authorize, idempotency, lock order of D-T6, revision check, window, reason, `validateTipSet`, insert, audit, outbox `SessionTipsChanged` in the same transaction; (c) integration tests TP-01, TP-04…TP-13 at use-case level | 36-1, 36-3a |
| **36-3c** | HTTP and the current-set read | (a) `PUT` and `GET …/tips` routes, guard, error filter mapping, OpenAPI paths and generated clients; (b) the current-set read in `queries/` with result-shape and `EXPLAIN` tests; (c) HTTP tests TP-03 (byte-identical refusal for foreign and unknown sessions), TP-10 over HTTP, TP-14 | 36-3b |
| **36-4** | Reception screen | (a) tip entry with the suggested split; (b) edit with the written reason; (c) i18n ar/en, RTL, error messages | 36-3 (and the merged 35c screen) |
| **36-5** | Public reader for the row 50 bootstrap (BR-08) | (a) `queries/` read of the **latest revision per session** plus the `event_id` of every revision up to it, with keyset paging; (b) the read-only export in orders' `index.ts` (`listCurrentSessionTips`), module-map check; (c) result-shape, `EXPLAIN`, paging and revision tests | 36-1, 36-3 — **and row 50 depends on 36-5** |

Not here: the commission projection itself (row 50 builds it, but it **must bootstrap from 36-5 before approval opens**, BR-08) and statement columns (51…), corrections of kind TIP (55), a history view of
tip revisions (the revisions are stored and audited so a view can be added), payroll payment of card tips, rating
scheduling, payments and printing (Phase 2).

## 3. Owner rules

**Final (owner answers, batches 26 and 29 — Waleed's picks; Abu Salem's may replace them later):**

| ID | Rule |
|----|------|
| TP-Q1 | Recording a tip needs the **same permission as recording a visit** (`record:service-sessions:branch`: cashier and the managers). **Nobody records his own tip.** |
| TP-Q2 | A tip can be recorded or changed for the **same period as recording a visit** (back to the first day of the previous month); once the period is approved, a change becomes a **correction** (rows 50/55 post it). |
| TP-Q3 | A wrong tip is **replaced** with a **written reason** and the change is **logged in the audit with no bell notice**. No deleting of money rows. |
| TP-Q4 | For a visit with several services by several employees, the suggested split is **by each employee's share of the whole visit net** (example: 6 and 2); the cashier edits it. |
| TP-Q5 | **No reason on the first entry**; a written reason is required when replacing an existing tip (the first record is normal work and the cashier is in a hurry; replacing is what needs a justification). Batch 29. |
| TP-Q6 | If the performer's service is later cancelled (row 37) or moved to another employee (37b), the tip **stays recorded** (the money was actually paid); only a holder of the record permission can remove or replace it, with a written reason. Batch 29. **Scope (precedence kept from spec 054 §3.2):** TP-Q6 means the system **never removes a tip by itself** (the money was paid). On the **cancel path** (row 37) CX-Q4 stops the cancellation of a performer's last active line until a holder of the record permission removes or replaces the tip by hand with a written reason; on the **reassignment path** (37b) the tip stays recorded and untouched. |
| TP-Q7 | **No hard ceiling** on a tip, but the screen warns when the tip is larger than the visit net (big mistakes are rare and blocking could annoy a truly generous customer; the warning catches the slip). Batch 29. |
| TP-Q8 | The suggested split gives each employee the whole-mill part of her share, then the leftover mills one each to the largest fractional remainders (a tie goes to the smaller internal employee id, the same order as the commission split), so no amount is negative. An employee whose share is zero mills is left out of the suggestion. A visit whose net is zero is split equally. The total always equals the tip exactly and the cashier may edit the suggestion anyway. Batch 29. |

**From earlier decisions (not new questions):** D-36 (per employee, method, in full, outside net/thresholds/commission,
card tips as a statement column); SPEC §3 (`Tip`, event `SessionTipsChanged` with a per-session `revision`); SPEC §6 (a
tip changed for a closed period becomes a correction of kind TIP; the consumer, not orders, reads statement status);
spec 050 (money as canonical three-decimal KWD strings and bigint mills, back-dating window, Idempotency-Key on money
effects, business timezone, UUID v7, no `Date.now`/`randomUUID` in use cases).

## 4. User scenarios and acceptance criteria

| ID | Scenario |
|----|----------|
| TP-01 | منى (cashier, holds the record permission) records CARD 6.000 for سارة and CARD 2.000 for هبة on نورة's visit; one revision (1) is stored, one audit entry and one `SessionTipsChanged` event with both entries are written in the same transaction. |
| TP-02 | The screen suggests 6.000 / 2.000 for a tip of 8.000 over the nets 60.000 and 20.000 (TP-Q4); منى changes it to 5.000 / 3.000 and the saved values are exactly hers. |
| TP-03 | A user without the record permission, or outside the branch scope, gets the same refusal as an unknown session; nothing is written. |
| TP-04 | An employee cannot record or change a tip for **herself**: a request that adds, changes or removes an entry of an employee linked to the actor — by the performer's recorded snapshot `line_performers.linked_user_id` (ADR-0045) **or** by her current user link (including a performer later removed from the line by row 37b, whose identity is retained in the change history: spec 055 D-3 and FR-017) — is refused `TIP_SELF_FORBIDDEN` (her existing entries must be sent unchanged). **Fail closed only for an entry whose actor–performer identity cannot be resolved (ADR-0045):** when a performer row of that entry's employee on a line of the visit has `linked_user_snapshotted = false` (lines created before 35d-3b or by an old instance, never backfilled), neither the snapshot nor the current link can prove that the actor was *not* that performer at the time of the visit (a link may have been removed since), so adding, changing or removing **that entry** is refused `TIP_IDENTITY_UNKNOWN` for every actor, including a manager. Nothing else is affected: entries of employees whose rows are all snapshotted are checked by the snapshot as above, and the other entries of the same visit stay editable. No "unlinked actor" exemption exists because current data cannot prove historical non-identity; such an entry stays refused for every actor, permanently: no slice snapshots an old row (ADR-0045 rejects a backfill and spec 055 PC-12 refuses to change such a line) — rows of this kind exist only for visits recorded before 35d-3b (staging test data; Phase 1 has no production data). |
| TP-05 | An entry that is **added or changed** (a new (employee, method) pair, or the same pair with another amount) for an employee who is not a performer of any ACTIVE line of the visit is refused `TIP_EMPLOYEE_NOT_PERFORMER`. Following **TP-Q6** (the tip is money already given and stays recorded), an entry **carried unchanged** from the current revision (same employee, method and amount) is **not** re-checked against ACTIVE lines, so cancelling (row 37) or reassigning (37b) a line never blocks keeping or replacing the other entries, and removing an entry is allowed, **except where TP-04 refuses it** (`TIP_SELF_FORBIDDEN`, `TIP_IDENTITY_UNKNOWN`), which always wins. A visit with no ACTIVE line accepts only unchanged carried entries or removals. |
| TP-06 | A session whose business date is older than the first of the previous month (business timezone) is refused `TIP_WINDOW_CLOSED`; a session inside the window is accepted even when its period is already approved (the consumer posts the correction). |
| TP-07 | Replacing an existing tip set needs `expected_revision` equal to the current revision and a reason; a stale revision is refused `TIP_REVISION_CONFLICT` (409) and nothing is written. |
| TP-08 | A reason is required to replace an existing set (`TIP_REASON_REQUIRED`); the first entry needs none (TP-Q5). The reason is trimmed, 1…500 characters, and lives only in the revision row (not in the event, audit or logs; same convention as spec 035d). |
| TP-09 | Replacing with an empty set removes all tips of the visit as a new revision (the old revisions stay); the event carries an empty `tips` list. |
| TP-10 | Retrying the same request with the same `Idempotency-Key` returns the original result and writes nothing; the same key with another body is refused. |
| TP-11 | Two concurrent replacements of the same visit leave exactly one winner per revision and a continuous revision chain; the loser gets `TIP_REVISION_CONFLICT`. |
| TP-12 | Amounts must be greater than zero, canonical three-decimal KWD strings, and within `numeric(14,3)`; **the totals `total_cash` and `total_card` must also stay within `MONEY_MAX`** (the aggregate is checked before writing and refused `TIP_TOTAL_TOO_LARGE`, like `SESSION_TOTAL_TOO_LARGE` in spec 050); one entry per (employee, method) per revision; no hard ceiling: the screen warns when a tip exceeds the visit net (TP-Q7). |
| TP-13 | The event and the audit contain no phone, no customer name and no reason; money fields are canonical strings. |
| TP-14 | A user of another company cannot read or write another company's tips (RLS), and a tenant-qualified foreign key rejects a cross-tenant session or employee. |
| TP-15 | **Bootstrap (BR-08).** Tips recorded while no consumer exists are not lost: orders' public reader `listCurrentSessionTips` returns, for every session of the company/business that has tips, its **latest revision** and full current set (including a latest revision with no entries), in stable keyset pages; row 50 applies each only if the revision is newer than the one it holds, so a later live `SessionTipsChanged` of the same or a lower revision is ignored and no tip is counted twice. The consumer is live **before** the first page is read, and a revision written between a page read and the consumer's first delivery still ends up in the projection (race test). |

### Edge cases

- The same employee may receive both a CASH and a CARD tip on one visit (two entries, unique per method).
- A visit with several lines of one performer counts her once; her net share is the sum over ACTIVE lines.
- Removing a tip is a revision, never a delete. Revisions are insert-only (`SELECT`/`INSERT` grants).
- The recording time and revision time come from the injected `Clock`; ids from the injected `IdGenerator`.
- A closed company is refused like every orders write. The `orders` feature flag applies.
- Tips on a CANCELLED visit and on performers removed later: they **stay recorded** (TP-Q6: the system never removes a tip by itself; on the cancel path CX-Q4 stops cancelling a performer's last active line until the tip is removed by hand); only a holder of the
  record permission removes or replaces them, with a written reason, **unless TP-04 refuses that entry** (self, or unresolved identity); the commission side never recomputes them away.

## 5. Slice design

### 5.1 Business rules

- **BR-01 (TP-Q1)** Authority: `record:service-sessions:branch` at the session's branch, live recheck inside the transaction
  after the session lock; DENY and expiry per the permission engine. The actor's own employee may not add,
  change or remove her **own** entries, but may record others'.
- **BR-02 (D-36, TP-Q6)** Employees of a **new or changed** entry are the performers of ACTIVE lines of the visit; an entry carried unchanged
  from the current revision stays valid even if her lines were cancelled or reassigned later (TP-05); the TP-04 refusals still apply to it and take precedence. One entry per (employee, method).
- **BR-03 (TP-Q2)** The window is the one of spec 050 FR-014/FR-020: the session's persisted `business_date` must be on or
  after the first day of the previous calendar month in the business timezone at the injected `now`.
- **BR-04 (TP-Q3)** Replace, never delete: each change is a new revision holding the full current set; the previous
  revisions remain. A reason is required when replacing an existing set (not for the first entry, TP-Q5).
- **BR-05 (TP-Q4)** Suggested split: for each performer, `employee_net = Σ over ACTIVE lines of the employee's share of that line`, where the share is the
  one of SPEC §5.2 (`net × share_bps / 10000` floored to mills, remainder mills one each to the performers in ascending
  `employee_id` order), so the weights are whole mills and sum to the visit net; `suggestion = tip_total × employee_net / visit_net`. **One remainder order everywhere: ascending `employee_id`** — both for the line shares above (SPEC §5.2)
  and for the tie-break of the largest-remainder step of TP-Q8. *Worked example in mills:* a line of 0.001 KWD
  (1 mill) shared 50/50 by A and B gives A = 1 mill and B = 0 (remainder to the lower `employee_id`); a tip of 0.010
  over the weights A = 1, B = 0 gives A = 10 mills and B is left out. Three performers with equal weights 1.000 each and a
  tip of 0.100 (100 mills) have exact shares 33.333 each: floors 33/33/33, one mill left, all remainders tie, so the lower
  `employee_id` first: A = 34, B = 33, C = 33. Rounding of remainder mills and a zero-net visit: TP-Q8. The suggestion is advice only; the server stores exactly what the cashier sends.
- **BR-06 (D-36)** A tip is never part of a line's net, a threshold, or a commission base; orders computes none of that.
- **BR-07** All arithmetic lives in `orders/domain` pure functions; the use case calls them and does no arithmetic.
- **BR-08 (bootstrap, money)** `SessionTipsChanged` is registered in the worker's known-event registry before its consumer exists
  (the `SalaryChanged` precedent), and spec 050 §11 / ADR-0041 §6 state that *published-with-no-consumer does not imply automatic future replay*.
  So tips recorded before row 50 ships are **not** recoverable from events alone, and a missed tip means a wrong statement and wrong
  payroll. Therefore orders publishes a read-only public reader, **`listCurrentSessionTips`** (36-5): for a company, business and
  `business_date` range it returns per session the **latest revision** and the full current set (an empty set included), in
  keyset pages. **No new module-map arrow (ADR-0041 §6):** commissions never imports orders; row 50 declares a commissions-owned
  port (for example `SessionTipsBootstrapPort` in `commissions/ports/`) and the **composition root binds** orders' paged reader to it, exactly as ADR-0041 §6 prescribes
  for the line state ("an orders-owned paged reader bound at the root"); `docs/module-map.md` row `commissions ← staff` stays as is, and 36-5/row 50 each keep `pnpm module-map:check` green. If the root binding
  proves impossible without an import, the PR stops and adds an ADR plus the map entry first; it does not import orders.
  **The reader also returns, per session, the `event_id` of every revision up to the one it returns**, so row 50 can discharge them: in the same transaction that applies a bootstrapped
  session it inserts a `consumed_events` row (for `commissions.project-inputs`) for each of those ids (idempotent on conflict). Without that, the ADR-0041 §6 approval gate, which counts commission-relevant outbox
  events with no consumption row, would stay closed forever for pre-consumer tips, or be opened by guesswork.
  **Order of operations (closes the start gap):** (1) the row 50 `SessionTipsChanged` consumer is registered and live; (2) only then the bootstrap pages are read and applied; (3) a
  revision is applied only if it is newer than the one the projection holds (the revision guard used for line events), so the overlap is safe and a revision committed
  after the first read is still delivered by the live consumer, never lost; (4) approval/payroll stays closed until **both** hold: no `SessionTipsChanged` outbox event lacks a consumption row (the ADR-0041 §6 pending-input count), **and** for every session the
  projection's applied revision is ≥ the revision the reader reports (a per-session revision comparison, never a count of sessions, so a revision committed after the read cannot hide behind equal counts).
  The consumer-start/live-write race is a named test (TP-15).

### 5.1b Technical decisions of 36-3 (design advisors, 2026-10-17; none is an owner question)

- **D-T1 No change.** A replacement whose requested set equals the current set, and a first entry with an empty set, are
  refused 422 `TIP_NO_CHANGE` and nothing is written (precedents: 35d D-3, spec 055 no-change). The revision is compared
  **before** the set rules, so two identical racing requests give the loser `TIP_REVISION_CONFLICT` (35d D-10).
- **D-T2 Membership.** The body carries an optional `recorder_membership_id`; the writer reuses `resolveSessionRecorder`
  without the original-recorder exemption, so an actor with several eligible memberships must choose
  (`SESSION_RECORDER_MEMBERSHIP_REQUIRED`). The chosen membership is stored in `changed_by_membership_id`.
- **D-T3 Reason.** One shared normalizer (`written-reason.ts`) for the edit reason and the tip reason. A replacement with a
  missing or blank reason is refused `TIP_REASON_REQUIRED`; an invalid reason is `VALIDATION_FAILED`; a reason on revision 1
  is optional and stored if given.
- **D-T4 Event.** `SessionTipsChanged` = { `session_id`, `business_id`, `branch_id`, `occurred_at` (the session's),
  `business_date`, `revision`, `changed_at`, `tips` (full current set, canonical strings), `schema_version` 1 }; its outbox id
  is the revision's `event_id`. Registered in the worker before its consumer (row 50).
- **D-T5 Refusals.** Two layers, neither of which reveals whether a session exists elsewhere (TP-03). (1) The route guard
  (`@Require('record:service-sessions:branch')` at the route's branch) answers `FORBIDDEN` before any session is looked up,
  so it depends only on the caller's own permission. (2) Inside the transaction, every refusal about the session or the
  caller's live authority gives one `SESSION_NOT_FOUND` with an identical body: an unknown id, a session of another
  company, business or branch, and a live recheck that finds the permission revoked, DENY-overridden or expired (the
  `FORBIDDEN` of `resolveSessionRecorder` is translated to it). `FEATURE_DISABLED` and `SESSION_RECORDER_MEMBERSHIP_REQUIRED`
  keep their own codes (they describe the caller's company or own memberships, not the session). `TIP_REVISION_CONFLICT`
  (409) carries only `current_revision`.
- **D-T6 Lock order.** A lock-free pre-check first (the route's business and branch are active in the caller's company
  and the caller may record there; the session itself is read later, after the visit lock), as the
  edit-service-line-price precedent does, so a caller with no access never claims a key → idempotency
  claim (a replay locks the access rows and repeats the check before it returns the stored body) → access lock
  (company, memberships) → the visit advisory lock shared with
  record, append, edit and cancel (spec 054 §3.2) → read the session, lines, performer rows and current revision → the
  staff employee rows of every person involved (current links), ascending → fresh access recheck after all waits → rules →
  insert. No row lock on `service_lines` is needed: every writer of a line takes the visit lock. The write uses the 36-1
  seal as it is (one revision insert, then its entries, same transaction) and adds nothing to it (issue #338).
- **D-T7 Retained identities.** 36-3 reads the performer rows of the visit's current lines. Performers removed by row 37b
  join the people facts in 37b-4d (spec 055 FR-017), which must land before any removal route exists.

### 5.2 Rules from the answers TP-Q5…TP-Q8

- TP-Q5: no reason on the first entry; a reason when replacing.
- TP-Q6: the system never removes a tip by itself (the money was given); only a holder of the record permission can remove or
  replace it, with a written reason (TP-04 refusals still take precedence). On the cancel path (row 37) CX-Q4 (spec 054 §3.2)
  stops the cancellation of a performer's last active line until the tip is removed or replaced by hand; on the reassignment
  path (37b) the tip stays recorded and untouched. **TP-05, BR-02 and the edge cases follow this answer.**
- TP-Q7: no hard ceiling; the screen warns when a tip exceeds the visit net.
- TP-Q8: **largest-remainder** allocation in mills: every performer first gets the floor of her exact share, then the remaining mills are given one each to the largest fractional remainders (ties: ascending `employee_id`, the same order as the line shares of SPEC §5.2 in BR-05). No allocation can be negative. A performer whose allocation is 0 is left out of the suggestion (amounts must be greater than zero). A visit whose net is zero is split equally by the same method.

### 5.3 Schema changes (36-1)

Both tables are tenant tables: `company_id uuid NOT NULL`, primary key `(company_id, id)` (ADR-0007), UUID v7,
`ENABLE` + `FORCE ROW LEVEL SECURITY` with explicit USING/WITH CHECK, `SELECT`/`INSERT`-only runtime grants, the allowlist
in `privileges.spec.ts` updated in the same PR, and a negative isolation test per table.

| Table | Columns | Constraints and keys | Indexes |
|-------|---------|----------------------|---------|
| `session_tip_revisions` | `company_id`, `id`, `business_id`, `session_id`, `revision int`, `previous_revision int NULL`, `changed_by uuid` (user), `changed_by_membership_id uuid` (membership of that user), `changed_at timestamptz`, `reason text NULL`, `event_id uuid` (the id of the `SessionTipsChanged` outbox row written in the same transaction, from the injected `IdGenerator`; no FK to `outbox`), `write_xid xid8`, `write_system_id bigint` (the writing cluster's `system_identifier`; 0 for the rows written before ADR-0048), `created_at timestamptz DEFAULT now()` | PK `(company_id, id)`; `UNIQUE (company_id, session_id, revision)`; `UNIQUE (company_id, event_id)`; `UNIQUE (company_id, business_id, session_id, id)`; `UNIQUE (company_id, session_id, write_system_id, write_xid)`; `CHECK (coalesce((revision = 1 AND previous_revision IS NULL) OR (revision >= 2 AND previous_revision = revision - 1), false))`; `CHECK (revision = 1 OR reason IS NOT NULL)`; `CHECK (reason IS NULL OR (reason = btrim(reason, tab/LF/CR/space) AND char_length(reason) BETWEEN 1 AND 500))`; FKs: `company_id` → `companies`; `(company_id, business_id, session_id)` → `service_sessions`; self-FK `(company_id, session_id, previous_revision)` → `(company_id, session_id, revision)`; `(company_id, changed_by, changed_by_membership_id)` → `memberships`; `changed_by` → `user` | `(company_id, changed_by, changed_by_membership_id)`; `(changed_by)`; `(company_id, session_id, previous_revision)` |
| `session_tips` | `company_id`, `id`, `business_id`, `revision_id`, `session_id`, `employee_id`, `method text`, `amount numeric(14,3)` | PK `(company_id, id)`; `UNIQUE (company_id, revision_id, employee_id, method)`; `CHECK (method IN ('CASH','CARD'))`; `CHECK (amount > 0 AND amount <= 99999999999.999)` (the upper bound is the column maximum and rejects `NaN`; it is not a business ceiling, TP-Q7); FKs: `company_id` → `companies`; `(company_id, business_id, session_id, revision_id)` → `session_tip_revisions (company_id, business_id, session_id, id)`; `(company_id, business_id, session_id)` → `service_sessions`; `(company_id, business_id, employee_id)` → `employees` | `(company_id, business_id, session_id, revision_id)`; `(company_id, business_id, employee_id)` |

The current set of a visit is the entries of its highest revision (a revision with no entries means "no tips"). The chain
is declarative: `previous_revision` plus the self-FK, with no `max()+1` trigger and no advisory lock. The chain CHECK is
wrapped in `coalesce(..., false)` because PostgreSQL treats UNKNOWN as success, so a null `previous_revision` on any
revision other than 1 would otherwise be stored. The seal is `(write_system_id, write_xid)`:
`write_xid` is stamped on every insert by `session_tip_revisions_begin` (`BEFORE INSERT`,
`SECURITY INVOKER`), which overwrites any client value with `pg_current_xact_id()` and
`write_system_id` with the writing cluster's `system_identifier` — the pair survives a restore
into a fresh cluster, where the `xid` alone would not ([ADR-0048](../../adr/0048-restore-stable-write-seal.md)).
`session_tips_insert_guard` (`BEFORE INSERT`, `SECURITY INVOKER`) refuses an entry unless that
parent revision was inserted in the same transaction. Nothing is deferred. The composite FK on
`(company_id, business_id, session_id, revision_id)` keeps an entry on its revision's session and business, and
`session_tips_employee_fk` stops a tip from naming an employee of another business of the same company. A replacement
(`revision >= 2`) requires a reason; revision 1 may omit it, and a reason stored on revision 1 is kept. There is no
storage check that sums a revision (`TIP_TOTAL_TOO_LARGE` stays in the domain). Expand-only: new tables, no change to
existing tables. Indexes on the new tables are created with them; no `CONCURRENTLY` is needed on new tables (ADR-0033
covers indexes added to existing tables).

### 5.4 API contract (36-3)

- `PUT /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/tips` · `@Require('record:service-sessions:branch')`
  at the branch · feature flag `orders` · `Idempotency-Key` required (company scope; the fingerprint binds actor and session
  as in spec 050 §8).
- Body (strict Zod in `packages/contracts/src/orders/session-tips.ts`):
  `{ "expected_revision": 0, "tips": [{ "employee_id": "uuid", "method": "CARD", "amount": "6.000" }], "reason": "…"?, "recorder_membership_id": "uuid"? }`.
  `expected_revision` is `0` for the first entry. Amounts are canonical three-decimal KWD strings. At most 160 entries
  (20 lines × 4 performers × 2 methods). `recorder_membership_id` selects the membership when the actor has several (D-T2).
- 200 returns `{ revision, tips: [...], total_cash, total_card }`.
- `GET …/service-sessions/:sessionId/tips` returns the current revision and set (nothing else: no customer, no phone, no
  history); guard **`record:service-sessions:branch`**, so the cashier who may record a tip can always reload the current set
  and revision that the replacing PUT requires. The broader `read:service-sessions:branch` is not needed and not granted by this endpoint.
- Errors in the envelope `{ code, message_ar, message_en }`: `VALIDATION_FAILED`, `FORBIDDEN`, `SESSION_NOT_FOUND`
  (also for an out-of-scope or foreign session), `TIP_WINDOW_CLOSED`, `TIP_SELF_FORBIDDEN`, `TIP_IDENTITY_UNKNOWN`, `TIP_EMPLOYEE_NOT_PERFORMER`,
  `TIP_REVISION_CONFLICT` (409), `TIP_REASON_REQUIRED`, `TIP_NO_CHANGE` (D-T1), `TIP_TOTAL_TOO_LARGE`,
  `SESSION_RECORDER_MEMBERSHIP_REQUIRED` (D-T2), `FEATURE_DISABLED`, `TRANSACTION_RETRY_REQUIRED`. The codes and their ar/en
  messages live in `SessionErrorCode` and `serviceSessionErrors`; their HTTP statuses are mapped by the orders session error
  filter (36-3c), never inlined.

### 5.5 Permissions

No new permission. Recording and replacing use `record:service-sessions:branch` (defaults: owner, general manager, business
manager, branch manager, cashier; grantable to others). Reading the current tip set (the `GET …/tips` above, needed to replace it) uses the **same
record permission**, because the default cashier holds `record:` but not `read:service-sessions:branch`; the tip set is not
exposed through any other read (day list columns stay under the existing read permission). An employee seeing her own tips in her app belongs to
the staff-app rows, not here.

### 5.6 Events and audit

- **Published:** `SessionTipsChanged` (orders, `events/published.ts`, Arabic one-line doc), emitted in the same transaction as
  every revision: `session_id`, `business_id`, `branch_id`, `occurred_at` (the session's), `business_date`, `revision`,
  `changed_at` (the revision time, D-T4), `tips [{employee_id, amount, method}]` (the **full current set**, canonical strings), `schema_version = 1`. It is already
  declared in `docs/module-map.md` (orders ⇒ commissions); the worker's known-event registry gets it before its consumer
  (row 50), following the `SalaryChanged` precedent. No phone, customer name or reason.
- **Audit:** entity `service_session_tips`, action `tips.recorded` (first revision) or `tips.replaced`; before/after hold
  the revision and the (employee, method, amount) entries; actor and time recorded; no reason, no phone. **No bell**
  (TP-Q3).
- **Consumed:** none by orders. Row 50 projects tips from the event **and bootstraps from `listCurrentSessionTips` (BR-08) before approval opens**;
  rows 50/55 apply the correction of kind TIP when the session belongs to an approved period.

### 5.7 Module map

No new import arrow: orders already reads staff (performer eligibility, employee identity), identity (authority) and
tenancy through the ports of ADR-0041. The self-tip check uses the recorded snapshot `line_performers.linked_user_id` (written by orders itself, ADR-0045) and, in addition, the existing staff identity port for the employee's current user link, if a new read symbol is needed it is added to that port, not a new arrow. The bootstrap reader `listCurrentSessionTips` (36-5) is exported by orders; **commissions does not import it**: row 50 declares a commissions-owned port and the composition root binds the reader to it (BR-08, ADR-0041 §6), so this section adds no arrow and `docs/module-map.md` does not change.

### 5.8 Test plan

- **Domain unit (no database):** `suggestTipSplit` (the example 8.000 → 6.000/2.000, three-way remainders, single performer,
  zero-net visit, 0.002 over four performers, never negative, sum equals the tip), `validateTipSet` (empty set, duplicates, bounds, self rule, non-performer), `tipWindowOpen`
  (month boundary, timezone, injected clock).
- **Integration (real Postgres, one cloned DB per spec file):** TP-01…TP-14; concurrent replacements; retry with the same
  key; stale `expected_revision`; permission revoked during the lock wait; closed company; storage of insert-only revisions;
  TP-04 identity cases (an unsnapshotted row refuses add/change/removal of **that entry only** for any actor, linked or not, with `TIP_IDENTITY_UNKNOWN`; other entries of the same visit and snapshotted rows unaffected); TP-05 with TP-Q6 (cancel/reassign a line, then keep the entry, replace
  the others, remove it, and an added entry for a non-performer still refused).
- **Bootstrap (36-5, TP-15; also listed in row 50's test plan):** tips recorded before any consumer exists are all returned by
  `listCurrentSessionTips` at their latest revision (empty latest set included); paging is stable under concurrent writes; the
  row 50 projection built only from the reader equals the one built from events; a live event with the same or a lower
  revision after the bootstrap changes nothing; **consumer-start/live-write race:** a revision committed between a page read and the consumer's first delivery
  still reaches the projection, and approval opens only when every `SessionTipsChanged` event is consumed and every session's projected revision is ≥ the reader's.
- **RLS negative:** both tables — cross-tenant read = 0 rows, write = error, foreign-tenant session or employee rejected by FK.
- **Queries:** result-shape test and `EXPLAIN` index assertion for the current-set read.
- **Contracts:** strict body, money strings, `expected_revision`, OpenAPI route and `pnpm contracts:openapi` fresh.
- **UI (36-4):** suggested split, edit, reason, ar/en errors, RTL logical properties.
- **Docs:** Arabic doc comments on `domain/**`, `ports/**` and the new event in the same commit.

## 6. Success criteria

- SC-01: a cashier records the tip of a two-performer visit in under 30 seconds with the suggested split.
- SC-02: the commission of a performer is identical with and without her tip (BR-06).
- SC-03: no tip money row is ever updated or deleted; every change is a new revision with an audit entry.

## 7. Assumptions

- The tip is in the business currency, KWD with three decimals (`Money`, bigint mills).
- Tips are recorded by staff at the branch screen after the visit; there is no customer-facing tip entry in Phase 1.
- Payment of card tips happens with payroll (rows 51+); this slice records the tip and its method only.
- The reason follows the convention of spec 035d (stored in the revision row, absent from event, audit and logs).
