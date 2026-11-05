# 57-1 — remaining own-access dependency refresh

Date: 2026-11-05. Baseline: `cc085aacd013311f63ba7e5fffc7d98f11a6dcb2` (HEAD and fetched origin/main).
The manager reassigned this session from 57b-1 to the remaining part of 57-1 at 13:45.
57b-1 returns to the queue; this session owns one PR and must not merge it.

## Delivered on main

- **57-0 / #463:** ADR-0019 and ADR-0027 reception-device private-view addenda.
- **42-2 / #778**, commit `7b52176f`: the catalog prerequisite named in `plan-57-1.md` is merged.
- **57-1b / #775**, commit `034db9cd`: auth-issued consume-once PIN proof; session/operator/device-bound
  window and monotonic counter in `verification`; atomic check/touch, 60-second idle and five-minute cap;
  conditional close and cleanup on session retirement, rotation and phone approval. Real-database
  tests cover proof reuse/forgery/age, races, mismatch, late requests, rollback of time and session end.
  No migration or permission codes were delivered.
- **57-1c / #784**, commit `68e3e360`: identity PIN step-up and open/touch/close HTTP routes;
  session guard private-view marker; origin check before touch; `PRIVATE_VIEW_EXPIRED`; remaining-time
  headers; contracts, OpenAPI and both clients; redaction and guard/window tests. MY-09 and MY-13b
  cover missing/dead/expired credentials and windows, including the killed-tab case. MY-10 covers
  lost membership after sign-in. MY-12 covers another employee's PIN and forbidden client-selected
  employee/branch/business fields. The plan explicitly assigns MY-11 to 57-1a and read-transaction
  employee/eligibility rechecks to 57-2 and 57b-1.

## Remaining work in this PR (57-1a)

1. Four D-A4 own codes in the access catalog, defaults for all 13 human system roles, bilingual
   names, device-forbidden policy and inventory tests. Provisional custom migration **0210**,
   after main's highest migration 0207 and 50-2b's reserved 0208/0209; do not change merged migrations.
2. D-A5 ADR-0027 addendum explicitly enabling the four capabilities and closing its deferral.
3. Reuse `evaluateAccess`, `readAccessTransaction` and owner protection, with refusal tests for
   missing/mismatched own identities, scoped DENY, foreign scope, expired membership/override,
   owner immunity without ownership bypass, and historical device ALLOW suppression. Re-run
   the existing private-view tests for the MY-09/MY-10/MY-12 guard obligations already delivered.

No new attendance/work/ratings/commission endpoint or speculative unused authorization facade is
introduced. The existing plan's split is preserved: each future endpoint must recheck the live
employee, link, employment dates, dated branch attachment, membership, own permission and feature
inside its caller-owned read transaction using one sampled Clock. `personalEmployee` alone is
insufficient for that obligation. Astra high design advice confirmed these boundaries and the
existing ownership evaluator; its proposed facade remains an option for the first consuming API.

## Reads, overlap and migration lane

The governing documents, pipeline skill, spec 060, ADR-0027 (including its addenda), ADR-0026,
and `plan-57-1.md` were read in this session in bounded batches, including re-reading truncated
sections. Owner-decisions §§55–61 are on this checkout; §§62–63 were inspected from open #842.
The user's PP-125 model instructions and no-merge restriction govern this session.

`gh pr list --state open --limit 100 --json number,title,files` returned only #842 at refresh.
Its process-document paths do not overlap this PR's planned catalog/defaults, migration, labels,
tests or ADR-0027 paths. 50-2b holds the final migration lane by the manager's instruction;
private build/testing is authorized. At 14:03 the manager accepted the refresh, reserved 0208/0209
for 50-2b, assigned this slice **0210**, and explicitly authorized pushing/opening its PR before
50-2b merges. The original proposed 0208 was replaced before any push. The final merge order
and any later renumbering remain with the manager; whichever slice merges second regenerates
against main when instructed.

No new table, RLS policy, SQL privilege grant, external service or server change is required. The migration only
adds four reference permissions and 52 global role-default links, preserving custom roles and
personal overrides. Local gates and guards, then an independent read-only Astra high review,
precede the initial PR push. The first lane startup refused because the worktree had no `.env`.
Under the manager's 14:03 authorization, a worktree-local `.env` was generated from `.env.example`
only, replacing secret/password values with independent fresh random bytes. `git check-ignore .env`
confirmed it is ignored. No existing `.env` was read or copied, and the new file is never staged.
