# Phase 1 — Implementation Plan

> **v1 · 2026-10-01** · implements `docs/specs/phase-1/SPEC.md` v1. Same rules as Phase 0 (`docs/specs/phase-0/IMPLEMENTATION-PLAN.md`
> §0): one slice per PR, contract → migration + RLS → domain + tests → use case → adapters → integration tests → screen;
> Codex reviews every PR; `pnpm check` and `ci-gate` green before merge; a business rule not in the spec is a
> `TODO(spec)` and a stop, never a guess.

---

## 1. Before the first slice

| Item | Owner | Why it blocks |
|---|---|---|
| Start WhatsApp Business (WABA) verification for the PosPay display name | Waleed | OTP login (S2), ratings (S17) and WhatsApp alerts cannot go live without it; it takes days |
| ADR-0008 — Phase 1 events and ports (SPEC §3) + `module-map.md` §3/§4 amendments | Claude | the module-map gate fails the first slice that emits `ServiceRecorded` without it |
| ADR-0009 — the public rating link as a session-less entry point | Claude | CLAUDE.md §5 allows only three; S17 needs the fourth recorded |
| Client data: services + prices, staff + plans, shifts, branches, open packages, contact person, meeting day | Waleed → client | only S19 (pilot) waits on it; nothing before S19 does |

---

## 2. Slices

Size: **S** ≤ 3 days · **M** ≈ 1 week · **L** ≈ 1.5–2 weeks of focused build.

| # | Slice | Size | Depends on | Notes |
|---|---|---|---|---|
| S1 | `packages/ui` + `apps/admin` shell | L | — | RTL shadcn kit, Arabic font, login + TOTP, tenant selector locked to memberships, generated client |
| S2 | `apps/pos` shell + WhatsApp adapter + staff OTP | M | S1, WABA | device pairing reuses Phase 0 devices; OTP via Better Auth `phone-number` |
| S3 | Users & permissions screen | S | S1 | role defaults + per-person ALLOW/DENY (D-46); discount-limit permission shape defined here |
| S4 | `staff`: employees, salary, branches + import framework (employees) | M | S3 | the Excel import pattern (template, preview, all-or-nothing commit) is built once here and reused (D-48) |
| S5 | `files` + documents + types + expiry job + email adapter | M | S4 | email provider ADR; audited opens (D-39) |
| S6 | Schedules, templates, leave | M | S4 | |
| S7 | Attendance core | L | S2, S6 | rotating QR, 150 m geofence, bound phone (D-40), barcode card, exceptions, corrections |
| S8 | Attendance board, monthly report, not-clocked-in alert | M | S7 | report only, no deductions (D-12) |
| S9 | Commission engine — domain only | L | — | **start early, in parallel with S1–S8**: pure, no DB; every start × calc × tier × combine case, package value split, splits, signed corrections (SPEC C1–C7) |
| S10 | `catalog`: services + package types + import | M | S4 | commission value per service, threshold flag (D-37) |
| S11 | `customers` + import | S | S4 | masked phone (D-43), opt-out |
| S12 | `orders`: record session | L | S10, S11 | price override, split, tips (D-36), late entry (D-49), `ServiceRecorded` / `ServiceLineChanged` |
| S13 | Discount limits + approval | M | S12, S3 | PIN on device reuses Phase 0 cashier PIN; remote request polled (D-44) |
| S14 | Packages | L | S12 | sell, redeem under row lock, expire, extend, refund unused, import open packages (D-42) |
| S15 | `commissions` module | L | S9, S12, S14 | plans screen from blocks (D-35), period recompute, estimate, statement DRAFT → APPROVED → PAID, corrections, Excel export |
| S16 | Staff app: my sessions, estimate, attendance, leave | M | S15, S7 | manager-chosen columns (D-47) |
| S17 | Ratings | M | S12, S2, ADR-0009 | request job, signed single-use link, low-rating alert, averages (D-41) |
| S18 | Alert rules screen | S | S5, S8, S17 | per kind on/off, recipients, channels, delays, master switch (D-47) |
| S19 | Pilot | M | all + client data | import real data, dry-run week, parallel month, compare (D-45) |

**Only S9 runs in parallel** with the other track, because it is pure and touches no shared file; everything else is
serial, as in Phase 0.

---

## 3. Duration — re-forecast

The PRD gave Phase 1 **7–9 weeks**. The interview added customers, packages, ratings, tips, discount approvals, email
alerts, Excel import and a manager-built commission engine, and removed the barcode service flow.

| | Weeks of focused build |
|---|---|
| Original Phase 1 scope (PRD §9) | 7–9 |
| Added by the interview | +7–9 |
| **Phase 1 as specified here** | **≈ 14–18** |
| Pilot calendar on top (dry-run week + parallel month) | +5 calendar weeks, not compressible |

The largest risks, in order: the commission engine's stage combinations (S9, mitigated by exhaustive pure tests and
starting it first); WABA verification time (S2, S17 — mitigated by starting it now, and SMS as a fallback if it
stalls); package redemption concurrency (S14, row lock + a concurrency test).

---

## 4. Where the implementer must stop and ask

- Any commission case the stage model in SPEC §4 cannot express — stop; it becomes a new stage type by decision, never an `if`.
- Any screen that would show a customer's full phone number outside the entry form, or a salary to someone without the permission.
- Any need for a module arrow not in SPEC §3.
- Anything the client's real data contradicts (a service priced per length, a plan the stages cannot express) — found at S19 import, raised before the dry run.
