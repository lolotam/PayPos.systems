# 42-4a delivery evidence

## Authorization and ownership

PP-120 authorizes this existing task session to manage and implement the residual TD-13 work on Codex
`gpt-6.1-sol`, reasoning `medium`. It does not change the default implementer. The manager retains merge.
No migration, deployment, package-sale reader/export, service-line guard, contract or generated OpenAPI file changes.

### PP-121 — trial planning lane correction

Direct owner decision relayed from Waleed's speed-analysis session, source time **2026-11-04 23:50 Kuwait**:
**«الخطة تتكتب على Codex sol»**. For the three PP-120 trial sessions (42-3, 42-4a, 43-1b), this replaces the
Opus-high documentation lane. This same Codex `gpt-6.1-sol` medium session owns writing and updating the #506 plan.
No new Opus or Claude request, and no Claude fallback, is permitted in those trial sessions without Waleed's approval.

The only owned Claude task was the Opus documentation plan listed below. Its completion was already reported before
PP-121 was relayed here; **no live Claude task needed cancellation**. Its historical receipt is preserved, not
misrepresented as cancelled. Completed design/review receipts and passed implementation remain valid historical
evidence; the routing correction does not require discarding or repeating them. Current-head CI and five-reviewer
collection continue under PP-119.1, and merge remains with the manager.

Base inspected and fetched: `f7b6f9ef5a91364ab9187f3185ae1e258b6028ef`. Existing `RequireAny` from merged #468 is reused.
Live #506 was OPEN and described the target/grants transaction split. The live roadmap and decisions API were read;
both owners' PK-Q17 picks still allow reception to see the full package projection. No settled question was reopened.

## Planning receipts

- Opus documentation plan: `claude-opus-5-5`, high,
  task `node:delegated-task:command%3Amcp%3A411d9858-97f9-4382-ba7c-0e99b04a1c00%3Adelegate-task%3A0de5ab78-1c69-4f60-ae5f-602314abe460`, completed.
  The planner disclosed incomplete governing-document reading and no GitHub access; those are not passed gates.
- Independent read-only Astra design: `gpt-6-astra`, high,
  task `node:delegated-task:command%3Amcp%3A411d9858-97f9-4382-ba7c-0e99b04a1c00%3Adelegate-task%3A0692b3ed-662f-4c10-bea8-f9f69860db19`, completed.
  Confirmed #506 and recommended one tenant transaction including the shareable feature read, preserving evaluator,
  owner protection, membership descendants and permission-before-feature refusal.
- Manager personal plan review: [receipt](42-4a-manager-plan-review.md), 2026-11-04 23:43 Kuwait.
  Its corrections were applied to [the plan](42-4a-plan.md) before production edits. The parent completed the
  disclosed governing-document verification, including full spec 058 and relevant owner answers.

## Local validation

The worktree owns `pospay-test-sol-42-4a` on `127.0.0.1:55444`. Tests use the repository's migrated template and
per-spec clones on that cluster. Existing test Redis uses the harness's isolated key prefixes.

- `pnpm install --frozen-lockfile --ignore-scripts`: passed. Library build prerequisites restored through
  `pnpm exec turbo run build --filter=@pospay/api^... --concurrency=2` (10 cached tasks).
- Baseline `pnpm --filter @pospay/api test src/modules/identity/__tests__/require-any-guard.spec.ts`:
  failed as expected on the feature transaction count (3 instead of 1). The first run also exposed a synthetic
  probe returning text to a JSON-only harness; the probe was corrected. An earlier attempt could not resolve
  unbuilt workspace package `@pospay/ids`, before restoring the build prerequisites.
- `pnpm typecheck`: passed, 29 tasks, 124.97 seconds. The repository task graph also builds POS as a prerequisite.
- `pnpm lint`: passed, 30 tasks, 38.204 seconds. Boundaries are included. Earlier iterations caught missing JSDoc
  parameters, a long guard method and non-null assertions, all corrected. The first concurrent root lint/typecheck
  attempt collided in their shared POS build output; subsequent commands ran sequentially. Cached build logs can
  replay that earlier error text; the recorded result here is the final command's exit status.
- `pnpm lint:docs`: passed, 0 errors and 29 existing warnings.
- `pnpm module-map:check`: passed.
- Focused four-file run: 79 tests passed in 45.98 seconds.
- Focused eleven-file run: 179 tests passed in 300.06 seconds. Files: `require-any-guard.spec.ts`,
  `require-any-declarations.spec.ts`, `access-guard.spec.ts`, `deleted-company-guard.spec.ts`,
  `permission-holder-protection.spec.ts`, `permissions-screen.spec.ts`, `role-default-grants.spec.ts`,
  `branch-access-batch.spec.ts`, settings' `staff-columns-read-access.spec.ts`, `route-declarations.spec.ts`,
  and shared `require-any.spec.ts`. Command: `pnpm --filter @pospay/api test` followed by these paths under `src/`.
- Final focused rerun of the two new specs and changed role-default spec: 42 tests passed in 105.08 seconds.
- Guard passes: production changes reviewed with clean-code-guard; test changes with test-guard; plan, ADR and
  receipts checked with docs-guard. No unresolved defect identified in these parent checks.

## Remaining delivery gates

At the initial evidence commit, independent implementation review, PR CI and the five GitHub receipts were pending.
Independent Astra implementation review subsequently returned **PASS, round 1/5**, on exact commit
`4476b51f409cf71b4a8f4e2470d7af87440ec1ac` against `f7b6f9ef5a91364ab9187f3185ae1e258b6028ef`, with no defects;
task `node:delegated-task:command%3Amcp%3A411d9858-97f9-4382-ba7c-0e99b04a1c00%3Adelegate-task%3A11bc32ce-04b8-40db-9ccc-ccb5fe105917`.
The review was read-only and ran no tests. PR #835 is collecting CI and external receipts on that head.
Codex GitHub review completed on that exact head with no findings: [state summary](https://github.com/lolotam/PayPos.systems/pull/835#issuecomment-6642201418)
and [review receipt](https://github.com/lolotam/PayPos.systems/pull/835#issuecomment-6642262826), verified directly.
At that initial Codex verification the four MergePilot panel receipts were still absent and CI was still running;
the local PP-121 audit update was not pushed ahead of those receipts.
No review finding is waived. PP-119.1 requires complete bot receipts before a consolidated correction push,
within the five-round cap. Full API/integration/build/image coverage remains on CI per PP-113.

## Consolidated correction round 1

All four rows of [MergePilot panel 5776062193](https://github.com/lolotam/PayPos.systems/pull/835#pullrequestreview-5776062193)
completed on `4476b51f409cf71b4a8f4e2470d7af87440ec1ac`. Combined with the Codex receipt above, all five reviewers
completed before this correction. There was one published finding, [4473549603](https://github.com/lolotam/PayPos.systems/pull/835#discussion_r4473549603),
MEDIUM, supported by the security and owner-rules bots; the second bot's count refers to the same deduplicated finding.

The finding is accepted: feature SQL was awaited before permission evaluation. A real invalid stored feature boolean
reproduced an unauthorized request receiving 500 `INTERNAL_ERROR` instead of 403 `FORBIDDEN` (focused baseline failed,
61.26 seconds). The correction passes a synchronous pure permission callback from the use case into `accessAt`.
The adapter supplies target/grant data only, evaluates that callback before any feature SQL, then reads the feature
on the same transaction only after permission succeeds. No business evaluator moves into persistence, no raw `Tx`
reaches the use case, and no database error is caught to continue querying an aborted transaction. Permitted requests
still expose feature infrastructure failures as 500 `INTERNAL_ERROR`, rather than a false `FEATURE_DISABLED`.

The manager directed this correction in the same Sol medium session, without a new delegate or Claude task.
The earlier Astra PASS remains evidence for `4476b51f` only; no fresh Astra review is claimed for the correction.
Fresh local checks and new-head external receipts are recorded when available. This one correction push also includes
the pending PP-121 plan/audit update. Merge remains with the manager.

Correction validation before the consolidated push:

- Focused eleven-file suite listed above: **180 tests passed**, 254.88 seconds, including the real PostgreSQL
  feature-query-error regression. Denied permission returns `FORBIDDEN` without feature SQL; permitted permission
  reaches the broken feature query and retains `INTERNAL_ERROR`. Both paths retain one tenant transaction.
- Final `pnpm typecheck`: passed, 29 tasks, 49.058 seconds.
- Final `pnpm lint`: passed, 30 tasks, 29.332 seconds. An earlier correction lint caught a 61-line test and missing
  nested JSDoc parameter entries; both were fixed before these final checks.
- Final changed `role-default-grants.spec.ts` rerun after extracting its test helper: **20 tests passed**,
  118.54 seconds.
- `pnpm lint:docs`: passed, 0 errors and 29 existing warnings. `pnpm module-map:check` and `git diff --check`: passed.
- New-head CI, five external reviewers and exact-head internal correction review remain pending; the initial
  Astra receipt is not represented as covering this new diff. No new delegate was requested.

## Trial measurements

The durations above are actual runner receipts. Token usage and monetary cost are not exposed by the current
tool results and are not estimated. No provider/model substitution occurred. Overall session duration includes
planning and manager-review waits; no claim is made that test durations equal total implementation effort.
