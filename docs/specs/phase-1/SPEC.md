# Phase 1 — Salon Pilot Spec: staff, attendance, sessions, packages, commissions

> **Status:** Draft v1 · 2026-10-01 · decisions from the onboarding interview with Waleed (2026-09-30 → 2026-10-01),
> recorded in `docs/PRD.md` §12 as D-12…D-17, D-28, D-32 (decided) and D-35…D-49 (new).
> **Governing docs:** `CLAUDE.md` · `CLAUDE.architecture.md` · `docs/06_Tech_Stack_Architecture_EN.md` · `docs/module-map.md`.
> On conflict those documents win. This spec decides *what Phase 1 delivers*, never *how the code is shaped*.
> **Supersedes** the Phase 1 task list in `docs/PRD.md` §10 where the two differ; the PRD section points here.

---

## 1. Why this phase exists

The salon owner's two named pains are attendance and commissions. Phase 1 replaces the salon's manual attendance and
its commission spreadsheet with one system: staff clock in with a rotating QR, reception records every session with its
performer, customer and price, and each employee sees her estimated commission update as she works. The owner approves
one monthly statement, and it is final.

### The single success criterion

> After one full month run **in parallel** with the salon's manual process, the approved statement matches the
> manager's own hand calculation for every employee to **0.001 KWD**, or every difference is explained by an error in
> the manual sheet; at period close there are zero unresolved attendance exceptions and zero unassigned service lines;
> and the approval actor and time are in the audit log.

The worked-example-before-code requirement (PRD P1-T1.3) is **replaced** by this parallel month (D-45): Waleed judged
a pre-computed example not required. The price is that the oracle arrives at the end of the pilot, not before coding,
so the engine's unit tests (§5, S9) carry the correctness load until then.

---

## 2. Scope

### In

| Area | What ships |
|---|---|
| Apps | `apps/admin` (Next.js), `apps/pos` (Vite PWA: attendance screen + staff app) — shells, then one screen per slice |
| `packages/ui` | shadcn RTL kit, tokens, Arabic fonts, lucide |
| `staff` | employees, base salary (restricted), branches, one bound phone, barcode card, schedules (weekly + templates), leave, documents metadata |
| attendance (in `staff`) | rotating QR, geofence 150 m, device binding, barcode fallback, lateness report, exceptions, corrections |
| `files` (minimal) | private R2 uploads for employee documents, audited access |
| `catalog` (minimal) | services (price, default commission value, counts-toward-threshold flag), package definitions |
| `customers` (minimal, **pulled forward from P2**) | name, phone (masked to last 3 digits everywhere but entry), language, messaging opt-out |
| `orders` (minimal) | service sessions: lines, price override, discount with limits and approval, split performers, tips, back-dating until approval; package sale and package redemption |
| `identity` (addition) | discount-limit permission, manager approval by PIN on the device or by a request to the manager's phone |
| `commissions` | manager-built stage rules, per-service and per-employee overrides, live estimate, monthly statement DRAFT → APPROVED → PAID, corrections |
| ratings (in `customers`) | WhatsApp rating request 1 h after the day's last session, public signed rating link, low-rating alert |
| `notifications` (minimal) | WhatsApp (OTP, rating, alerts) + email adapter, templates ar/en, opt-out |
| `settings` (addition) | alert rules (on/off, recipients, channel, delay), employee-visible columns, discount default limit |
| Import | Excel template + preview/validate/commit for employees, services, customers + open packages |
| Worker jobs | document expiry, not-clocked-in, statement awaiting approval, rating send, import processing |

### Out — explicitly not in Phase 1

- The POS sell screen, payments, cash shifts, printing (Phase 2). Sessions are recorded on an admin/reception screen.
- The service **barcode** flow (D-15 → Phase 2, same data model).
- Package **instalments** and package **sharing** between customers (D-42).
- Rating **affecting** commission (D-41) — report only.
- Overtime **pay** and lateness **deductions** — recorded and reported only; money arrives with payroll (P5).
- Realtime/SSE — screens poll (PRD Phase 1 realtime exception, closed by P2-T8).
- Product sales (Phase 2).

---

## 3. Modules in this phase

| Module | New or extended | Owns |
|---|---|---|
| `staff` | new | employees, salary, schedules, leave, attendance, device binding, documents metadata |
| `files` | new (minimal) | private objects, presigned URLs, access audit |
| `catalog` | new (minimal) | services, package definitions |
| `customers` | new (minimal) | customers, opt-out, ratings |
| `orders` | new (minimal) | service sessions, tips, package entitlements and redemptions |
| `commissions` | new | plans, stages, overrides, period results, statements |
| `notifications` | new (minimal) | channels, templates, delivery log |
| `identity` | extended | discount-limit permission, approvals |
| `settings` | extended | alert rules, employee columns |

**Import arrows** — all already in `docs/module-map.md` §2: `staff → tenancy, identity`, `commissions → staff`,
`files/catalog/customers/orders → tenancy`, `notifications → —`.

**Port arrows** — existing: `orders → catalog` (`CatalogReaderPort`), `commissions → staff` (`EmployeePlanPort`).
**New, each an amendment to §3 of the map in the slice that adds it:**

| Consumer | Port | Reads from | Why |
|---|---|---|---|
| `orders` | `CustomerLookupPort` | `customers` | resolve the session's customer by phone |
| `commissions` | `EmployeeSalaryPort` | `staff` | salary-multiple thresholds (D-35) |
| `customers` | `PerformerNamePort` | `staff` | rating message names the performer |

**New events** (map §4 amendment + ADR-0008): `ServiceRecorded` (orders → commissions, customers),
`ServiceLineChanged` (orders → commissions: price, discount, split, performer, cancel), `PackageSold`
(orders → commissions), `RatingSubmitted` (customers → notifications), `AttendanceException` (staff → notifications).
`ServiceCompleted` in the map is renamed `ServiceRecorded` in Phase 1, because no appointment flow exists yet to
"complete" it; ADR-0008 records the rename.

---

## 4. Domain model — Phase 1 subset

Conventions from `docs/specs/phase-0/SPEC.md` §4 apply unchanged: tenant PK `(company_id, id)`, UUID v7, FORCE RLS,
money `numeric(14,3)` / `bigint` mills, `timestamptz` UTC, immutable financial rows with reversals.

```
Employee          business_id · primary_branch_id · user_id? · name_ar · name_en · role_code
                  base_salary (mills, restricted permission) · hire_date · contract_end? · deleted_at?
EmployeeBranch    employee_id · branch_id
EmployeeDevice    employee_id · device_fingerprint · bound_at · bound_by · unbound_at? · unbound_by?
                  UNIQUE active binding per employee AND per fingerprint (one phone ↔ one account, D-40)
EmployeeCard      employee_id · card_code (barcode) · issued_at · revoked_at?
Schedule          employee_id · branch_id · week_start · shifts jsonb (day, start, end)   ShiftTemplate
LeaveRequest      employee_id · from · to · type · status (PENDING|APPROVED|REJECTED) · decided_by?
AttendanceSession employee_id · branch_id · clock_in · clock_out? · source (QR|BARCODE)
                  geo_ok (true|false|unknown) · device_fingerprint · working_date
AttendanceException session_id · kind (MISSED_OUT|NO_GEO|OUT_OF_RANGE|…) · status · resolved_by? · reason?
AttendanceCorrection session_id · field · before · after · reason · by · at
EmployeeDocument  employee_id · type_code · storage_key · expires_at? · uploaded_by
DocumentType      code · name_ar · name_en · alert_days (default 30)       (editable list, D-39)

Service (catalog item kind SERVICE)  name_ar · name_en · price · commission_value (PCT|FIXED, may be 0)
                  counts_toward_threshold bool (default true, D-37)
PackageType (catalog item kind PACKAGE) name · price · validity_days · components [{service_id, sessions}]

Customer          name · phone (E.164, unique per business) · locale · messaging_opt_out_at?
Rating            customer_id · session_ids · performer_ids · stars 1..5 · comment? · submitted_at
RatingRequest     customer_id · business_date · token_hash · sent_at? · expires_at

ServiceSession    (order) branch_id · customer_id · recorded_by · occurred_at · recorded_at · late_entry bool
ServiceLine       session_id · service_id · list_price · price (override) · discount · net (derived)
                  package_entitlement_id? · status (ACTIVE|CANCELLED) · cancelled_by? · reason?
LinePerformer     line_id · employee_id · share_bps (default equal split, sum = 10000)
Tip               session_id · employee_id · amount · method (CASH|CARD)
DiscountApproval  line_id · requested_by · limit_bps · requested_bps · approved_by · via (PIN|REMOTE) · at
PackageEntitlement customer_id · package_type_id · sold_line_id · price_paid · expires_at · extended_by?
PackageComponentBalance entitlement_id · service_id · sessions_total · sessions_used · unit_value (mills)
PackageRedemption entitlement_id · service_id · line_id · unit_value · at      (immutable; reversal row on cancel)

CommissionPlan    employee_id · version · effective_from · stages [ordered]
  Stage           start: FROM_FIRST | AFTER_AMOUNT(x) | AFTER_SESSIONS(n) | AFTER_SALARY_MULTIPLE(k)
                  calc: PCT_OF_LINE(p) | FIXED_PER_SESSION(a) | PCT_OF_EXCESS(p)
                  tier_mode: MARGINAL | WHOLE      combine: REPLACE | ADD
  PackageSaleStage (optional): PCT or FIXED on package sales by the seller (D-35)
ServiceOverride   plan_id · service_id · commission_value        (per-employee override of the service default)
PeriodResult      employee_id · period · plan_version_ids · lines [{line_id, amount}] · total · computed_at
Statement         business_id · period · status (DRAFT|APPROVED|PAID) · approved_by? · paid_at?
Correction        employee_id · target_period · source_line_id · amount (signed) · reason

AlertRule         (settings) kind · enabled · recipients · channels [WHATSAPP|EMAIL|IN_APP] · delay/lead
EmployeeColumns   (settings) visible column codes for the staff app
```

### Money rules restated

- **Net** of a line = price − discount, after the price override. Commission and thresholds use net (D-14).
- A package session's **unit value** = price paid ÷ sessions, the package discount spread across components in
  proportion to their list prices; remainder mills go to the last session so the sum is exact (D-42).
- **Tips** never enter net, thresholds or commission (D-36).
- **Split**: equal by default in basis points; the remainder of an odd split goes to the first performer.

---

## 5. The slices — each one is a PR

Ordered; a slice starts only when the one before it is green. Each carries contract → migration + RLS → domain +
tests → use case → adapters → integration tests → screen (`CLAUDE.md` §1).

| # | Slice | Depends on | Blocks on |
|---|---|---|---|
| S1 | `packages/ui` + `apps/admin` shell (login, TOTP, tenant selector, generated client) | — | — |
| S2 | `apps/pos` shell (PWA, device pairing, staff OTP login) + `notifications` WhatsApp adapter + OTP | S1 | — |
| S3 | Users & permissions screen incl. per-person ALLOW/DENY (D-46) | S1 | — |
| S4 | `staff`: employees, salary (restricted), branches, import (employees) | S3 | — |
| S5 | `files` + employee documents + document types + expiry job | S4 | email provider ADR (D-39) |
| S6 | Schedules + templates + leave | S4 | — |
| S7 | Attendance: rotating QR, geofence, device binding, barcode card, exceptions, corrections | S2, S6 | — |
| S8 | Lateness board, monthly attendance report, not-clocked-in alert | S7 | — |
| S9 | `commissions` **domain only**: stage engine, overrides, package value split — exhaustive unit tests | — | — |
| S10 | `catalog`: services + package types + import | S4 | — |
| S11 | `customers` minimal + import | S4 | — |
| S12 | `orders`: record session (lines, price override, split, tips, back-dating) | S10, S11 | — |
| S13 | Discount limits + approval (PIN / remote) | S12, S3 | — |
| S14 | Packages: sell, redeem, expire, extend, refund unused; import open packages | S12 | — |
| S15 | `commissions` module: plans UI, live estimate, statement, approval, corrections, Excel export | S9, S12, S14 | — |
| S16 | Staff app: my sessions table (manager-chosen columns), my estimate, my attendance, my leave | S15, S7 | — |
| S17 | Ratings: request job, public signed link, low-rating alert, averages | S12, S2 | ADR-0009 (public entry point) |
| S18 | Alert rules screen (on/off, recipients, channels, delays, master switch) | S5, S8, S17 | — |
| S19 | Pilot: seed by import, dry-run week, parallel month | all | client data |

S9 has no dependency and runs early: the engine is the riskiest logic and is pure.

---

## 6. Behaviour that must hold — numbered for tests

**Attendance**
- A1. A clock-in from a phone that is not the employee's bound phone is **rejected** (D-40); the error tells her to
  use her card at reception or ask the manager to rebind.
- A2. One phone cannot be bound to two employees; rebinding requires the manager, audited.
- A3. The QR is valid for its 60 s window and the previous one; a token from another branch is rejected.
- A4. Outside 150 m → the clock is **recorded** with an `OUT_OF_RANGE` exception; no location → `NO_GEO` exception.
- A5. Grace 10 min; lateness is reported, never deducted (D-12).
- A6. A missing clock-out becomes a `MISSED_OUT` exception, never hours or a deduction (D-32); correction needs a
  reason, keeps the old value, and is visible to the owner.
- A7. Attendance never changes commission (D-14).

**Sessions and money**
- M1. Reception may override the price; override and discount record who and when (D-44).
- M2. A discount above the actor's limit needs manager approval, by PIN on the device or by a remote request that the
  line waits on; without it the line is not saved (D-44).
- M3. Back-dated entry is allowed until the period's statement is APPROVED, and is flagged `late_entry` (D-49).
- M4. After approval, a cancellation, refund or performer change produces a **correction in the next open period**;
  an approved statement is never reopened.
- M5. A package redemption and its line are written in one transaction; a balance can never go below zero, even under
  two concurrent redemptions (row lock on the component balance).
- M6. Expired entitlements redeem nothing; the manager may extend, audited. Unused sessions carry no commission.
- M7. Refund of a package covers unused sessions only and needs the manager (D-42).

**Commissions**
- C1. The engine is one pure function: `period lines × plan versions × salary → per-line amounts`, with no DB.
- C2. Stages evaluate in order; each stage starts at its condition; REPLACE ends the previous stage's calculation for
  later lines, ADD stacks; MARGINAL pays only above the threshold, WHOLE pays the whole period once passed.
- C3. A service's commission value may be zero; zero-value services still count toward thresholds unless the service
  says otherwise (D-37).
- C4. Salary-multiple thresholds read the salary effective on the period's last day (`EmployeeSalaryPort`).
- C5. A plan change is effective from a date, or for the whole period **only while the period is DRAFT** (D-38); the staff
  app shows a notice that the calculation changed.
- C6. The estimate the employee sees is the same function run on the DRAFT period; it is labelled estimated until
  approval.
- C7. The owner's example — threshold 500, 5 % above it — pays 25.000 on 1,000.000 of net sales (MARGINAL).
- C8. Statement approval is blocked while the period has lines without a performer or outbox events for the period not
  yet processed. Open attendance exceptions do **not** block it, because attendance never changes commission (A7).

**Customers and ratings**
- R1. A customer's phone is shown in full only on the entry form while typing; everywhere else, including to the
  manager, only its last 3 digits (CLAUDE.md §8).
- R2. One rating request per customer per business day, sent 1 h after her last session that day, never to an
  opted-out customer; every message carries an opt-out.
- R3. ≤ 2 stars alerts the manager (if the alert is on). Ratings never change commission (D-41).
- R4. The rating link carries a signed, single-use, expiring token that resolves the tenant; it exposes nothing else.

**Visibility**
- V1. An employee sees only her own sessions, estimate, attendance and average rating; the columns come from the
  business setting; rating comments only if the manager enables them.
- V2. Reception sees her own sessions and commission like any employee (interview), plus the entry screen.
- V3. Salaries: owner only, unless the owner grants the permission to a person (D-46).
- V4. Documents: owner and manager only; every open writes an audit row.

---

## 7. Acceptance criteria for the phase

- [ ] The single success criterion (§1) holds for the parallel month.
- [ ] Every new tenant table has RLS and a negative isolation test; the public rating endpoint reaches only its own
      tenant's rating row.
- [ ] The engine's unit tests cover every start × calc × tier mode × combine combination, package unit values,
      splits and signed corrections, with no database.
- [ ] No customer phone number and no salary appears in any log line (redaction list extended).
- [ ] Every alert can be switched off individually and all at once.
- [ ] Imports reject a file with any invalid row and save nothing from it.
- [ ] `pnpm check` green on `main`; staging runs the phase.

---

## 8. Open items — `TODO(spec)`

1. ~~**WABA verification** (D-16)~~ — handled outside this plan and treated as ready (Waleed, 2026-10-01).
2. **Email provider** (D-39): chosen in an ADR at S5 (a new provider needs one, CLAUDE.md §11).
3. **ADR-0008** — Phase 1 events and ports (§3). **ADR-0009** — the public rating entry point, a fourth session-less
   path next to webhooks, messaging callbacks and worker jobs (CLAUDE.md §5).
4. **Client data** before S19: services and prices, staff and their plans, shifts, branches, open packages, the named
   contact, the weekly meeting day.
