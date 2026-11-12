# Debate 68-2b-2: stand-in for Astra (one round, PP-168)

Astra (`codex exec -m gpt-6-astra -c model_reasoning_effort=medium --sandbox read-only`) failed with "You've hit your usage
limit ... try again at Nov 14th, 2026 11:20 AM". Per the manager's instruction the round was run with the `pospay-advisor`
agent (Fable, read-only) as a **non-binding stand-in**, on `plan-68-2b-2.md` as first committed. Prompt: adversarial review
of correctness, locking, RLS/grants/triggers, readiness, cleanup, E3, size, scope. The reviewer's verdict: "agree with
changes", no P0, 2 P1, 12 P2, 2 P3.

## Findings and verdicts (all accepted; applied in the plan's "Debate round" section)

1. P1 E9: `otp-startup.spec.ts` mocks `startStaffWorker` without `reportsReady`; per-queue readiness needs its own spec. Accepted.
2. P1 E4/E5: no connection drain on timeout (`main.ts` has no `boundedTenantTransactions`); failure write needs its own timeout and `moveToDelayed`. Accepted.
3. P2 E5: `57014`/`25P03` are permanent failures. Accepted.
4. P2 E3: `today` from `as_of`, not `now()`. Accepted.
5. P2 E3: drop an unusable-timezone branch as the API does. Accepted.
6. P2 E4: `app.user_id` set after the lock. Accepted.
7. P2 E1: CHECKs and a fixed-length fingerprint. Accepted.
8. P2 E1: explicit policies per table and REVOKE list. Accepted.
9. P2 E1: cascade under FORCE RLS tested as `pospay_app`, fallback named. Accepted.
10. P2 testability: injected cap, deadline seam. Accepted.
11. P2 calibration on a near-cap fixture with trigger cost. Accepted.
12. P2 E8 batch size 2 reports; own interval constant. Accepted.
13. P2 missing tests (list in the plan). Accepted.
14. P2 size: 2,000-2,600 total. Accepted; reported to the manager.
15. P3 deadline read in a second statement. Accepted.
16. P3 pure `domain/` function, `startStaffWorker` line budget, command-tag count, version rule for stored shapes, E10 scan removed by 68-2c, sanitised log line, lost-scheduler note. Accepted (version rule: stored shapes carry no version in this PR; a change adds a field with a default).
