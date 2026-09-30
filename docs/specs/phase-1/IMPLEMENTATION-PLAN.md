# Phase 1 — Implementation Plan

> **v2 · 2026-10-01** · implements `docs/specs/phase-1/SPEC.md` v2. Rules as in Phase 0: **one use case per PR**, in
> the order contract → migration + RLS → domain + tests → use case → adapters → integration tests → screen; Codex
> reviews every PR; `pnpm check` and `ci-gate` green before merge; a business rule not in the spec is a `TODO(spec)`
> and a stop. The spec's S-numbers (milestones) are split here into the PRs that implement them.

---

## 1. Gates — governing amendments, each its own PR before the work that needs it

| Gate | What | Before |
|---|---|---|
| G1 | ADR-0008: Phase 1 ports and events (SPEC §3) + `module-map.md` §3/§4 and its YAML | PR 4 (first event or new port) |
| G2 | ADR-0010: the `SECURITY DEFINER` pending-outbox count for period close, grants, tests | PR 39 |
| G3 | ADR-0009 + `CLAUDE.md` §5: the public rating link as the fourth session-less entry point | PR 43 |
| G4 | Email-provider ADR | PR 12 |

**Exceptions to the template, named:** PRs 1–3 are shells (no domain); PRs 23–25 are domain-only (pure functions and
tests, no database, no screen) and are the **one parallel track** — they touch no shared file and may run beside
M1–M3. Everything else is serial.

---

## 2. PRs

Nominal size: **S** = 2 focused days, **M** = 4, **L** = 7 (the Phase 0 convention; §3 calibrates it).

| # | PR — one use case | Size | Depends on |
|---|---|---|---|
| | **M1 · shells and access** | | |
| 1 | `packages/ui`: RTL kit, tokens, Arabic font, lucide | M | — |
| 2 | `apps/admin` shell: login, TOTP, tenant selector locked to memberships, generated client | M | 1 |
| 3 | `apps/pos` shell: PWA, device pairing screen | M | 1 |
| 4 | `notifications`: WhatsApp channel, templates ar/en, suppression list, delivery log | M | G1 |
| 5 | staff OTP login (`OtpSender` injected at the composition root) | S | 3, 4 |
| 6 | permissions screen: role defaults + per-person ALLOW/DENY (D-46) | M | 2 |
| | **M2 · staff** | | |
| 7 | `create-employee` / `update-employee`, branches | M | 6 |
| 8 | salary history, restricted read (V3) | S | 7 |
| 9 | import framework (template, preview, all-or-nothing) + employee import | M | 7 |
| 10 | `files`: presigned upload/download with stored permission, access audit (V4) | M | 6 |
| 11 | document types + `record-employee-document` | S | 7, 10 |
| 12 | email channel | S | 4, G4 |
| 13 | document-expiry job + alert-rule reading | S | 11, 12 |
| 14 | schedules + templates | M | 7 |
| 15 | `request-leave` / `decide-leave` | S | 7 |
| | **M3 · attendance** | | |
| 16 | QR issuer + attendance screen | M | 3 |
| 17 | phone enrolment credential + manager unbind (D-40) | M | 5, 7 |
| 18 | `clock-attendance`: state machine, geofence, 5-minute dedupe (SPEC §7) | M | 14, 16, 17 |
| 19 | barcode-card clock by the paired device | S | 18 |
| 20 | missed-out job, exceptions, `correct-attendance` | M | 18 |
| 21 | attendance board + monthly report + CSV | M | 20 |
| 22 | not-clocked-in alert | S | 18, 13 |
| | **M4 · engine (parallel track, domain only)** | | |
| 23 | engine I: order, shares, overrides, base, MARGINAL tiers (SPEC §5.1–5.5) | M | — |
| 24 | engine II: WHOLE, SESSIONS, salary multiple, versions, package sale, §5.7 validation, §5.8 fixtures | M | 23 |
| 25 | package allocation (`orders/domain`, SPEC §8) | S | — |
| | **M5 · catalog, customers, sessions** | | |
| 26 | services + import | M | 9 |
| 27 | package types | S | 26 |
| 28 | customers: find-or-create by phone, import, opt-out (D-30, D-43) | M | 9, G1 |
| 29 | `record-service-session`: lines, price override, split, performer check, `ServiceLineChanged` | L | 26, 28 |
| 30 | tips, late entry, `cancel-service-line` | M | 29 |
| 31 | discount limit + proposal + PIN / remote approval (D-44, M2) | M | 29, 6 |
| | **M6 · packages** | | |
| 32 | `sell-package`: seller, paid-in-full attestation, `PackageSaleChanged` | M | 27, 25, 29 |
| 33 | `redeem-package-session` under a row lock (M5) | M | 32 |
| 34 | cancel redemption, `extend-package`, `refund-package` (M6, M7) | M | 33 |
| 35 | import open packages (D-51) | S | 33 |
| | **M7 · commissions** | | |
| 36 | plan versions + builder screen + validation (SPEC §5.7) | M | 24 |
| 37 | service overrides | S | 36 |
| 38 | projection consumer + estimate on read | M | 29, 32, 36 |
| 39 | statement: generate, review, approve (atomic), pay | L | 38, G2 |
| 40 | corrections (SPEC §6) | M | 39 |
| 41 | Excel export, tips columns, reminders (D-54) | S | 39 |
| 42 | staff app: my sessions, estimate, attendance, leave; columns setting (D-47) | M | 38, 18 |
| | **M8 · ratings and alerts** | | |
| 43 | rating-request scheduling + send job (SPEC §10) | M | 29, 4, G3 |
| 44 | public rating page, opt-out, WhatsApp "stop" callback | M | 43 |
| 45 | low-rating alert + averages | S | 44 |
| 46 | alert-rules screen + master switch | S | 13, 22, 45 |
| | **M9 · pilot** | | |
| 47 | real data by import, dry-run week, parallel month, comparison (D-45) | S + calendar | all |

---

## 3. Duration — two numbers, both stated honestly

**By the nominal sizes:** 4 gates and 16 PRs at S, 29 at M, 2 at L ≈ **170 focused days ≈ 34 weeks** for one
developer at the Phase 0 convention, minus ≈ 2 weeks for the parallel engine track (PRs 23–25) ≈ **32 weeks**. The v1 figure (14–18) did not
follow from its own table and is withdrawn.

**Calibrated by Phase 0's actual pace:** Phase 0 was forecast at 6–8 weeks and was delivered — staging and backups
included — between 2026-09-22 and 2026-10-01, about **4–5× faster** than its forecast, with the same AI-assisted,
Codex-reviewed workflow. Applying that ratio: **≈ 6–8 calendar weeks of build**.

**Commitment:** plan on the calibrated range, and re-forecast after M2 from the measured pace; if M1–M2 take more than
2.5 weeks, fall back toward the nominal figure and tell the client. On top of build: **+5 calendar weeks** of pilot
(dry-run week + parallel month), not compressible, and one more validation cycle if the parallel month finds engine
differences.

Largest risks: the engine's combinations (M4, mitigated by §5.8's exhaustive pure tests and starting first); approval
racing live data (PR 39, mitigated by the atomic protocol and its race tests); package redemption concurrency (PR 33,
row lock + a concurrency test).

---

## 4. Where the implementer must stop and ask

- A commission case SPEC §5.7 cannot express — a new calc or `from` kind by decision, never an `if`.
- Any screen, export or log that would show a customer's full phone, or a salary without the permission.
- Any module arrow or event not in SPEC §3.
- The salon's real plans or data contradicting the spec (a service priced per length, a plan the table cannot hold) —
  raised when they arrive (D-55), not at the pilot.
