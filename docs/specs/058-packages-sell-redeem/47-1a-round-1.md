# 47-1a — correction round 1 of 3

Panel review 5786691865 reviewed `2f994df1`: all four bots completed; partial
coverage concerned the truncated `0211_snapshot.json`. Manager requested local
corrections only, without a push until “نقلت #851”.

## Prepared corrections

- 4481800012: lock the active company `FOR NO KEY UPDATE`, then caller memberships
  ordered by id `FOR UPDATE`, before permission/feature evaluation and durable writes.
  Integration coverage checks that a second transaction cannot update either row.
- 4481800045: reject any mutation of a failed package preview, preserving its first
  terminal error; test the PostgreSQL trigger error and unchanged polling result.
- 4481800070: refuse status changes out of `commit_requested` and `committed` until
  the financial slice explicitly opens its transitions. Test ready/failed targets.
- 4481800058: identify the package-import polling screen directly above its SQL.
- 4481800082: keep the PK-Q13 five-role rationale attached to selling permission.

The SQL draft and numbered migration carry identical custom trigger corrections.
No snapshot/schema change is needed for these custom SQL statements.

## Prepared response to 4481800029 — no code change

قرار الدمج للـ migrations عند المدير (PP-124، `docs/owner-decisions.ar.md` البند 62، في #842 اللي هيندمج قبل #851)، والفصل الـ async تطبيق لقاعدة `CLAUDE.md` §6 (أي حاجة فوق 200 ms تبقى job في الـ worker)، مش سؤال تقني مفتوح.

The measured synchronous preview took 719.70 ms. This split applies that mandatory
worker threshold; no alternative technical choice remains open. This response is
prepared locally and will be posted with the consolidated correction after retarget.

## Verification

The first run passed 18 tests, including company/membership locks and the unchanged
full HTTP timing assertion (median 121.8343 ms), but one new trigger assertion read
the outer Drizzle error instead of its PostgreSQL cause. The assertion was corrected
to inspect cause code `23514` and the exact trigger message, then rerun.

The corrected status suite passed all six tests. Typecheck passed all 29 tasks.
Lint initially rejected a test-only cross-module import; the lock test now exercises
the orders transaction adapter's public scope instead, preserving the production
module boundary. Its focused rerun and final lint are recorded before the local commit.
The focused lock test passed after removing a duplicate import introduced while
switching the test to the adapter. Final lint passed all 30 tasks.
Docs lint passed (0 errors, 29 existing warnings); module-map and diff checks passed.
Clean-code-guard, test-guard and docs-guard were reapplied to this correction scope.

Independent Astra medium review confirmed no remaining P0–P3 defects. For PP-126,
the reviewer read the complete local snapshot and compared it with the current schema
using `generateDrizzleJson` in memory: zero differences after excluding snapshot IDs.
`0211.prevId` and `0210.id` both equal
`ea1609ec-0ef2-4c94-bf6c-5ef3fe7c713e`; `0211.id` is
`f327b5ef-9381-405e-a3f7-8c3f7103265f`. This was static review, not test execution.

No push or remote thread resolution is authorized before the manager's retarget
message. After that message: rebase onto `origin/main`, run the applicable gates,
push once with the explicitly authorized `--force-with-lease`, then reply to and
resolve all six review threads. The manager requests Codex on the final merge head.
