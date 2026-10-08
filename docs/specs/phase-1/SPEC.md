# Phase 1 — Salon Pilot Spec: staff, attendance, sessions, packages, commissions

> **Status:** Draft v7 · 2026-10-01 · from the onboarding interview with Waleed (2026-09-30 → 2026-10-01) and Codex's
> reviews (round 1: 30 findings; round 2: 17; round 3: 11; round 4 on gpt-6.1-sol: 18; round 5: 12; round 6: 3). Decisions: `docs/PRD.md` §12 — D-12…D-17, D-28, D-30, D-32 (decided)
> and D-35…D-58. **Governing docs:** `CLAUDE.md` · `CLAUDE.architecture.md` · `06_Tech_Stack` · `module-map.md`; on
> conflict they win, and §9 names every amendment this phase needs. **Supersedes** the PRD §10 Phase 1 task list where
> the two differ.

---

## 1. Why this phase exists

The salon owner's two named pains are attendance and commissions. Phase 1 replaces the salon's manual attendance and
its commission spreadsheet: staff clock in with a rotating QR, reception records every session with its performer,
customer and price, each employee watches her estimated commission as she works, and the owner approves one monthly
statement that is then final.

### The single success criterion

> After one full month run **in parallel** with the salon's manual process, the approved statement matches the
> manager's own hand calculation for every employee to **0.001 KWD**, or every difference is traced to an error in the
> manual sheet; at period close there are zero lines without a performer; and the approval actor and time are in the
> audit log.

The parallel month is the business oracle (D-45). Before it, correctness rests on §5's definition and on expected-output
fixtures calculated by hand, independently of the code, from the salon's real plan rules (D-55).

---

## 2. Scope

### In

| Area                           | What ships                                                                                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Apps                           | `apps/admin` (Next.js) and `apps/pos` (Vite PWA: attendance screen + staff app) — shells, then one screen per slice                                                            |
| `packages/ui`                  | shadcn RTL kit, tokens, Arabic fonts, lucide                                                                                                                                   |
| `staff`                        | employees, salary history (restricted), branches, phone passkey binding, barcode card, schedules, leave, attendance, document metadata                                         |
| `files` (minimal)              | private R2 objects, presigned upload/download, access audit                                                                                                                    |
| `catalog` (minimal)            | services (price, commission rule, threshold flag), package types                                                                                                               |
| `customers` (minimal, from P2) | company-scoped customers (D-30), opt-out, ratings                                                                                                                              |
| `orders` (minimal)             | sessions: lines, price override, discount + approval, split performers, tips, late entry, cancel; package sale, redemption, expiry, extension, refund                          |
| `identity` (addition)          | discount-limit permission, discount approval (PIN on device or remote request)                                                                                                 |
| `commissions`                  | per-employee plan versions (base + tiers, independently switchable), service overrides, live estimate, statement DRAFT → REVIEWED → APPROVED → PAID, corrections, Excel export |
| `notifications` (minimal)      | WhatsApp + email channels, templates ar/en, suppression, delivery log                                                                                                          |
| `settings` (addition)          | alert rules, staff-app columns, default discount limit                                                                                                                         |
| Import                         | Excel template, preview, all-or-nothing commit: employees, services, customers, open packages                                                                                  |

### Out

- POS sell screen, payments, cash shifts, printing (Phase 2); sessions are recorded on an admin/reception screen.
- The service **barcode** flow (D-15 → Phase 2, same data model).
- Package instalments and sharing (D-42). Ratings affecting commission (D-41). Overtime pay and lateness deductions.
- Realtime/SSE — screens poll (PRD Phase 1 exception, closed by P2-T8). Product sales (Phase 2).

---

## 3. Modules and their contracts

| Module                  | New / extended | Owns                                                                                                |
| ----------------------- | -------------- | --------------------------------------------------------------------------------------------------- |
| `staff`                 | new            | employees, salary history, schedules, leave, attendance, passkey bindings, cards, document metadata |
| `files`                 | new            | private objects, their required read permission, access audit                                       |
| `catalog`               | new            | services, package types                                                                             |
| `customers`             | new            | customers (company-scoped), opt-out preference, rating requests, ratings                            |
| `orders`                | new            | sessions, lines, performers, tips, discount proposals, package entitlements, redemptions, refunds   |
| `commissions`           | new            | plan versions, service overrides, projection, statements, frozen results, corrections               |
| `notifications`         | new            | channels, templates, suppression, delivery log                                                      |
| `identity` · `settings` | extended       | discount approval · alert rules, staff columns                                                      |

Cross-module interactions (import arrows already in `module-map.md` §2 unless marked **new**):

| From → to                                        | Kind            | Contract                                                                                                                                                           |
| ------------------------------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orders` → `catalog`                             | port (existing) | `CatalogReaderPort`: price, names, commission rule, threshold flag; package-type components                                                                        |
| `orders` → `customers`                           | port **new**    | `CustomerLookupPort.exists(customerId)`; reception finds or creates the customer first through `customers`' own endpoint                                           |
| `orders` → `staff`                               | port **new**    | `PerformerCheckPort`: employee active and attached to the branch on the date                                                                                       |
| `commissions` → `staff`                          | port **new**    | `EmployeeDirectoryPort` (names)                                                                                                                                    |
| `staff` ⇒ `commissions`                          | event **new**   | `SalaryChanged` — identity `(employee_id, effective_from)`, `amount`, per-entry `revision`; salary is an input like a line: projected, fingerprinted, corrected    |
| `customers` → `staff`                            | port **new**    | `PerformerNamePort` (first name in the rating message)                                                                                                             |
| `customers` → `orders`                           | port **new**    | `DaySessionsPort`: the customer's active lines and performers for a business day — read at claim time, the authoritative boundary for rating attribution (§10)     |
| `staff`, `customers`, `commissions` → `settings` | port **new**    | `AlertRulesPort`, `StaffColumnsPort` (reads)                                                                                                                       |
| `orders` ⇒ `commissions`, `customers`            | event **new**   | `ServiceLineChanged`                                                                                                                                               |
| `orders` ⇒ `commissions`                         | event **new**   | `PackageSaleChanged`, `SessionTipsChanged`                                                                                                                         |
| `customers` ⇒ `notifications`                    | event **new**   | `RatingRequestReady`, `LowRatingReceived`                                                                                                                          |
| `staff` ⇒ `notifications`                        | event **new**   | `AttendanceExceptionRaised`, `ShiftNotClockedIn`, `DocumentExpiring`                                                                                               |
| `commissions` ⇒ `notifications`                  | event **new**   | `StatementAwaitingReview`, `StatementAwaitingApproval`                                                                                                             |
| `files`                                          | none            | documents are uploaded and opened through `files`' own endpoints; `staff` stores the object key only                                                               |
| OTP                                              | wiring          | `packages/auth` takes an injected `OtpSender`, bound at `apps/api`'s composition root to id-only `notifications-otp`; worker notifications owns Channel (ADR-0019) |

Every event names a stable identity and carries every field its consumers use:

- `ServiceLineChanged` — `line_id`, `session_id`, `service_id`, `branch_id`, `business_id`, `customer_id`, `status`,
  `occurred_at`, `recorded_at`, `net`, `performers [{employee_id, share_bps}]`, `rule_snapshot`, `counts_snapshot`,
  `package {entitlement_id, component_id, ordinal}?`, `revision` (per line, +1 on every change).
- `PackageSaleChanged` — `sale_id` (= the entitlement id), `business_id`, `sold_at`, `seller_employee_id`,
  `price_paid`, `refunded_amount`, `status`, `revision`.
- `SessionTipsChanged` — `session_id`, `business_id`, `occurred_at`, `tips [{employee_id, amount, method}]`,
  `revision` (per session).

Emitting modules read `AlertRulesPort` and put recipients and channels in the event, so `notifications` holds no
business knowledge. `ServiceCompleted` in the map is replaced in Phase 1 by `ServiceLineChanged` (ADR-0010).

---

## 4. Domain model — Phase 1 subset

Phase 0 conventions hold: tenant PK `(company_id, id)`, UUID v7, FORCE RLS, money `numeric(14,3)` / `bigint` mills,
`timestamptz` UTC, financial rows immutable with reversals.

```
Employee          business_id · primary_branch_id · user_id? · names · role_code · hire_date · contract_end? · deleted_at?
EmployeeSalary    employee_id · effective_from · amount · set_by · revision — restricted; UNIQUE (employee_id, effective_from):
                  setting a salary on an existing date replaces it (revision +1), never adds a second; any date,
                  audited; a change reaching a closed period becomes a correction (§6)
EmployeeBranch    employee_id · branch_id · from · to?
EmployeePasskey   (company_id,id) · employee_id · passkey_id · revision · bound_at/by · unbound_at/by? — tenant binding only
                  one active row per employee (§7)
EmployeeCard      employee_id · card_code · issued_at · revoked_at?
Schedule          employee_id · branch_id · week_start · shifts [{day, start, end}]      ShiftTemplate
LeaveRequest      employee_id · from · to · type · status · decided_by?
AttendanceState   employee_id · last_accepted_scan_at — one row per employee, locked by every scan and job (§7)
AttendanceSession employee_id · branch_id · clock_in · clock_out? · source (QR|BARCODE) · geo (OK|OUT_OF_RANGE|NONE)
                  working_date · closed_by (EMPLOYEE|MISSED_OUT) · revision
AttendanceException session_id · kind · status (OPEN|RESOLVED) · resolution? · resolved_by? · reason?
AttendanceCorrection session_id · field · before · after · reason · by · at
EmployeeDocument  employee_id · type_code · object_key · expires_on? · uploaded_by       DocumentType (editable, alert_days)

DiscountLimit     (identity) membership_id · limit_bps, a parameter of the discount permission; the business
                  default lives in settings (D-56). Effective discount of a line = (list_price − net) / list_price,
                  so lowering the price counts too; when `list_price = 0` it is 0 % (a free service cannot be
                  discounted further). A package redemption line's list price is its slot's `unit_value`, so a
                  redemption is never a discount; a package's discount is checked once, on its **sale** line,
                  against the package type's price.
Service           names · price · commission_rule (FOLLOW_PLAN | ZERO | PCT bps | FIXED mills) · counts_toward_threshold
PackageType       names · price · validity_days · components [{service_id, sessions}]
                  — one validator for types, sales and imports: ≥ 1 component, unique service_id, integer sessions ≥ 1,
                    price ≥ 0, imported remaining in 0…original; named errors, checked at preview and commit (§8)

Customer          company_id · name · phone (E.164, unique per company) · locale · opted_out_at?        (D-30)
RatingRequest     business_id · customer_id · business_date · branch_id · due_at · send_deadline (closing time)
                  status (SCHEDULED|SENDING|SENT|CANCELLED) · cancel_reason (NO_ACTIVE_LINE|PAST_DEADLINE|OPTED_OUT) · performer_ids (snapshot) · token_hash · expires_at · consumed_at?
                  UNIQUE (company_id, business_id, customer_id, business_date)
Rating            request_id · stars 1..5 · comment? · submitted_at

ServiceSession    business_id · branch_id · customer_id · recorded_by · occurred_at · recorded_at · late
ServiceLine       session_id · service_id · revision · status (ACTIVE|CANCELLED) · list_price · price · discount · net
                  rule_snapshot · counts_snapshot · redemption_id?
LinePerformer     line_id · employee_id · share_bps (Σ = 10000)
Tip               session_id · employee_id · amount · method (CASH|CARD)
                  — entered per employee; for a shared session the screen pre-fills the split by commission shares
DiscountProposal  terms_hash · terms · requested_by · status (PENDING|APPROVED|REJECTED|EXPIRED|CONSUMED)
                  approver? · via (PIN|REMOTE)? · expires_at (15 min) · consumed_by_line?
PackageEntitlement business_id · customer_id · package_type_id · provenance (SOLD|IMPORTED) · external_ref?
                  sold_line_id? · sold_at · seller_employee_id? · price_paid · paid_method? · expires_on · revision
PackageComponent  entitlement_id · service_id · list_price_snapshot · sessions_total · component_value
PackageSessionSlot component_id · ordinal · unit_value · state (FREE|USED|REFUNDED|IMPORTED_USED)
PackageRedemption slot_id · line_id · at · reversed_at?                                 (immutable; reversal frees the slot)
PackageRefund     entitlement_id · component_id · ordinals [] · amount · approved_by · idempotency_key

PlanVersion       employee_id · version · effective_from (date) · whole_period (bool) · created_at · created_by
                  base   { enabled, calc: PCT bps | FIXED mills }
                  tiers  { enabled, accumulator: AMOUNT | SESSIONS, mode: MARGINAL | WHOLE,
                           steps: [{ from, calc: PCT | FIXED }] }   — `from` all literal amounts, all salary multiples,
                                                                       or all session counts, never mixed
                  package_sale { enabled, calc: PCT | FIXED }
ServiceOverride   employee_id · service_id · rule (FOLLOW_PLAN | ZERO | PCT | FIXED) · effective_from · created_at
CommissionLine    (projection, one row per line × performer) line_id · revision · employee_id · service_id
                  occurred_at · recorded_at · net_share · share_bps · rule_snapshot · counts · status
CommissionSale    (projection) sale_id · revision · seller · sold_at · price_paid · refunded_amount · status
CommissionSalary  (projection) employee_id · effective_from · amount · revision
CommissionTip     (projection) session_id · revision · employee_id · amount · method · business_date
Statement         business_id · period (YYYY-MM) · status (DRAFT|REVIEWED|APPROVED|PAID)
                  input_fingerprint · reviewed_fingerprint? · reviewed_by? · approved_by? · approved_at? · paid_at? · paid_method?
StatementLine     statement_id · employee_id · source_ref ('line:<id>' | 'sale:<id>' | 'tip:<session>:<method>')
                  · amount · kind (COMMISSION|SALE|TIP_CARD|TIP_CASH|CORRECTION)                 (frozen)
PeriodGeneration  employee_id · period · generation   — +1 each time a change is applied to an APPROVED period
Correction        employee_id · source_period · target_period · source_ref · kind · amount (signed) · generation
                  UNIQUE (source_period, employee_id, source_ref, generation)

AlertRule         (settings) kind · enabled · recipients · channels [WHATSAPP|EMAIL|IN_APP] · delay/lead · master switch
StaffColumns      (settings) allowed codes: date, time, service, customer_name, list_price, discount, net, share,
                  estimated_commission, tip, rating_average, rating_comments
```

A customer's phone is never an allowed column, never in an export, and never in a log or an import error beyond its
last 3 digits (CLAUDE.md §8).

---

## 5. The commission engine (S9) — the precise definition

One pure function, no database: `computePeriod(lines, sales, versions, overrides, salaryOnLastDay) →
{ perSource: Map<source_ref, bigint>, total }` for **one employee and one calendar period**.

**Dates are business dates.** Periods, `effective_from` and every date comparison use the **business's timezone**
(D-10); each line and sale reaches the engine with its `business_date` already resolved, so the engine compares dates,
never instants. Fixtures cover a line at 21:30 UTC that is the next day in Kuwait.

**Missing configuration is never zero (D-57).** Any input — a `FOLLOW_PLAN` line **or a package sale** — with no
applicable plan version, or a salary-multiple plan with no salary on the last day, makes `computePeriod` return a
named error (`NO_PLAN`, `NO_SALARY`) for that employee. An existing version whose `package_sale` is disabled is not
missing: it pays 0. On a NO_PLAN or NO_SALARY: recording continues, the estimate says "no plan", and the statement
cannot be reviewed or approved until it is fixed.

### 5.1 Order

Lines are ordered by `occurred_at`, then `recorded_at`, then `line_id`. A late line takes its place by `occurred_at`
and the period is recomputed; earlier **estimates** may change until approval (D-49). A package sale belongs to the
period of its `sold_at`.

### 5.2 A line's value and the rule that prices it

- The employee's **share**: `net × share_bps / 10000`, floored to mills; remainder mills go one each to the performers
  in ascending `employee_id` order, so shares sum to `net`. A package line's `net` is its slot's `unit_value`.
- The **rule**, first match wins: the employee's `ServiceOverride` that applies at `occurred_at` (among those with
  `effective_from ≤ occurred_at`, the latest by `created_at`, then by `id`), else the line's `rule_snapshot`. `FOLLOW_PLAN` uses the plan;
  `ZERO` pays nothing; `PCT` pays `share × bps / 10000`; `FIXED` pays `a × share_bps / 10000` — instead of the plan,
  base and tiers alike, for that line only. An absent override is not `ZERO`. **Every** rule path — plan, `PCT`,
  `FIXED`, `ZERO` — ends in exactly one `roundKwd` per line, so a half mill rounds the same way everywhere.

### 5.3 Accumulators

- **AMOUNT**: the running sum of the employee's shares of `counts = true` lines before this line.
- **SESSIONS**: the running count of `counts = true` lines she performed before this line; a shared line counts one for
  each performer (D-50).
- `counts = false` lines never advance an accumulator; they are priced at the tier active at their position.
- Accumulators run across the whole period and across plan versions.

### 5.4 The plan version that prices a line or a sale

A version **applies** to a line if its `effective_from ≤ occurred_at`, or if it is `whole_period` for the line's period.
Among the versions that apply, the latest by `created_at`, then by `version`, prices the line. So a `whole_period` version
created on the 20th reprices the 10th, and a later ordinary version still wins from its own date. Base and tiers each
have `enabled` and can be switched at any time; a switch is a new version (D-50).

### 5.5 Pricing a `FOLLOW_PLAN` line

`amount = base part + tier part`, exact rationals, then **one** `roundKwd` half away from zero per line (ADR-0005).

- **Base** (if enabled): `PCT` → `share × bps / 10000`; `FIXED` → `a × share_bps / 10000`.
- **Tiers** (if enabled). `SALARY_MULTIPLE k` resolves to `k × salary on the period's last day` — the entry with the latest
  `effective_from` on or before that day (one entry per date, §4). The active step at
  accumulator value `x` is the last step with `from ≤ x`; below the first step no tier pays.
  - **MARGINAL:** a `counts = true` line that crosses one or more boundaries between `x` and `x + share` (AMOUNT only)
    is **split** at each boundary **only if every step it touches is `PCT`** — a step is _touched_ only by a part of
    positive length, the line covering the half-open interval `[x, x + share)`, so a step starting exactly at
    `x + share` is not touched; a `counts = false` line never crosses
    anything and is priced whole at the step active at `x`; each part pays its step's rate. Otherwise — any `FIXED`
    step touched, or a SESSIONS accumulator — the whole line is priced by the step active at `x`, **before** it; the
    next line gets the new step (D-50).
  - **WHOLE:** compute the period's final accumulator `X`; the reached step is the last with `from ≤ X`; every
    `FOLLOW_PLAN` line pays that step's calc (`PCT` on its share, `FIXED` × `share_bps / 10000`). The estimate jumps
    when a step is reached.
- Steps replace one another; the base always adds (D-50 supersedes D-35's stage-level `ADD`). The owner's example —
  MARGINAL/AMOUNT, one step from 500.000 at 5 %, base off — pays 25.000 on 1,000.000 (C7).

### 5.6 Package sales

With `package_sale` enabled in the version that applies at `sold_at`, the **seller** earns: `PCT` → `(price_paid −
refunded) × bps / 10000`; `FIXED` → `a × (price_paid − refunded) / price_paid` (zero when `price_paid = 0` or fully
refunded); one `roundKwd` per sale. Package sales never advance accumulators (D-51).

### 5.7 Allowed combinations — validated in the API and the plan builder alike

| accumulator | step `from` (one kind per plan)                             | calc per step                             | modes           |
| ----------- | ----------------------------------------------------------- | ----------------------------------------- | --------------- |
| AMOUNT      | literal mills, **or** SALARY_MULTIPLE k (k > 0, 2 decimals) | PCT (0–10000 bps) or FIXED (≥ 0), mixable | MARGINAL, WHOLE |
| SESSIONS    | integer n ≥ 0                                               | PCT or FIXED, mixable                     | MARGINAL, WHOLE |

Steps strictly ascending; at least one when tiers are enabled. Anything else is rejected with a named error. A case the
table cannot express stops the work: a new calc or `from` kind by decision, never an `if` (CLAUDE.md §11).

### 5.8 Fixtures that must exist before PR 30 closes

Expected outputs **calculated by hand, independently of the code**, one micro-fixture per row: every §5.7 row ×
MARGINAL/WHOLE × base on/off × tiers on/off; crossings of PCT→PCT, PCT→FIXED, FIXED→PCT; `x = from` exactly; ties;
permutation invariance; late insertion; overrides `ZERO`/`PCT`/`FIXED`/absent on a 50 % share; `counts = false`;
2- and 3-way splits with remainder; salary multiple; mid-period and `whole_period` versions; package unit values; a
package sale with a partial refund; tiny amounts; Σ shares = net; plus one fixture per real plan from D-55.

---

## 6. Consistency — events, estimate, review, approval, corrections

- **Events carry state.** Consumers keep an event only if its `revision` is newer, and dedupe by `event_id`, so
  duplicates, reordering and replay converge.
- **The estimate is computed on read** — the engine over the DRAFT projection; never stored, so it cannot drift.
- **Closed means APPROVED or PAID.** Every rule below that speaks of an approved period applies to a PAID one too;
  payment never stops corrections, and the frozen statement is never changed.
- **The consumer is atomic.** For one event, the projection update, the generation increment, the corrections and
  the `consumed_events` mark commit in **one** transaction under the statement lock; a crash anywhere in between rolls
  all of it back and the redelivered event does it again. A test kills the transaction between the projection write
  and the correction insert.
- **Every writer of a period's inputs serializes with approval.** The commissions consumer, and every writer of plan
  versions and overrides, locks the statement row of the period it affects and rechecks its status under that lock.
  Salary reaches commissions only through `SalaryChanged` — the consumer applies it under the same locks. A salary
  may be set for any date, audited; one reaching an open period changes its fingerprint (review again), one reaching
  a closed period becomes a correction, never a silent change. That is also how a missing salary is filled. `staff`
  needs no knowledge of statement status.
  Plan versions and overrides take `effective_from ≥ today`, or `whole_period` only for a DRAFT period. A period can
  be approved **only after it has ended** (its last day is over in the business timezone). Service rules are snapshots on each line.
- **Review is bound to the inputs.** Any input change to a period recomputes its fingerprint; a REVIEWED statement
  whose fingerprint changed returns to DRAFT and must be reviewed again; the owner can approve only a statement whose
  current fingerprint equals `reviewed_fingerprint`.
- **Approval is atomic.** Only for an ended period. One transaction: lock the statement; refuse while the period has lines without a performer;
  refuse (409, retry) while this company's commission-relevant outbox events created before the approval began are
  unprocessed — read through one `SECURITY DEFINER` count function, the only outbox read `pospay_app` gets (§9);
  freeze every `StatementLine` and the fingerprint. An event is therefore applied either before approval (in the
  frozen result) or after (a correction).
- **Corrections.** When the consumer applies a change to an APPROVED period — a cancellation, a refund, a performer
  change, or a late line whose `occurred_at` falls in it — it increments that period's `generation`, recomputes the
  period with its current inputs, and for every `source_ref` posts `delta = new − (frozen + corrections already
posted)` when non-zero, keyed `(source_period, employee, source_ref, generation)`. Every affected line is covered,
  including lines whose tier moved; a performer change moves money as two corrections; a replayed event is deduped
  before it can bump the generation. The target is the **earliest DRAFT period after the source**, created if absent. Lock order is always ascending
  period: the source statement, then the target, which is rechecked under its lock; if it closed meanwhile, the next
  DRAFT is chosen and locked. Posted corrections are inputs of the target: they enter its fingerprint and its frozen
  `StatementLine`s at approval.
- **A closed period that cannot be recomputed.** When the consumer applies a change to a closed period and the
  engine returns `NO_PLAN`/`NO_SALARY` (e.g. a late session for an employee before her first plan), it still marks the
  event consumed — the outbox never stalls — and records a **blocked correction** (visible exception). The manager
  resolves it by an audited **period repair**: a plan version scoped to that closed period only (a missing salary
  is simply set for its date), allowed
  only while a blocked correction exists; the recompute then posts the correction normally. A target period with an
  unresolved blocked correction for an employee cannot be approved.
- **Statement flow:** DRAFT → REVIEWED (manager, `review:commissions:business`) → APPROVED (owner,
  `approve:commissions:business`, audited) → PAID (`pay:commissions:business`, method and time). Reminders to the owner
  on the 3rd and 5th of the next month, not locks (D-54). Tips are inputs like lines: `SessionTipsChanged` feeds the
  projection, tips enter the fingerprint, card and cash tips are frozen per employee at approval (`TIP_CARD`,
  `TIP_CASH`), and a tip changed for a closed period becomes a correction of kind TIP. Card tips are paid with
  payroll; cash tips are informational (D-36).

---

## 7. Attendance

- **Binding by passkey (D-40, amended).** After OTP login the staff app registers a **passkey** (WebAuthn, user
  verification required — the phone's fingerprint, face or lock code); the server keeps its public key in
  `EmployeePasskey`. A clock request must sign a fresh server challenge with that registered passkey, so nobody can
  clock for her without her own authenticator and its unlock. What it does **not** prove is a physical phone: a synced
  passkey (iPhone, Android) also works on her other signed-in devices. Physical presence rests on the rotating QR and
  the geofence. The first enrolment is automatic when the employee has no active binding; a new phone needs the
  manager to unbind the old one, audited. The web cannot prove that one phone holds only one employee's passkey, so
  the anomaly report flags two employees clocking from the same device fingerprint within minutes — a flag for the
  manager, not a block.
- **QR** (P1-T5.1): HMAC over branch, 60-second window and a daily secret; current and previous window accepted;
  another branch's token rejected.
- **State machine (D-53):** a scan with no open session opens one; with an open session **younger than 16 h** closes
  it; with one **16 h or older** closes it as `MISSED_OUT` and opens a new one. Every scan and the missed-out job first lock the
  employee's `AttendanceState` row — a row that always exists — so first scans, dedupe and the 16 h boundary are all
  serialized; a partial unique index allows one open session per employee. A scan within 5 minutes of the employee's last accepted scan
  returns that result unchanged. `working_date` = clock-in date in the branch timezone; overnight shifts belong to it.
- **Missed clock-out:** at the scheduled shift end + 4 h (or clock-in + 12 h with no schedule) a job raises a
  `SUSPECTED_MISSED_OUT` exception; a later scan before 16 h still closes the session normally and resolves the
  exception as "closed late" (kept for the manager to see); at 16 h it becomes `MISSED_OUT`. Never hours, never a
  deduction (D-32).
- **Geofence 150 m** (D-12): out of range → recorded with an `OUT_OF_RANGE` exception; no location → a `NONE` exception for QR / phone clocking. A card movement raises no exception (spec 034 RE-Q4); the session still records `geo` / `out_geo` = `NONE`.
- **Barcode card:** scanned by the paired reception device (Phase 0 device scheme), permission
  `clock:attendance:device`; the device and the operator are recorded.
- **Lateness:** grace 10 minutes, reported only. Attendance never touches commission.
- **Correcting a closed session** (spec 035): a holder of `correct:attendance:branch` changes clock-in and/or clock-out of a CLOSED or MISSED_OUT session, with a reason. Each changed field keeps its previous value in append-only `AttendanceCorrection`, plus one audit entry. `revision` increases on that write and on every scan, card and missed-out close. A correction cannot move the clock-in working date, cannot overlap another session of the employee, and does not change commission, exceptions or scan facts. Only the owner may correct their own attendance.

---

## 8. Packages

- **Valuation at sale (D-42),** a pure function in `orders/domain`: the price paid is allocated to components in
  proportion to `list_price_snapshot × sessions` (if that total is zero, in proportion to sessions), by largest
  remainder with ties by `service_id`; within a component, ordinal _k_ of _n_ is worth `floor(value / n)` and ordinal
  _n_ also takes the remainder. `price_paid = 0` makes every slot zero. Slots are created at sale; `commissions` gets
  the values in events.
- **Retries.** Sale and redemption require an `Idempotency-Key` (CLAUDE.md §6); a retry returns the original result
  and never creates a second entitlement or consumes a second slot.
- **Redeem:** one transaction, row lock on the component: take the lowest `FREE` ordinal, mark it `USED`, write the
  line and the redemption. Refused when no slot is free or today > `expires_on` (end of that day, branch timezone).
- **Cancel a redeemed line:** reverse the redemption **once** — only if that redemption is not already reversed and
  its slot is still `USED` by it — then the slot returns to `FREE` and the line is re-emitted CANCELLED. A stale
  retry reverses nothing.
- **Extend** (manager, audited) moves `expires_on`.
- **Refund** (manager, idempotency key): locks the **entitlement** row, then the component; the manager picks the component and a positive integer number of sessions, refunded exactly or not at all (`INSUFFICIENT_SLOTS`); the
  highest `FREE` ordinals are marked `REFUNDED`, recorded on the refund with the sum of their values as its amount;
  refunded slots can never be redeemed. The entitlement's cumulative `refunded_amount` and its `revision` change in
  the same transaction, and the committed snapshot is what `PackageSaleChanged` carries — two refunds of different
  components serialize on the entitlement and never overwrite each other. No refund after expiry unless extended first
  (D-51).
- **Sale:** reception names the seller and records paid-in-full and the method; `sold_at` is the sale time.
- **Import (D-51):** original price, original sessions per service, remaining sessions, expiry, customer phone,
  `external_ref` unique per company (re-import is a no-op). Slots are valued over the original sessions; ordinals
  `1 … used` become `IMPORTED_USED`, the rest `FREE`. Imported packages have no seller and no sale commission.

---

## 9. Governing amendments this phase needs — each its own PR before its slice

1. **ADR-0010 + `module-map.md` §3/§4:** every port and event in §3; `ServiceCompleted` → `ServiceLineChanged`.
2. **ADR-0011 + `CLAUDE.md` §5:** the public rating link as the fourth session-less entry point — token
   `<company_id>.<256-bit random>`, hash stored, tenant resolved from it, then `withTenant`; 7-day expiry; single use
   by an atomic `UPDATE … WHERE consumed_at IS NULL`; the same token can opt out until expiry; per-IP rate limit; the
   page shows only the business name and the stars form. Tests: tampered, replayed, expired, cross-tenant.
3. **ADR-0012:** the `SECURITY DEFINER` pending-outbox count for approval (§6), grants and tests.
4. **ADR-0013:** the Better Auth `passkey` plugin (a new plugin and its WebAuthn dependency, CLAUDE.md §11) and the
   platform-level WhatsApp suppression table (§10) — global, keyed by phone for our one sender number.
5. **ADR-0014: the email provider**, before the email channel.

---

## 10. Ratings (D-41, D-52)

- One request per customer per business per day. The day and the closing time come from the **branch of her last
  session that day**, in its timezone. `due_at` = the earlier of that session + 1 hour and the branch's closing time (D-58: a
  19:30 visit with an 20:00 close is asked at 20:00); each new session that day moves it; `send_deadline` = closing
  time **+ 30 minutes**, so a request due at closing still has a real window to be claimed and dispatched. Past the
  deadline the request is CANCELLED (`PAST_DEADLINE`), never sent the next day. No deadline when
  opening hours are unset.
- **The claim is the authoritative boundary.** At claim time the job reads the day's active lines and performers
  through `DaySessionsPort` (synchronous, from `orders`), not from its own projection: it reschedules if a newer
  session moved `due_at`, cancels (`NO_ACTIVE_LINE`) if no active line remains, and snapshots the performers from that
  read. **Attribution is fixed at the claim:** a cancellation after the claim does not remove a performer (D-52
  amended), and a session after it is not rated.
- **Transitions:** SCHEDULED → SENDING → SENT; SCHEDULED → CANCELLED. A `NO_ACTIVE_LINE` cancellation is reopened to
  SCHEDULED by a new active session that day before the deadline; `PAST_DEADLINE` and `OPTED_OUT` are terminal, and so
  are SENDING and SENT.
- **The deadline holds at the send, not only at the claim:** `RatingRequestReady` carries `send_deadline`, and
  `notifications` refuses to call the provider after it (attempt row `EXPIRED`).
- **Sending is at most once, end to end.** The job claims a due request with `FOR UPDATE SKIP LOCKED`, rechecks her
  opt-out and that an active line remains, snapshots the performers, sets `SENDING`, and emits `RatingRequestReady`.
  `notifications` commits a delivery-attempt row **before** calling the provider; an event whose attempt row already
  exists (a redelivery after a crash) is not sent again. A lost rating is acceptable, a duplicate message is not. A session
  recorded after the send is not rated.
- **Attribution:** every performer in the snapshot gets the stars; her average is the mean of the ratings attributed
  to her. ≤ 2 stars → `LowRatingReceived` if the alert is on. Ratings never change commission.
- **Opt-out, and its exact guarantee.** On the rating page it sets `opted_out_at` at once; every later claim checks it.
  A WhatsApp "stop" reply lands in the platform-level suppression (ADR-0013) at once and blocks every message to that
  phone from our sender, which is WhatsApp's own rule, so no tenant needs to be resolved. `notifications` checks
  suppression and commits the delivery-attempt row in one transaction under a lock on the phone's hash, which the
  "stop" handler takes too. **The stated window:** a "stop" blocks every attempt not yet authorized when it commits;
  a page opt-out blocks every request not yet claimed — so at most one request **per business** already claimed that
  day may still be delivered after it.

---

## 11. Behaviour tests (numbered)

**Attendance** A1 a clock without a valid passkey signature is rejected, with a message to use the card or ask the
manager · A2 one active binding per employee; rebind only by the manager, audited; the two-employees-one-device flag ·
A3 QR windows and branch · A4 geofence exceptions · A5 lateness reported, never deducted · A6 state machine: 16 h
(both orders at exactly 16 h), two concurrent first scans → one session, 5 minutes, overnight working date; suspected missed-out resolved as closed late; missed-out at 16 h · A7 attendance
never changes commission · A8 barcode by the paired device only.

**Sessions** M1 price override and discount record actor and time · M2 above the limit the line is refused unless an
APPROVED, unexpired proposal with exactly matching terms is **consumed in the same transaction** as the line write
(compare-and-set); two concurrent submissions with one approval: one wins; changed terms, replay and cross-branch use
fail · M3 late entry until approval, flagged; after approval → correction · M4 Codex's example: lines 600 then 400, 5 %
above 500, approved (B = 20.000); cancelling A posts −20.000 to B; then a late 600 before B posts +20.000 in a new
generation · M5 two concurrent redemptions of the last slot: one wins · M6 refund vs redemption race; a duplicate
refund is a no-op; the refund's component, ordinals and amount are recorded · M7 expired entitlements redeem nothing;
refund after expiry refused · M8 cancelling a redemption frees its ordinal; the next redemption takes the lowest free · M9 two refunds of
different components of one package: both amounts in the final snapshot · M10 a lost response retried with the same
key: no second sale, no second slot, no second reversal · M11 invalid package types, sales and imports rejected by
name · M12 performer and share changes, before and after approval · M13 effective discount = (list − net) / list, 0 % at list 0; redemptions never count; a package's discount on its
sale line · M14 refund of more slots than are free → INSUFFICIENT_SLOTS, nothing refunded.

**Commissions** §5.8 fixtures · business-date boundary · `NO_PLAN` / `NO_SALARY` block review (incl. a package-only
seller) · a salary committing after approval → correction · two salaries on one date → the second replaces the first ·
salary events delivered out of order converge · a late NO_PLAN line in a closed period → blocked
correction, repaired by a period-scoped version · a change to a PAID
period posts a correction · a target that closes mid-post moves to the next DRAFT · a tip written during approval
lands frozen or as a TIP correction · override half-mill rounding · the FIXED endpoint case
(0→5 %, 50→10 %, 100→FIXED 2, x = 40, share 60 → 5.500) · a crash between projection write and correction insert leaves neither · approval of
a period that has not ended is refused · the estimate equals the engine on the DRAFT projection · approval racing a session, a
redemption, a refund, a plan version and an override: each lands in the frozen result or in a correction · a plan
write racing approval sees APPROVED and is refused · an input change after REVIEWED returns the statement to DRAFT ·
duplicate, reordered and replayed events converge · corrections land in the earliest DRAFT period · only the owner
approves; PAID records the method · card tips column · reminders on the 3rd and 5th.

**Customers & ratings** R1 phone shown only on the entry form; masked elsewhere; absent from exports, logs and import
errors · R2 due time moves with new sessions, from the last session's branch, capped by its closing time · R3 a request
crashed in SENDING is not resent; a notifications redelivery with an attempt row is not resent; two workers send once · R4 attribution to every performer in the claim snapshot; a
cancellation before the claim removes her, one after it does not · R5 token tampering, replay, expiry, cross-tenant rejected · R6 a "stop" committed between the suppression check and the attempt is impossible (both under the phone lock) ·
R7 claim after the send deadline → CANCELLED; an event delivered to notifications after the deadline → EXPIRED, not
sent · R2b a 19:30 visit, 20:00 close → due 20:00, sent within the grace with the clock advancing through claim and
dispatch · R10 a NO_ACTIVE_LINE request reopened by an afternoon session · R8 a cancellation not yet seen by the projection still blocks the
send (authoritative read) · R9 two businesses, one customer: the per-business bound.

**Visibility** V1 staff see only their own rows and the manager's columns · V2 reception like any employee plus the
entry screen · V3 salaries owner-only unless granted · V4 documents only through `files` with the stored permission,
each open audited.

---

## 12. Acceptance criteria

- [ ] §1's criterion holds for the parallel month.
- [ ] Every new tenant table has RLS and a negative isolation test; the rating link reaches only its own tenant's row.
- [ ] §5.8's fixtures and §11's tests pass; each is listed in the PR that ships it.
- [ ] No customer phone and no salary in any log line; the redaction list is extended.
- [ ] Every alert can be switched off alone and all at once.
- [ ] An import with any invalid row saves nothing.
- [ ] `pnpm check` green on `main`; staging runs the phase.

---

## 13. Open items

1. ~~**The salon's real plan rules** (D-55)~~ — supplied 2026-10-05 (hair) and 2026-10-07 (all four specialists, PRD D-55); fixtures in PR 30 and #124.
2. **Client data** before the pilot: services and prices, staff and their plans, shifts, branches, open packages,
   contact person, meeting day.
3. The §9 ADRs, each before its slice.

## PR 6 amendment — ADR-0019, 2026-10-02

PR 6 remains dependent on PRs 3/4/5 and implements existing global users on a paired POS, with active device-scoped membership plus explicit login:staff:branch. Staff/cashier bundles are explicit; Owner/admin authority alone is insufficient. OTP defaults disabled and incomplete activation closes only its capability; production API/worker stay ready with empty notification settings. Auth-owned deterministic derivation uses independent verification MACs, a hash-only global ledger, acknowledged PREPARED→PENDING release, bounded worker wait outside DB connections, at-most-once execution and shared Redis admission. All admitted outcomes share the 200 ms 202 window. Sessions use Better Auth with isolated staff cookie and original eight-hour deadline, without idle timeout or renewal, and are revalidated online on every request. Recovery uses the employee's own PIN with manager assistance; no impersonation or STOP bypass. Login does not open a shift or record attendance.

The slice includes contracts/schema and exact grants, auth facade/guards, both composition roots, POS generated client/i18n/cache clearing, secret-free observability, environment/deploy injection and independent readiness smoke. ADR-0019 §7 is the complete test obligation. Before PR 20, resolve personal-phone/passkey enrollment and use the scoped staff verification contract; never auto-enroll the shared kiosk. PR 22 still requires per-clock UV, QR and presence proof. Final bilingual Meta copy/names/components and recovery copy remain TODO(spec), blocking live activation until approved.

PR 20 amendment — ADR-0013 §§7–9 and ADR-0027 (owner 2026-10-04): global `passkey`
credential/public-key/counter material is auth-only. EmployeePasskey holds the tenant binding
and history. Enrollment requires the employee's limited personal-phone OTP session, never a
paired kiosk session. That purpose grants no POS/admin/business permissions; explicit own-scope
routes recheck the live employee and membership. Owner decision 2026-10-04 (recommended option): personal sessions have a fixed eight-hour absolute lifetime, without sliding renewal or idle timeout, matching ADR-0019 kiosk sessions.
