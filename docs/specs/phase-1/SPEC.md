# Phase 1 — Salon Pilot Spec: staff, attendance, sessions, packages, commissions

> **Status:** Draft v2 · 2026-10-01 · from the onboarding interview with Waleed (2026-09-30 → 2026-10-01) and Codex's
> round-1 review (30 findings). Decisions: `docs/PRD.md` §12 — D-12…D-17, D-28, D-30, D-32 (decided) and D-35…D-55.
> **Governing docs:** `CLAUDE.md` · `CLAUDE.architecture.md` · `docs/06_Tech_Stack_Architecture_EN.md` · `docs/module-map.md`.
> On conflict those documents win; where this spec needs them changed, §9 names the amendment and its ADR.
> **Supersedes** the Phase 1 task list in `docs/PRD.md` §10 where the two differ.

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

The parallel month is the business oracle (D-45). Before it, correctness rests on §5's precise engine definition and
its expected-output fixtures (S9), built from the salon's **real plan rules**, requested now (D-55) — the rules, not a
worked month.

---

## 2. Scope

### In

| Area | What ships |
|---|---|
| Apps | `apps/admin` (Next.js) and `apps/pos` (Vite PWA: attendance screen + staff app) — shells, then one screen per slice |
| `packages/ui` | shadcn RTL kit, tokens, Arabic fonts, lucide |
| `staff` | employees, salary history (restricted), branches, phone binding, barcode card, schedules, leave, attendance, documents metadata |
| `files` (minimal) | private R2 objects, presigned upload/download, access audit |
| `catalog` (minimal) | services (price, commission rule, threshold flag), package types |
| `customers` (minimal, from P2) | company-scoped customers (D-30), opt-out, ratings |
| `orders` (minimal) | service sessions: lines, price override, discount + approval, split performers, tips, late entry, cancel; package sale, redemption, expiry, extension, refund |
| `identity` (addition) | discount-limit permission, discount approval (PIN on device or remote request) |
| `commissions` | per-employee plan versions (base + tiers, independently switchable), service overrides, live estimate, statement DRAFT → REVIEWED → APPROVED → PAID, corrections, Excel export |
| `notifications` (minimal) | WhatsApp + email channels, templates ar/en, suppression list, delivery log |
| `settings` (addition) | alert rules, staff-app columns, default discount limit |
| Import | Excel template, preview, all-or-nothing commit: employees, services, customers, open packages |

### Out

- POS sell screen, payments, cash shifts, printing (Phase 2). Sessions are recorded on an admin/reception screen.
- The service **barcode** flow (D-15 → Phase 2, same data model).
- Package instalments and sharing (D-42). Ratings affecting commission (D-41). Overtime pay and lateness deductions.
- Realtime/SSE — screens poll (PRD Phase 1 exception, closed by P2-T8). Product sales (Phase 2).

---

## 3. Modules and their contracts

| Module | New / extended | Owns |
|---|---|---|
| `staff` | new | employees, salary history, schedules, leave, attendance, phone bindings, cards, document metadata |
| `files` | new | private objects, their required read permission, access audit |
| `catalog` | new | services, package types |
| `customers` | new | customers (company-scoped), opt-out preference, rating requests, ratings |
| `orders` | new | sessions, lines, performers, tips, discount proposals, package entitlements, redemptions, refunds |
| `commissions` | new | plan versions, service overrides, line projection, statements, frozen results, corrections |
| `notifications` | new | channels, templates, suppression list, delivery log |
| `identity` · `settings` | extended | discount approval · alert rules, staff columns |

Every cross-module interaction, with its kind (import arrows are already in `module-map.md` §2 unless marked **new**):

| From → to | Kind | Contract |
|---|---|---|
| `orders` → `catalog` | port (existing) | `CatalogReaderPort`: service price, names, commission rule, threshold flag; package-type components |
| `orders` → `customers` | port **new** | `CustomerLookupPort.exists(customerId)` — reception creates or finds the customer first through `customers`' own endpoint; `orders` only checks the id |
| `orders` → `staff` | port **new** | `PerformerCheckPort`: employee active and attached to the branch on the date |
| `commissions` → `staff` | port **new** | `EmployeeSalaryPort` (salary effective on a date), `EmployeeDirectoryPort` (names for statements) |
| `customers` → `staff` | port **new** | `PerformerNamePort` (first name in the rating message) |
| `staff`, `customers`, `commissions` → `settings` | port **new** | `AlertRulesPort`, `StaffColumnsPort` (reads) |
| `orders` ⇒ `commissions`, `customers` | event **new** | `ServiceLineChanged` — full line snapshot + `revision` (§6) |
| `orders` ⇒ `commissions` | event **new** | `PackageSaleChanged` — seller, price paid, refunded amount, `revision` |
| `customers` ⇒ `notifications` | event **new** | `RatingRequestReady`, `LowRatingReceived`, `CustomerOptedOut` |
| `notifications` ⇒ `customers` | event **new** | `MessagingOptOutReceived` (a WhatsApp "stop" reply, via the existing messaging-callback entry point) |
| `staff` ⇒ `notifications` | event **new** | `AttendanceExceptionRaised`, `ShiftNotClockedIn`, `DocumentExpiring` |
| `commissions` ⇒ `notifications` | event **new** | `StatementAwaitingReview`, `StatementAwaitingApproval` |
| `files` | none | the admin UI uploads and opens documents through `files`' own endpoints; `staff` stores only the object key |
| OTP | wiring | `packages/auth` takes an injected `OtpSender`; `apps/api`'s composition root binds it to `notifications`' WhatsApp channel — no module arrow |

Emitting modules read `AlertRulesPort` and put recipients and channels in the event, so `notifications` stays free of
business knowledge (`module-map.md` §2). `ServiceCompleted` in the map is replaced in Phase 1 by `ServiceLineChanged`;
ADR-0008 records every row above and the §9 amendments.

---

## 4. Domain model — Phase 1 subset

Phase 0 conventions hold: tenant PK `(company_id, id)`, UUID v7, FORCE RLS, money `numeric(14,3)` / `bigint` mills,
`timestamptz` UTC, financial rows immutable with reversals.

```
Employee          business_id · primary_branch_id · user_id? · names · role_code · hire_date · contract_end? · deleted_at?
EmployeeSalary    employee_id · amount (mills) · effective_from (date) · set_by        — history; restricted read
EmployeeBranch    employee_id · branch_id · from · to?
EmployeeDevice    employee_id · credential_hash · bound_at · bound_by · unbound_at? · unbound_by?
                  one active row per employee; the credential proves the phone (§7)
EmployeeCard      employee_id · card_code · issued_at · revoked_at?
Schedule          employee_id · branch_id · week_start · shifts [{day, start, end}]      ShiftTemplate
LeaveRequest      employee_id · from · to · type · status · decided_by?
AttendanceSession employee_id · branch_id · clock_in · clock_out? · source (QR|BARCODE) · geo (OK|OUT_OF_RANGE|NONE)
                  working_date · closed_by (EMPLOYEE|MISSED_OUT)
AttendanceException session_id · kind · status (OPEN|RESOLVED) · resolved_by? · reason?
AttendanceCorrection session_id · field · before · after · reason · by · at
EmployeeDocument  employee_id · type_code · object_key · expires_on? · uploaded_by       DocumentType (editable, alert_days)

Service           names · price · commission_rule (FOLLOW_PLAN | ZERO | PCT bps | FIXED mills) · counts_toward_threshold
PackageType       names · price · validity_days · components [{service_id, sessions}]

Customer          company_id · name · phone (E.164, unique per company) · locale · opted_out_at?        (D-30)
RatingRequest     business_id · customer_id · business_date · due_at · status (SCHEDULED|SENT|CANCELLED)
                  performer_ids (snapshot at send) · token_hash · expires_at · consumed_at?
                  UNIQUE (company_id, business_id, customer_id, business_date)
Rating            request_id · stars 1..5 · comment? · submitted_at

ServiceSession    business_id · branch_id · customer_id · recorded_by · occurred_at · recorded_at · late (bool)
ServiceLine       session_id · service_id · revision · status (ACTIVE|CANCELLED)
                  list_price · price · discount · net (= price − discount)
                  rule_snapshot · counts_snapshot                — service values frozen at recording (§5.2)
                  entitlement_component_id?                      — a package redemption line (§8)
LinePerformer     line_id · employee_id · share_bps (Σ = 10000)
Tip               session_id · employee_id · amount · method (CASH|CARD)
DiscountProposal  terms_hash · terms (branch, customer, service, price, discount, performers) · requested_by
                  status (PENDING|APPROVED|REJECTED|EXPIRED|CONSUMED) · approver? · via (PIN|REMOTE)? · expires_at
PackageEntitlement business_id · customer_id · package_type_id · provenance (SOLD|IMPORTED) · external_ref?
                  sold_line_id? · seller_employee_id? · price_paid · paid_method? · expires_on · revision
PackageComponent  entitlement_id · service_id · list_price_snapshot · sessions_total · sessions_used
                  sessions_refunded · component_value (mills)
PackageRedemption component_id · ordinal · unit_value · line_id · reversed_by?          (immutable)
PackageRefund     entitlement_id · sessions · amount · approved_by · idempotency_key

PlanVersion       employee_id · version · effective_from (date) · whole_period (bool) · created_by
                  base   { enabled, calc: PCT bps | FIXED mills }
                  tiers  { enabled, accumulator: AMOUNT | SESSIONS, mode: MARGINAL | WHOLE,
                           steps: [{ from: AMOUNT mills | SALARY_MULTIPLE k | SESSIONS n, calc: PCT | FIXED }] }
                  package_sale { enabled, calc: PCT | FIXED }
ServiceOverride   employee_id · service_id · rule (FOLLOW_PLAN | ZERO | PCT | FIXED) · effective_from
CommissionLine    (projection) line_id · revision · employee_id · occurred_at · recorded_at · net_share
                  share_bps · rule_snapshot · counts · status
Statement         business_id · period (YYYY-MM) · status (DRAFT|REVIEWED|APPROVED|PAID) · reviewed_by? · approved_by?
                  approved_at? · paid_at? · paid_method? · input_fingerprint?
StatementLine     statement_id · employee_id · line_id? · amount · kind (SERVICE|PACKAGE_SALE|CORRECTION)  (frozen)
Correction        employee_id · source_period · target_period · line_id? · amount (signed) · basis_revision
                  UNIQUE (source_period, employee_id, line_id, basis_revision)

AlertRule         (settings) kind · enabled · recipients · channels [WHATSAPP|EMAIL|IN_APP] · delay/lead · master switch
StaffColumns      (settings) allowed codes: date, time, service, customer_name, list_price, discount, net, share,
                  estimated_commission, tip, rating_average, rating_comments
```

A customer's phone is never an allowed column, never in an export, and never in a log or an import error beyond its
last 3 digits (CLAUDE.md §8).

---

## 5. The commission engine (S9) — the precise definition

One pure function, no database: `computePeriod(lines, packageSales, versions, overrides, salaryOnLastDay) →
{ perLine: Map<lineId, bigint>, perSale: Map<saleId, bigint>, total }` for **one employee and one period**.

### 5.1 Order

Lines are ordered by `occurred_at`, then `recorded_at`, then `line_id`. This order decides accumulators and stage
changes. A late line takes its place by `occurred_at`, and the whole period is recomputed; earlier **estimates** may
change until approval (D-49).

### 5.2 What a line is worth and which rule prices it

- The employee's **share** of a line: `net × share_bps / 10000`, floored to mills; the remainder mills go one each to
  the performers in ascending `employee_id` order, so the shares always sum to `net`. A package line's `net` is its
  redemption's `unit_value` (§8).
- The **rule** for a line, first match wins: the employee's `ServiceOverride` effective at `occurred_at`, else the
  line's `rule_snapshot` (the service's rule when the line was recorded). `FOLLOW_PLAN` means "use the plan"; `ZERO`
  pays nothing; `PCT`/`FIXED` pay that value **instead of** the plan, base and tiers alike, for that line only.
  An absent override is not `ZERO`.

### 5.3 Accumulators

- **AMOUNT**: the running sum of the employee's shares of `counts = true` lines before this line.
- **SESSIONS**: the running count of `counts = true` lines she performed before this line — a shared line counts as
  one for each performer (D-50).
- `counts = false` lines never advance an accumulator; they are priced at the tier active at their position.
- Accumulators run across the whole period, across plan versions (a mid-period change never resets them).

### 5.4 The plan version that prices a line

The version with the latest `effective_from ≤ occurred_at`; a version marked `whole_period` applies from the period's
first day, and may be created only while the period's statement is DRAFT (D-38). Base and tiers each have `enabled`
and can be switched independently at any time; a switch is a new version (D-50).

### 5.5 Pricing a `FOLLOW_PLAN` line

`amount = base part + tier part`, computed as exact rationals, then **one** `roundKwd` half away from zero per line
(ADR-0005).

- **Base** (if enabled): `PCT` → `share × bps / 10000`; `FIXED` → `a × share_bps / 10000`.
- **Tiers** (if enabled). Steps are ascending by `from`; `SALARY_MULTIPLE k` resolves to `k × salary on the period's
  last day` (D-50). The active step at accumulator value `x` is the last step with `from ≤ x`; below the first step,
  no tier pays.
  - **MARGINAL, AMOUNT, PCT**: the share is split at every step boundary it crosses between `x` and `x + share`; each
    part pays its own step's rate — the part below a threshold keeps the old rate (D-50).
  - **MARGINAL, FIXED** (either accumulator): the line pays the step active at `x`, **before** it — the crossing line
    keeps the old step; the next line gets the new one.
  - **MARGINAL, SESSIONS, PCT**: the step active at the count before the line; the whole share at that rate.
  - **WHOLE**: first compute the period's final accumulator `X`; the reached step is the last step with `from ≤ X`;
    every `FOLLOW_PLAN` line pays that step's calc (`PCT` on its share, `FIXED` × `share_bps`). The staff app's
    estimate jumps when a step is reached (D-50).
- Steps replace one another; base always adds. The owner's example — tiers MARGINAL/AMOUNT, one step from 500.000 at
  5 %, base off — pays 25.000 on 1,000.000 (C7).

### 5.6 Package sales

If the version's `package_sale` is enabled, the **seller** earns its calc on `price_paid − refunded_amount`. Package
sales never advance the seller's accumulators (D-51); a refund lowers the base, so the recompute lowers the amount.

### 5.7 Allowed combinations — validated in the API and the plan builder alike

| accumulator | step `from` | calc | modes |
|---|---|---|---|
| AMOUNT | AMOUNT mills or SALARY_MULTIPLE k (k > 0, 2 decimals) | PCT (0–10000 bps) or FIXED (≥ 0) | MARGINAL, WHOLE |
| SESSIONS | SESSIONS n (integer ≥ 0) | PCT or FIXED | MARGINAL, WHOLE |

A plan mixes no accumulators. Steps are strictly ascending; at least one step when tiers are enabled. Anything else is
rejected with a named error. A case the table cannot express stops the work: it becomes a new calc or `from` kind by
decision, never an `if` (CLAUDE.md §11).

### 5.8 Tests that must exist (S9)

Every row of §5.7 × MARGINAL/WHOLE × base on/off × tiers on/off; exact boundaries (`x = from`, crossing, landing);
ties in order; permutation of input arrays gives the same result; late insertion before earlier lines; overrides
`ZERO`/`PCT`/`FIXED`/absent; `counts = false` lines; split of 2 and 3 performers with remainder; salary multiple;
mid-period version with continuous accumulators; `whole_period` version; package unit values; signed corrections;
tiny amounts and conservation (Σ shares = net). Fixtures from the salon's real plan rules (D-55) join as they arrive.

---

## 6. Consistency — events, estimate, period close, corrections

- **Events carry state, not deltas.** `ServiceLineChanged` carries the full line (status, net, performers and shares,
  rule and counts snapshots, occurred_at, recorded_at) and a per-line `revision` that increases on every change.
  Consumers store it only if its revision is newer, and dedupe by `event_id` (Phase 0 `consumed_events`), so
  duplicates, reordering and replay converge. `PackageSaleChanged` works the same way.
- **The estimate is computed on read**: the engine over the DRAFT period's projection, never stored — it cannot drift.
- **Statement flow:** DRAFT → REVIEWED (manager, `review:commissions:business`) → APPROVED (owner,
  `approve:commissions:business`, audited) → PAID (`pay:commissions:business`, method and time). Reminders to the owner
  on the 3rd and 5th of the next month; reminders, not locks (D-54).
- **Approval is atomic.** In one transaction: lock the statement row; refuse while the period has lines without a
  performer; refuse (409, retry) while commission-relevant outbox events of this company created before the approval
  began are unprocessed — read through one `SECURITY DEFINER` count function in `packages/db`, the only outbox read
  `pospay_app` gets (§9); freeze every `StatementLine` and the input fingerprint. The commissions consumer takes the
  same row lock, so an event is applied either before approval (and is in the frozen result) or after (and becomes a
  correction). Nothing is lost between the check and the freeze.
- **Corrections.** When a line, package sale or refund changes for an APPROVED period — including a late session whose
  `occurred_at` falls in it — the engine recomputes that period with its current inputs; for each line, `delta = new −
  (frozen + corrections already posted)`; non-zero deltas post to the next DRAFT period, unique on
  `(source_period, employee, line, basis_revision)`, so a replay posts nothing twice. A performer change moves money
  between two employees as two corrections. Salary and plan versions cannot be back-dated into an approved period.
- **Tips** are listed per employee in the statement, card tips in their own column for payroll; cash tips are
  informational. A shared session's tip splits like its commission (D-36).

---

## 7. Attendance

- **Phone binding (D-40).** After OTP login the staff app enrols: the server issues a random 256-bit credential, keeps
  its hash in `EmployeeDevice`, and the app keeps it in IndexedDB. A clock request needs the session **and** the
  credential. Enrolment is automatic when the employee has no active binding; otherwise only the manager can unbind,
  audited. A lost credential (new phone, cleared storage) needs the manager. A fingerprint alone proves nothing.
- **QR** (P1-T5.1): HMAC over branch, 60-second window and a daily secret; the current and previous window are
  accepted; another branch's token is rejected.
- **State machine (D-53):** a scan with no open session opens one; with an open session ≤ 16 h old closes it; with one
  older than 16 h closes it as `MISSED_OUT` (exception) and opens a new one. A scan within 5 minutes of the employee's
  last accepted scan returns that result unchanged. `working_date` = clock-in date in the branch timezone (D-10);
  overnight shifts belong to it.
- **Missed clock-out:** a job raises `MISSED_OUT` at the scheduled shift end + 4 h, or at clock-in + 16 h with no
  schedule. Never hours, never a deduction (D-32).
- **Geofence 150 m** (D-12): out of range → recorded with an `OUT_OF_RANGE` exception; no location → `NONE` exception.
- **Barcode card:** scanned by the paired reception device (Phase 0 device scheme), permission `clock:attendance:device`;
  the device and the operator are recorded.
- **Lateness:** grace 10 minutes, reported only (D-12). Attendance never touches commission.

---

## 8. Packages

- **Valuation at sale (D-42):** the price paid is allocated to components in proportion to `list_price_snapshot ×
  sessions`, largest remainder by component (ties by `service_id`); within a component, session *k* of *n* is worth
  `floor(value / n)`, and the last session also takes the remainder, so every redemption value is reproducible and
  the sum is exact. The allocation is a pure function in `orders/domain`; `commissions` receives the values in events.
- **Redeem** writes the line and the redemption in one transaction under a row lock on the component; it requires
  `sessions_used + sessions_refunded < sessions_total` and today ≤ `expires_on` (end of that day, branch timezone).
- **Cancelling a redeemed line** restores the session (a reversal row) and re-emits the line as CANCELLED.
- **Extend** (manager, audited) moves `expires_on`. **Refund** (manager, idempotency key, row lock) marks unused
  sessions refunded — they cannot be redeemed afterwards — for the value of those sessions; no refund after expiry
  unless extended first (D-51).
- **Sale:** reception names the **seller** and records that it was paid in full and how; no payment integration in
  Phase 1 (D-51).
- **Import (D-51):** original price, original sessions per service, remaining sessions, expiry, customer phone, and an
  `external_ref` unique per company (re-import is a no-op). Values use the same allocation over the original sessions;
  `sessions_used = original − remaining`, with no redemption rows. Imported packages have no seller and pay no sale
  commission.

---

## 9. Governing-document amendments this phase needs

Each lands in its own PR **before** the slice that needs it:

1. **ADR-0008 + `module-map.md` §3/§4:** every port and event in §3, and `ServiceCompleted` → `ServiceLineChanged`.
2. **ADR-0009 + `CLAUDE.md` §5:** the public rating link as the fourth session-less entry point: token
   `<company_id>.<256-bit random>`, hash stored, resolved to its tenant, then `withTenant`; expiry 7 days; single-use
   by an atomic `UPDATE … WHERE consumed_at IS NULL`; the same token may opt out (idempotent) until expiry; per-IP
   rate limit; the page shows only the business name and the stars form. Tests: tampered, replayed, expired and
   cross-tenant tokens.
3. **ADR-0010:** the `SECURITY DEFINER` pending-outbox count for period close (§6), its grants and tests.
4. **Email provider ADR** (S5): a new provider needs one (CLAUDE.md §11).

---

## 10. Ratings (D-41, D-52)

- One request per customer per business per day. `due_at` = her last non-cancelled session of the day + 1 hour;
  every new session that day moves it; it never passes the branch's closing time (opening hours; no cap when none are
  set). A worker claims due requests with `FOR UPDATE SKIP LOCKED` under the unique key, so two workers send once.
- At send: skip if she opted out or the request has no active line left; snapshot the performers; emit
  `RatingRequestReady`. A session recorded after the send is not rated.
- Every performer in the snapshot gets the stars; her average = mean of the ratings attributed to her. ≤ 2 stars →
  `LowRatingReceived` if the alert is on. Ratings never change commission.
- Opt-out: the page's opt-out or a WhatsApp "stop" reply; `notifications` suppresses the number immediately, and a
  queued message is re-checked at send time.

---

## 11. Behaviour tests (numbered)

**Attendance** A1 a clock without the bound credential is rejected, with a message to use the card or ask the
manager · A2 one active binding per employee; rebind only by the manager, audited · A3 QR windows and branch · A4
geofence exceptions · A5 lateness reported, never deducted · A6 state machine incl. 16 h and 5-minute rules,
overnight working date, missed-out job · A7 attendance never changes commission · A8 barcode by the paired device only.

**Sessions** M1 price override and discount record actor and time · M2 a discount above the limit needs an APPROVED,
unexpired, unconsumed proposal whose terms hash matches exactly; changing any term after approval voids it; replay
and cross-branch use fail · M3 late entry until approval, flagged; after approval → correction (§6) · M4 cancellation,
refund and performer change after approval → corrections for every affected line, including other lines whose tier
changed (Codex's example: 600 + 400 at 5 % above 500, cancelling the first) · M5 two concurrent redemptions of the last
session: one succeeds · M6 refund vs redemption race; a duplicate refund is a no-op · M7 expired entitlements redeem
nothing; refund after expiry refused.

**Commissions** C1–C8 as §5.8, plus: the estimate equals the engine on the DRAFT projection · approval racing a
session, a redemption, a refund and a plan change: each ends in the frozen result or in a correction, never lost ·
duplicate, reordered and replayed events converge · REVIEWED before APPROVED; only the owner approves; PAID records the
method · card tips in their own column · reminders on the 3rd and 5th.

**Customers & ratings** R1 phone shown only on the entry form, masked elsewhere, absent from exports, logs and import
errors · R2 the due time moves with new sessions, capped by closing time, one send under two workers · R3 attribution
to every performer; a cancellation before send removes it · R4 token tampering, replay, expiry and cross-tenant
rejected · R5 opt-out by link and by WhatsApp reply; queued sends suppressed.

**Visibility** V1 staff see only their own rows and the manager's columns · V2 reception like any employee plus the
entry screen · V3 salaries owner-only unless granted · V4 documents opened only through `files` with the stored
permission, each open audited.

---

## 12. Acceptance criteria

- [ ] §1's criterion holds for the parallel month.
- [ ] Every new tenant table has RLS and a negative isolation test; the rating link reaches only its own tenant's row.
- [ ] §5.8's engine tests and §11's behaviour tests pass; each is listed in its slice PR.
- [ ] No customer phone and no salary in any log line; the redaction list is extended.
- [ ] Every alert can be switched off alone and all at once.
- [ ] An import with any invalid row saves nothing.
- [ ] `pnpm check` green on `main`; staging runs the phase.

---

## 13. Open items

1. **The salon's real plan rules** (D-55) — before S9's fixtures are final.
2. **Client data** before the pilot: services and prices, staff and their plans, shifts, branches, open packages,
   contact person, meeting day.
3. The §9 ADRs, each before its slice.
