# Phase 1 — Implementation Plan

> **v5 · 2026-10-01** · implements `docs/specs/phase-1/SPEC.md` v5. Rules as in Phase 0: **one use case per PR**, in
> the order contract → migration + RLS → domain + tests → use case → adapters → integration tests → screen; Codex
> reviews every PR; `pnpm check` and `ci-gate` green before merge; a business rule not in the spec is a `TODO(spec)`
> and a stop.

---

## 1. Gates — each its own PR (or input) before the work that needs it

| Gate | What | Size | Before |
|---|---|---|---|
| G1 | ADR-0008: Phase 1 ports and events (SPEC §3) + `module-map.md` §3/§4 and its YAML | S | PR 4 |
| G2 | ADR-0010: `SECURITY DEFINER` pending-outbox count for approval, grants, tests | S | PR 53 |
| G3 | ADR-0009 + `CLAUDE.md` §5: the public rating link | S | PR 58 |
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
| 4b | in-app notification channel: store, list, mark read (admin bell) | M | 4 |
| 5 | platform suppression + WhatsApp "stop" callback | S | 4, G4 |
| 6 | staff OTP login (`OtpSender` bound at the composition root) | S | 3, 4 |
| 7 | permissions screen: role defaults + per-person ALLOW/DENY | M | 2 |
| 7b | per-person discount limit (`limit_bps` on the discount permission) | S | 7 |
| 7c | business default discount limit (settings) | S | 7b |
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
| 32 | services (create / update) | S | 11 |
| 32b | services import | S | 32 |
| 33 | package types | S | 32 |
| 34 | customers: find-or-create by phone | S | G1 |
| 34b | customers import | S | 34, 11 |
| 35 | `record-service-session` — effective discount up to the limit only; above it refused | L | 32, 34, 9, 7c |
| 36 | `record-tip` | S | 35 |
| 37 | `cancel-service-line` | S | 35 |
| 37b | `change-line-performers` (reassign, change shares) | M | 35 |
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
| 48a | statements table + the period lock helper (every period writer uses it) | S | 30 |
| 48 | plan versions + builder screen + validation | M | 48a |
| 49 | service overrides | S | 48 |
| 50 | projection consumer (lines, sales, tips) + estimate on read | M | 35, 36, 42, 48 |
| 51 | `generate-statement` + fingerprint | M | 50 |
| 52 | `review-statement` | S | 51 |
| 53 | `approve-statement` (atomic) | M | 52, 55, G2 |
| 54 | `mark-statement-paid` | S | 53 |
| 55 | corrections: generations, PAID too, target lock order, tips — tested on seeded closed periods | M | 51 |
| 56 | statement Excel export with the tips columns | S | 53 |
| 56b | approval reminders on the 3rd and 5th | S | 53 |
| 57 | staff app: my sessions and estimate | M | 50 |
| 57b | staff app: my attendance and my leave | S | 22, 17 |
| 57c | staff-columns setting | S | 57 |
| | **M8 · ratings and alerts** | | |
| 58 | customer opt-out on the rating page | S | 34, G3 |
| 59 | rating scheduling (due time, send deadline) | S | 35, G3 |
| 59b | at-most-once rating send: authoritative claim through `DaySessionsPort`, attempt row under the phone lock | S | 59, 4, 5 |
| 60 | rating page + `submit-rating` | S | 59b |
| 61 | low-rating alert + averages | S | 60 |
| 62 | alert-rules screen + master switch | S | 4b, 15, 28, 61 |
| | **M9 · pilot** | | |
| 63 | real data by import, dry-run week, parallel month, comparison (D-45) | S + calendar | all |

---

## 3. Duration

**Nominal, from the table:** 5 gates and 48 PRs at S (106 days), 25 at M (100), 1 at L (7) = **213 focused days ≈ 43
weeks for one developer** — the figure given to the client until Phase 1's own pace is measured. If the engine
track (PRs 29–31, 10 days) is handed to a second implementer, the critical path is ≈ 41 weeks.

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

---

## 5. Debate log — verdict tables

Rounds 1–3 ran on Codex `gpt-6-sol` (high) against v1–v3; every finding was accepted and is closed in the text
(30, 17 and 11 findings; round-3 closure audit in PR #49's history). Round 4 ran on Codex `gpt-6.1-sol` (high)
against v4, as a fresh full review.

### Round 4 — `gpt-6.1-sol` high, against v4

| # | Finding | Sev | Verdict | Reason |
|---|---------|-----|---------|--------|
| 1 | Corrections stop at PAID | P1 | accept | "Closed" = APPROVED or PAID (§6) |
| 2 | Correction target can close mid-post | P1 | accept | Ascending lock order, recheck, corrections in the target's fingerprint (§6) |
| 3 | Card tips bypass approval | P1 | accept | `SessionTipsChanged`, tip projection, frozen tip lines, TIP corrections (§3, §4, §6) |
| 4 | Approval ships before corrections | P1 | accept | PR 55 before PR 53; PR 48a lock helper before plan writers |
| 5 | Effective dates without timezone | P2 | accept | Business dates in the business timezone, resolved before the engine (§5) |
| 6 | Override rounding unspecified | P2 | accept | One `roundKwd` on every rule path (§5.2) |
| 7 | FIXED step at the line's endpoint | P2 | accept | Half-open interval; endpoint step not touched; fixture 5.500 (§5.5) |
| 8 | Missing plan or salary | P2 | accept | D-57: named errors, record allowed, review/approval blocked (§5) |
| 9 | Discount limit undefined | P2 | accept | D-56: `limit_bps` per person + business default; (list − net) / list; PRs 7b, 7c |
| 10 | No performer-change use case | P2 | accept | PR 37b `change-line-performers` |
| 11 | Eventual consistency vs cancel-before-send | P2 | accept | Claim reads `DaySessionsPort` synchronously (§10) |
| 12 | Sending after closing | P2 | accept | `send_deadline`; late claim → CANCELLED (D-58) |
| 13 | STOP race with the send | P2 | partial | Phone-hash lock serializes check, attempt and STOP; guarantee stated as "attempts not yet authorized" — a message handed to WhatsApp cannot be recalled |
| 14 | Page opt-out bound across businesses | P2 | accept | Bound stated per business (§10) |
| 15 | Package inputs unvalidated | P2 | accept | One validator, named errors, at preview and commit (§4) |
| 16 | Package retries | P2 | accept | `Idempotency-Key` on sale and redemption; one-time conditional reversal (§8) |
| 17 | IN_APP channel missing | P2 | accept | PR 4b in-app channel |
| 18 | Exactly 16 h | P2 | accept | `< 16 h` closes, `≥ 16 h` missed; both lock the open session (§7) |
