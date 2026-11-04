# PR #793 final gate — 2026-11-05

Head: `2f73672c44d9904da7bd7eaf94e0817c58384203`.
CI run: `41913906300`, all required jobs passed.
Tested merge: `b5abd67a`, merging the head into
`f7b6f9ef5a91364ab9187f3185ae1e258b6028ef`, still current main at inspection.
Codex and all four MergePilot panels completed without new findings on this head.
Backup: DEP-1 snapshot `aa940847`, successful restore of the exact snapshot.

## Verified fixes

The id-only and sort-key forged-cursor regressions passed in API shard 1. The
current query no longer looks up an employee anchor. Both old oracle threads
were replied to with the current-head CI evidence and resolved. The CS-Q40
identifier collision was separately verified fixed and its thread resolved.

## Actual EXPLAIN evidence

API shard 4, `commission-plan-employee-names-plan.spec.ts`, at 21:32:08Z.
The target business contains 2004 rows: 2000 seeded for the scenario and four
existing fixture rows; the equal-name group contains 300 seeded employees.

| Page | Rows returned by index scan | Rows removed by filter | Loops | Total read | Sort |
| --- | ---: | ---: | ---: | ---: | --- |
| First | 301 | 0 | 1 | 301 | Incremental Sort |
| Middle of equal-name group | 151 | 150 | 1 | 301 | Incremental Sort |
| Near end of equal-name group | 22 | 296 | 1 | 318 | Incremental Sort |

Index Cond binds company and business; middle/end additionally use
`name_en_key >= 'aaa plan employee'`. It does not seek by the id tie-breaker.
No sequential scan occurred. This is actual measured plan evidence, not proof
that the tie-breaker-index finding was fixed or approved for deferral.

## Remaining historical dispositions

- Index thread `4445819860`: the missing id tie-breaker remains visible in the
  measured plan. Its previous manager reply required owner disposition if the
  evidence showed a need for an index. No index migration is currently authorized.
- Stored-key thread `4450701433`: a 10000-character stored key was previously
  reproduced as a response `ZodError`/sanitized 500. Normal create/update/import
  paths appear limited to 255 input units, but legacy stored-data invariants were
  not proved. Previously recorded as conditional P2 and escalated, not deferred.
- Proxy/log thread `4450719183`: deployment verification, not a demonstrated
  production disclosure. DEP-1 was asked for its existing read-only receipt;
  no new probe, configuration change or deployment was requested.

CI success does not silently dispose of those historical findings. The general
owner instruction to update and merge is retained; any explicit deferral of
still-open findings must be recorded before merge under pipeline sections 8–9.
