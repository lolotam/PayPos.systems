# 43-1 candidate internal code review, round 1

Disposition: **REQUEST_CHANGES; no clean initial handoff or final review approval**.
Codex `gpt-6-astra`, reasoning effort `high`, read-only, fresh context.

- Task: `node:delegated-task:command%3Amcp%3A837bda50-0114-4922-8d73-ac3cf991dfc3%3Adelegate-task%3Afacea002-77a3-4acb-856f-9f6efda44cfa`.
- Run: `run:thread:thread%3Adelegated-task%3Acommand%253Amcp%253A837bda50-0114-4922-8d73-ac3cf991dfc3%253Adelegate-task%253Afacea002-77a3-4acb-856f-9f6efda44cfa:ordinal:1`.
- Started `2026-11-04T21:55:10.253Z`; completed `2026-11-04T22:00:21.174Z`.
  Actual run duration **310.921 seconds**. Provider token/cost/quota unavailable.
- Source: <t3-thread://v2/438824e0-fe19-4a22-bb31-f81eff7b7322/thread:delegated-task:command%3Amcp%3A837bda50-0114-4922-8d73-ac3cf991dfc3%3Adelegate-task%3Afacea002-77a3-4acb-856f-9f6efda44cfa>.

## Inspected identity and stated limits

HEAD `f7b6f9ef5a91364ab9187f3185ae1e258b6028ef`; 24 changed files including
untracked files; authored 1388, generated 0 additions plus deletions.

```text
Candidate SHA256:
AA22FB41D40A0344357004C64932C694235B1D0FD9CB96330349E3C8BB654D97
Tracked diff SHA256 (git diff --binary HEAD):
ecb8b9ef3ef2fbd6e4c4de3261b9f1d1358ed7483596d274da31c526449cc126
Changed-file manifest SHA256:
78b080e1acf6ee2311688b16f882687dcf4b47d6f6a6ef1806481d5f77d8d30f
```

The reviewer reported no confirmed P0/P1 in inspected code and one P2 below.
It ran no tests and did not independently certify the 188/98 results. It explicitly
reported truncated document reads that it did not finish; consequently this
receipt does **not** satisfy the full-reading or final independent-review gate.
The parent's completed prerequisite reading does not repair the reviewer's gap.

## P2 finding and parent correction

The cancellation-after-constraint-flush test omitted the 054 cancellation row, so
`slc_complete` could reject it even if the package cancellation guard were absent.
The wrong-cancellation test also left the second line ACTIVE and its slot held,
allowing unrelated violations to reject it first.

The parent corrected both tests in `package-redemption-reversal.spec.ts`:

- After IMMEDIATE then DEFERRED, insert a valid 054 cancellation through the real
  fixture sequence and leave the redemption live. Assert both `23514` and the
  exact constraint `package_redemption_complete`.
- For a cancellation belonging to another line, cancel both lines correctly,
  release both slots and retain every reciprocal link. The sole inconsistency is
  the second redemption naming the first line's cancellation. Assert the same
  exact constraint instead of accepting any integrity error.

No production SQL changed; the candidate hash above is unchanged. Focused rerun:
`pnpm --filter @pospay/db exec vitest run --config vitest.redemption-candidate.config.ts package-redemption-reversal.spec.ts`:
**24 passed**, started 2026-11-05 01:01:03 Asia/Kuwait, **16.92 seconds**.
Focused ESLint and `git diff --check` passed. The earlier 188-test candidate run
remains historical; only the changed reversal suite was rerun for this correction.

## Open gates and budget

Internal review/fix cycles: **1 of 5** used; GitHub consolidated correction pushes:
**0**. Preserve these counters through subsequent phases. This small finding was
fixed by the parent before clean initial handoff; no correction worker or new
delegate was requested for it. Independent approval remains pending.

The required later independent review must complete every governing read without
unrepaired truncation, inspect the final journalled/generated artifacts and the
corrected tests, and provide a new exact-identity receipt. Candidate success is
not final migration certification. No migration lane, numbering, generation,
push, merge or deployment is authorized by this review.
