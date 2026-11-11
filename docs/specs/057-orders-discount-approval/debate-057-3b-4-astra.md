# Debate 057-3b-4 — Astra not available; advisor stand-in review (2026-11-12)

**Astra did not run.** `codex exec -m gpt-6-astra` failed with "You've hit your usage limit ... try again at Nov 14th, 2026 11:20 AM" (two identical errors, no review produced). The planned one-round Astra debate is therefore **not done**. In its place the session consulted `pospay-advisor` (read-only, non-binding, PP-136) on the same brief and files. This is advice, not the Astra round; the manager decides whether to run Astra once its quota returns or accept this record.

## Advisor findings (condensed, no P0/P1)

1. **P2** The admin page spec asserts a switch count of 13 (master + 12 kinds) at about line 66; it must become 14.
2. **P2** The new admin test goes in a new file unconditionally: the page spec is near the 400-line ESLint cap.
3. **P2** "No IN_APP" is representable: `alert_rules_channels` is `channels <@ ARRAY['IN_APP']`, so the empty array passes; no "skip" escape; the price-edit model hardcodes the channel, so the helper needs a channels parameter.
4. **P2** Use a fresh `otherScope()` per worker case, not default tenant A, so cases do not depend on order or cleanup.
5. **P2** Master `NULL` is a different stored state from "no row"; test both (false, then NULL with a new event).
6. **P3** Replay retention must be self-contained and delete the receipt with `company_id` in the predicate.
7. **P3** The 057-3 always-on guard is correct but passes today (the request bell has no rules port); its fixture helpers filter on tenant A, so use `otherScope()` and the owner connection; put it in a second spec file (one fixture per file).
8. No defect found in full-save, branch view or reset-branch; nothing else enumerates the kinds (domain, contract, CHECK, OpenAPI and the API count are already 15).
9. **P3** No textual overlap with 3b-5 if 3b-4 only adds files; the risk is semantic if 3b-5 changes shared fixture members; 3b-5 should make additive-only fixture edits.
10. **P3** `docs/journey/58-alert-rules.md` still says 14 kinds; fold into 057-6 activation or a docs follow-up.
11. **P3** Lane deviation: plan assigns tests to Agy; Kimi CLI is used because Agy is denied in new worktrees.

## Verdicts

| # | Verdict | Change |
|---|---|---|
| 1-7 | accept | The slice brief and the Kimi test brief now carry each correction. |
| 8 | n/a | No change needed. |
| 9 | accept | Reported to the manager; 3b-4 adds files only and edits no fixture. |
| 10 | defer | Out of scope; reported to the manager. |
| 11 | accept | Recorded here and in the report. |
