# Phase 1 — Implementation Plan

> **v3 · 2026-10-01** · implements `docs/specs/phase-1/SPEC.md` v3. Rules as in Phase 0: **one use case per PR**, in
> the order contract → migration + RLS → domain + tests → use case → adapters → integration tests → screen; Codex
> reviews every PR; `pnpm check` and `ci-gate` green before merge; a business rule not in the spec is a `TODO(spec)`
> and a stop.

---

## 1. Gates — each its own PR (or input) before the work that needs it

| Gate | What | Size | Before |
|---|---|---|---|
| G1 | ADR-0008: Phase 1 ports and events (SPEC §3) + `module-map.md` §3/§4 and its YAML | S | PR 4 |
| G2 | ADR-0010: `SECURITY DEFINER` pending-outbox count for approval, grants, tests | S | PR 53 |
| G3 | ADR-0009 + `CLAUDE.md` §5: the public rating link | S | PR 59 |
| G4 | ADR-0011: Better Auth `passkey` plugin + platform WhatsApp suppression | S | PRs 5, 20 |
| G5 | Email-provider ADR | S | PR 14 |
| D-55 | The salon's real plan rules (input from the client, no build days) | — | PR 30 closes |

**Named exceptions to the template:** PRs 1–3 are shells (no domain). PRs 29–31 are domain-only (pure functions,
fixtures, no database or screen) and are the **one parallel track**: they touch no shared file and may run beside
M1–M3. Everything else is serial.

---

## 2. PRs — one use case each

Nominal size: **S** = 2 focused days, **M** = 4, **L** = 7 (the Phase 0 convention; §3).

| # | PR | Size | Depends on |
|---|---|---|---|
| | **M1 · shells and access** | | |
| 1 | `packages/ui`: RTL kit, tokens, Arabic font, lucide | M | — |
| 2 | `apps/admin` shell: login, TOTP, tenant selector, generated client | M | 1 |
| 3 | `apps/pos` shell: PWA, device pairing screen | M | 1 |
| 4 | `notifications`: WhatsApp channel, templates ar/en, delivery log | M | G1 |
| 5 | platform suppression + WhatsApp "stop" callback | S | 4, G4 |
| 6 | staff OTP login (`OtpSender` bound at the composition root) | S | 3, 4 |
| 7 | permissions screen: role defaults + per-person ALLOW/DENY | M | 2 |
| | **M2 · staff** | | |
| 8 | `create-employee` | S | 7 |
| 9 | `update-employee` (incl. branches) | S | 8 |
| 10 | `set-salary` (history, never back-dated, restricted read) | S | 8 |
| 11 | import framework (template, preview, all-or-nothing) + employee import | M | 8 |
| 12 | `files`: presigned upload/download with stored permission, access audit | M | 7 |
| 13 | document types + `record-employee-document` | S | 8, 12 |
| 14 | email channel | S | 4, G5 |
| 15 | document-expiry job | S | 13, 14 |
| 16 | schedules + templates | M | 8 |
| 17 | `request-leave` | S | 8 |
| 18 | `decide-leave` | S | 17 |
| | **M3 · attendance** | | |
| 19 | QR issuer + attendance screen | M | 3 |
| 20 | `enrol-passkey` | M | 6, 8, G4 |
| 21 | `unbind-passkey` + the two-employees-one-device flag | S | 20 |
| 22 | `clock-attendance`: state machine, geofence, 5-minute dedupe | M | 16, 19, 20 |
| 23 | `clock-by-card` on the paired device | S | 22 |
| 24 | suspected / missed-out job | S | 22 |
| 25 | `resolve-attendance-exception` | S | 24 |
| 26 | `correct-attendance` | S | 22 |
| 27 | attendance board + monthly report + CSV | M | 25, 26 |
| 28 | not-clocked-in alert | S | 22, 15 |
| | **M4 · engine (parallel track, domain only)** | | |
| 29 | engine I: order, shares, overrides, base, MARGINAL (SPEC §5.1–5.5) | M | — |
| 30 | engine II: WHOLE, SESSIONS, salary multiple, versions, package sale, §5.7 validation, §5.8 hand-calculated fixtures | M | 29, D-55 |
| 31 | package allocation and slots (`orders/domain`, SPEC §8) | S | — |
| | **M5 · catalog, customers, sessions** | | |
| 32 | services + import | M | 11 |
| 33 | package types | S | 32 |
| 34 | customers: find-or-create by phone, import | M | 11, G1 |
| 35 | `record-service-session` — discounts up to the limit only; above it refused | L | 32, 34, 9 |
| 36 | `record-tip` | S | 35 |
| 37 | `cancel-service-line` | S | 35 |
| 38 | `request-discount-approval` (proposal with terms hash) | S | 35, 7 |
| 39 | `approve-discount` by PIN on the device | S | 38 |
| 40 | `approve-discount` remotely | S | 38 |
| 41 | above-limit discounts: consume the approval in the line's transaction (M2) | S | 39, 40 |
| | **M6 · packages** | | |
| 42 | `sell-package` | M | 33, 31, 35 |
| 43 | `redeem-package-session` under a row lock | M | 42 |
| 44 | `cancel-redemption` | S | 43 |
| 45 | `extend-package` | S | 42 |
| 46 | `refund-package` | M | 43 |
| 47 | import open packages | S | 43 |
| | **M7 · commissions** | | |
| 48 | plan versions + builder screen + validation | M | 30 |
| 49 | service overrides | S | 48 |
| 50 | projection consumer + estimate on read | M | 35, 42, 48 |
| 51 | `generate-statement` + fingerprint | M | 50 |
| 52 | `review-statement` | S | 51 |
| 53 | `approve-statement` (atomic) | M | 52, G2 |
| 54 | `mark-statement-paid` | S | 53 |
| 55 | corrections (generations, earliest DRAFT target) | M | 53 |
| 56 | Excel export, tips columns, reminders | S | 53 |
| 57 | staff app: my sessions, estimate, attendance, leave; columns setting | M | 50, 22 |
| | **M8 · ratings and alerts** | | |
| 58 | customer opt-out on the rating page | S | 34 |
| 59 | rating scheduling + at-most-once send job | M | 35, 4, G3 |
| 60 | rating page + `submit-rating` | S | 59 |
| 61 | low-rating alert + averages | S | 60 |
| 62 | alert-rules screen + master switch | S | 15, 28, 61 |
| | **M9 · pilot** | | |
| 63 | real data by import, dry-run week, parallel month, comparison (D-45) | S + calendar | all |

---

## 3. Duration

**Nominal, from the table:** 5 gates and 36 PRs at S (82 days), 26 at M (104), 1 at L (7) = **193 focused days ≈ 39
weeks** for one developer at the Phase 0 convention; minus the parallel engine track (PRs 29–31, 10 days) ≈
**37 weeks**. This is the figure given to the client until Phase 1's own pace is measured.

**Scenario, not a commitment:** Phase 0 was forecast at 6–8 weeks and delivered in about 10 calendar days
(2026-09-22 → 2026-10-01). If Phase 1 ran at the same ratio it would take ≈ 8–10 calendar weeks — but one phase is not
a trend, and Phase 1 has screens and client inputs that Phase 0 did not.

**Re-forecast** after M2 from the measured days per PR, and tell the client then. On top of build: **+5 calendar
weeks** of pilot, not compressible, plus one more validation cycle if the parallel month finds engine differences.

Largest risks: the engine's combinations (M4 — hand-calculated fixtures, started first); approval racing live data
(PR 53 — the atomic protocol and its race tests); package concurrency (PRs 43, 46 — row locks and race tests).

---

## 4. Where the implementer must stop and ask

- A commission case SPEC §5.7 cannot express — a new calc or `from` kind by decision, never an `if`.
- Any screen, export or log that would show a customer's full phone, or a salary without the permission.
- Any module arrow or event not in SPEC §3.
- The salon's real plans or data contradicting the spec — raised when they arrive (D-55), not at the pilot.
