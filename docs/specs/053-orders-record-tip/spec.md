# Spec 053 — Record the tip of a service visit (Phase 1 row 36)

> **Status:** Draft · 2026-10-17 · docs-only PR. Owner answers TP-Q1…TP-Q4 (batch 26, Waleed's picks) are recorded in
> [owner-questions.ar.md](owner-questions.ar.md); the rules they do not cover wait on TP-Q5…TP-Q8, all `PENDING`.
> **No code starts before they are answered.** Abu Salem has not answered batch 26 yet; if his pick differs from
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
| **36-1** | Storage | (a) migration: `session_tip_revisions` and `session_tips`, constraints, RLS, grants, `privileges.spec.ts` allowlist; (b) RLS negative isolation tests; (c) constraint tests (revision chain, uniqueness, amount bounds) | 36-0 answered |
| **36-2** | Pure domain | (a) `suggestTipSplit` (TP-Q4) with the rounding rule of TP-Q8; (b) `validateTipSet` (entries, bounds, performers, self rule); (c) `tipWindowOpen` (TP-Q2, reuses the recording window helper) and exhaustive unit tests | 36-0 answered |
| **36-3** | Use case `record-session-tips` | (a) contract + `PUT …/service-sessions/:sessionId/tips` + guard + idempotency; (b) use case: lock, revision check, insert, audit, outbox `SessionTipsChanged`; (c) integration tests TP-01…TP-14 and the read of the current set | 36-1, 36-2 |
| **36-4** | Reception screen | (a) tip entry with the suggested split; (b) edit with the written reason; (c) i18n ar/en, RTL, error messages | 36-3 (and the merged 35c screen) |

Not here: the commission projection and statement columns (50, 51…), corrections of kind TIP (55), a history view of
tip revisions (the revisions are stored and audited so a view can be added), payroll payment of card tips, rating
scheduling, payments and printing (Phase 2).

## 3. Owner rules

**Final (owner answers, batch 26 — Waleed's picks; Abu Salem's may replace them later):**

| ID | Rule |
|----|------|
| TP-Q1 | Recording a tip needs the **same permission as recording a visit** (`record:service-sessions:branch`: cashier and the managers). **Nobody records his own tip.** |
| TP-Q2 | A tip can be recorded or changed for the **same period as recording a visit** (back to the first day of the previous month); once the period is approved, a change becomes a **correction** (rows 50/55 post it). |
| TP-Q3 | A wrong tip is **replaced** with a **written reason** and the change is **logged in the audit with no bell notice**. No deleting of money rows. |
| TP-Q4 | For a visit with several services by several employees, the suggested split is **by each employee's share of the whole visit net** (example: 6 and 2); the cashier edits it. |

**From earlier decisions (not new questions):** D-36 (per employee, method, in full, outside net/thresholds/commission,
card tips as a statement column); SPEC §3 (`Tip`, event `SessionTipsChanged` with a per-session `revision`); SPEC §6 (a
tip changed for a closed period becomes a correction of kind TIP; the consumer, not orders, reads statement status);
spec 050 (money as canonical three-decimal KWD strings and bigint mills, back-dating window, Idempotency-Key on money
effects, business timezone, UUID v7, no `Date.now`/`randomUUID` in use cases).

**Pending (each is `PENDING` in [owner-questions.ar.md](owner-questions.ar.md); nothing below is implemented until answered):**

- **TODO(spec) TP-Q5** — is a written reason also required on the **first** entry, or only when an existing tip is replaced?
- **TODO(spec) TP-Q6** — what happens to a tip when the performer's lines are later cancelled (row 37) or reassigned (37b)?
- **TODO(spec) TP-Q7** — is there a ceiling on a tip (block, warn, or none)?
- **TODO(spec) TP-Q8** — the rounding of the suggested split (remainder mills) and the all-zero-net visit.

Until they are answered, §5.2 items marked ⟨TP-Q5…Q8⟩ are **recommendations, not rules**.

## 4. User scenarios and acceptance criteria

| ID | Scenario |
|----|----------|
| TP-01 | منى (cashier, holds the record permission) records CARD 6.000 for سارة and CARD 2.000 for هبة on نورة's visit; one revision (1) is stored, one audit entry and one `SessionTipsChanged` event with both entries are written in the same transaction. |
| TP-02 | The screen suggests 6.000 / 2.000 for a tip of 8.000 over the nets 60.000 and 20.000 (TP-Q4); منى changes it to 5.000 / 3.000 and the saved values are exactly hers. |
| TP-03 | A user without the record permission, or outside the branch scope, gets the same refusal as an unknown session; nothing is written. |
| TP-04 | An employee cannot record or change a tip for **herself**: a request that adds, changes or removes an entry of the actor's own employee is refused `TIP_SELF_FORBIDDEN` (her existing entries must be sent unchanged). |
| TP-05 | An entry for an employee who is not a performer of any ACTIVE line of the visit is refused `TIP_EMPLOYEE_NOT_PERFORMER`. |
| TP-06 | A session whose business date is older than the first of the previous month (business timezone) is refused `TIP_WINDOW_CLOSED`; a session inside the window is accepted even when its period is already approved (the consumer posts the correction). |
| TP-07 | Replacing an existing tip set needs `expected_revision` equal to the current revision and a reason; a stale revision is refused `TIP_REVISION_CONFLICT` (409) and nothing is written. |
| TP-08 | A reason is required to replace an existing set (`TIP_REASON_REQUIRED`); ⟨TP-Q5⟩ whether the first entry needs one. The reason is trimmed, 1…500 characters, and lives only in the revision row (not in the event, audit or logs; same convention as spec 035d). |
| TP-09 | Replacing with an empty set removes all tips of the visit as a new revision (the old revisions stay); the event carries an empty `tips` list. |
| TP-10 | Retrying the same request with the same `Idempotency-Key` returns the original result and writes nothing; the same key with another body is refused. |
| TP-11 | Two concurrent replacements of the same visit leave exactly one winner per revision and a continuous revision chain; the loser gets `TIP_REVISION_CONFLICT`. |
| TP-12 | Amounts must be greater than zero, canonical three-decimal KWD strings, and within `numeric(14,3)`; one entry per (employee, method) per revision; ⟨TP-Q7⟩ ceiling behaviour. |
| TP-13 | The event and the audit contain no phone, no customer name and no reason; money fields are canonical strings. |
| TP-14 | A user of another company cannot read or write another company's tips (RLS), and a tenant-qualified foreign key rejects a cross-tenant session or employee. |

### Edge cases

- The same employee may receive both a CASH and a CARD tip on one visit (two entries, unique per method).
- A visit with several lines of one performer counts her once; her net share is the sum over ACTIVE lines.
- Removing a tip is a revision, never a delete. Revisions are insert-only (`SELECT`/`INSERT` grants).
- The recording time and revision time come from the injected `Clock`; ids from the injected `IdGenerator`.
- A closed company is refused like every orders write. The `orders` feature flag applies.
- Tips on a CANCELLED visit and on performers removed later: ⟨TP-Q6⟩.

## 5. Slice design

### 5.1 Business rules

- **BR-01 (TP-Q1)** Authority: `record:service-sessions:branch` at the session's branch, live recheck inside the transaction
  after the session lock; DENY and expiry per the permission engine. The actor's own employee (if she has one) may not add,
  change or remove her **own** entries, but may record others'.
- **BR-02 (D-36)** Eligible employees are the performers of ACTIVE lines of the visit. One entry per (employee, method).
- **BR-03 (TP-Q2)** The window is the one of spec 050 FR-014/FR-020: the session's persisted `business_date` must be on or
  after the first day of the previous calendar month in the business timezone at the injected `now`.
- **BR-04 (TP-Q3)** Replace, never delete: each change is a new revision holding the full current set; the previous
  revisions remain. A reason is required when replacing an existing set (⟨TP-Q5⟩ for the first entry).
- **BR-05 (TP-Q4)** Suggested split: for each performer, `employee_net = Σ over ACTIVE lines of line.net × share_bps /
  10000` (mills); `suggestion = tip_total × employee_net / visit_net`. Rounding of remainder mills and a zero-net visit:
  ⟨TP-Q8⟩. The suggestion is advice only; the server stores exactly what the cashier sends.
- **BR-06 (D-36)** A tip is never part of a line's net, a threshold, or a commission base; orders computes none of that.
- **BR-07** All arithmetic lives in `orders/domain` pure functions; the use case calls them and does no arithmetic.

### 5.2 Recommendations awaiting the owner

- ⟨TP-Q5⟩ No reason on the first entry; a reason when replacing.
- ⟨TP-Q6⟩ The tip stays recorded when lines are cancelled or reassigned (the money was given); only a manager with the record
  permission can remove it, with a reason.
- ⟨TP-Q7⟩ No hard ceiling; the screen warns when a tip exceeds the visit net.
- ⟨TP-Q8⟩ **Largest-remainder** allocation in mills: every performer first gets the floor of her exact share, then the remaining mills are given one each to the largest fractional remainders (ties: first in performer order, as spec 050 SS-Q7 does for shares). No allocation can be negative. A performer whose allocation is 0 is left out of the suggestion (amounts must be greater than zero). A visit whose net is zero is split equally by the same method.

### 5.3 Schema changes (36-1)

Both tables are tenant tables: `company_id uuid NOT NULL`, primary key `(company_id, id)` (ADR-0007), UUID v7,
`ENABLE` + `FORCE ROW LEVEL SECURITY` with explicit USING/WITH CHECK, `SELECT`/`INSERT`-only runtime grants, the allowlist
in `privileges.spec.ts` updated in the same PR, and a negative isolation test per table.

| Table | Columns | Constraints and keys | Indexes |
|-------|---------|----------------------|---------|
| `session_tip_revisions` | `company_id`, `id`, `business_id`, `session_id`, `revision int`, `changed_by uuid` (user), `changed_at timestamptz`, `reason text NULL` | `CHECK (revision >= 1)`, `CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)`, `UNIQUE (company_id, session_id, revision)`, FK `(company_id, business_id, session_id)` → `service_sessions` | the unique index (leading `company_id`); user FK index |
| `session_tips` | `company_id`, `id`, `business_id`, `revision_id`, `session_id`, `employee_id`, `method text`, `amount numeric(14,3)` | `CHECK (method IN ('CASH','CARD'))`, `CHECK (amount > 0)`, `UNIQUE (company_id, revision_id, employee_id, method)`, business-qualified FKs: `(company_id, revision_id)`, `(company_id, business_id, session_id)` → `service_sessions` (it has `UNIQUE (company_id, business_id, id)`), `(company_id, business_id, employee_id)` → `employees` (`employees_company_business_id_key`) | `(company_id, session_id, revision_id)`; employee FK index |

The current set of a visit is the entries of its highest revision (a revision with no entries means "no tips"). A deferred
trigger (SECURITY INVOKER, as in spec 050) checks that a revision's entries belong to the same session as their revision;
business consistency is enforced by the business-qualified foreign keys above, so a tip cannot name an employee of another
business of the same company.
Expand-only: new tables, no change to existing tables. Indexes on the new tables are created with them; no
`CONCURRENTLY` is needed on new tables (ADR-0033 covers indexes added to existing tables).

### 5.4 API contract (36-3)

- `PUT /v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/tips` · `@Require('record:service-sessions:branch')`
  at the branch · feature flag `orders` · `Idempotency-Key` required (company scope; the fingerprint binds actor and session
  as in spec 050 §8).
- Body (strict Zod in `packages/contracts/src/orders/session-tips.ts`):
  `{ "expected_revision": 0, "tips": [{ "employee_id": "uuid", "method": "CARD", "amount": "6.000" }], "reason": "…"? }`.
  `expected_revision` is `0` for the first entry. Amounts are canonical three-decimal KWD strings.
- 200 returns `{ revision, tips: [...], total_cash, total_card }`.
- `GET …/service-sessions/:sessionId/tips` returns the current revision and set (nothing else: no customer, no phone, no
  history); guard **`record:service-sessions:branch`**, so the cashier who may record a tip can always reload the current set
  and revision that the replacing PUT requires. The broader `read:service-sessions:branch` is not needed and not granted by this endpoint.
- Errors in the envelope `{ code, message_ar, message_en }`: `VALIDATION_FAILED`, `FORBIDDEN`, `SESSION_NOT_FOUND`
  (also for an out-of-scope or foreign session), `TIP_WINDOW_CLOSED`, `TIP_SELF_FORBIDDEN`, `TIP_EMPLOYEE_NOT_PERFORMER`,
  `TIP_REVISION_CONFLICT` (409), `TIP_REASON_REQUIRED`, `TRANSACTION_RETRY_REQUIRED`. New codes are added to
  `src/shared/errors.ts`, never inlined.

### 5.5 Permissions

No new permission. Recording and replacing use `record:service-sessions:branch` (defaults: owner, general manager, business
manager, branch manager, cashier; grantable to others). Reading the current tip set (the `GET …/tips` above, needed to replace it) uses the **same
record permission**, because the default cashier holds `record:` but not `read:service-sessions:branch`; the tip set is not
exposed through any other read (day list columns stay under the existing read permission). An employee seeing her own tips in her app belongs to
the staff-app rows, not here.

### 5.6 Events and audit

- **Published:** `SessionTipsChanged` (orders, `events/published.ts`, Arabic one-line doc), emitted in the same transaction as
  every revision: `session_id`, `business_id`, `branch_id`, `occurred_at` (the session's), `business_date`, `revision`,
  `tips [{employee_id, amount, method}]` (the **full current set**, canonical strings), `schema_version = 1`. It is already
  declared in `docs/module-map.md` (orders ⇒ commissions); the worker's known-event registry gets it before its consumer
  (row 50), following the `SalaryChanged` precedent. No phone, customer name or reason.
- **Audit:** entity `service_session_tips`, action `tips.recorded` (first revision) or `tips.replaced`; before/after hold
  the revision and the (employee, method, amount) entries; actor and time recorded; no reason, no phone. **No bell**
  (TP-Q3).
- **Consumed:** none. Rows 50/55 apply the correction of kind TIP when the session belongs to an approved period.

### 5.7 Module map

No new import arrow: orders already reads staff (performer eligibility, employee identity), identity (authority) and
tenancy through the ports of ADR-0041. The "is this the actor's own employee" check reads the existing staff identity
port; if a new read symbol is needed it is added to that port, not a new arrow.

### 5.8 Test plan

- **Domain unit (no database):** `suggestTipSplit` (the example 8.000 → 6.000/2.000, three-way remainders, single performer,
  zero-net visit, 0.002 over four performers, never negative, sum equals the tip), `validateTipSet` (empty set, duplicates, bounds, self rule, non-performer), `tipWindowOpen`
  (month boundary, timezone, injected clock).
- **Integration (real Postgres, one cloned DB per spec file):** TP-01…TP-14; concurrent replacements; retry with the same
  key; stale `expected_revision`; permission revoked during the lock wait; closed company; storage of insert-only revisions.
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
