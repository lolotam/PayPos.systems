# 42-3b — dependency and ownership refresh

This is the Step 1 record required by the 42-3b brief: the plan's identity and tenancy
changes are re-checked against the merged 42-4a work before any code is written. Nothing in
this document claims implementation, CI or merge.

**Current disposition (2026-11-06):** the manager approved the b1/b2 split in
[42-3b1-scope.md](42-3b1-scope.md). The original records below are preserved as history.
b1 subsequently reached a different blocker: the measured [SA-10 failure](42-3b1-sa10-receipt.md),
which requires spec review before sale delivery continues.

## Resume refresh — 2026-11-05 (PP-125)

The sections below this resume record preserve the original MiniMax refresh as history.
Their open-PR list and base are no longer current. The manager explicitly authorized
Codex `gpt-6.1-sol` to resume; MiniMax is not retried after its runtime failure.

- `git rev-parse --show-toplevel` confirmed this task's existing worktree.
- WIP `e7e95913` preserves all delivered work: 28 files, 1,576 additions and 9 deletions.
  The reported 27 status entries included a directory containing two files. No stash,
  rebase, force push or discarded delivery was used during this resume.
- Merge `4dc3bad2` incorporates `origin/main` at
  `cc085aacd013311f63ba7e5fffc7d98f11a6dcb2`, including #793, #838, #839, #785 and #841.
- The sole conflict was add/add in `tenancy/queries/package-sale-place.query.ts`.
  Both implementations had identical executable statements and signatures; only comments
  differed. The merged main version was retained byte-for-byte. Its public export and
  existing shape/isolation/EXPLAIN spec are already on main; the sale adapter reuses them.
- The three sale adapter read declarations survived in both module-map files, alongside
  main's new `session-place.adapter.ts` declaration. No import arrow was added.
- `gh pr list --state open --json number,title,headRefName,url` returned only #842.
  `gh pr view 842 --json files` confirms that it owns no sale, identity-reader or tenancy
  source file. Its governing-document edits do not change the source ownership conclusion.
- #835's guard interface and the sale's union-shaped permission reader remain separate;
  no generic authorizer or guard file was edited by this delivery.
- No migration is needed or added. Main's migrations through 0207 are inherited changes,
  not changes authored by 42-3b. The sale uses the existing package storage and permission.
- OpenAPI and both client schemas were regenerated, not hand-merged.
  `pnpm --filter @pospay/admin api:check` and
  `pnpm --filter @pospay/pos api:check` each returned exit code 0.

### Size gate: stop before completing the remaining implementation

`git diff origin/main --numstat` after the merge measures **1,875 changed lines**
(additions plus deletions, 29 files), including generated artifacts and the original
refresh record, before this resume note. This is incomplete delivery, not a passing gate.
The delivered HTTP spec has nine tests, the persistence spec three and the use-case
spec nine. Inspection found no controlled catalog/seller races, sale access-reader spec,
maximum-volume timings, or audit/outbox failure injection in those files.

Remaining coverage estimate, without deleting or compressing the delivered tests:

| Required work still missing | Estimated added/deleted lines |
| --- | ---: |
| Seller detach/relink and type/service edit races, both orders, real lock barriers | 240–320 |
| Controlled same-key commit/replay and rollback/retry; replay after catalog/month changes | 160–210 |
| Sale-reader permission/DENY/expiry/feature cases and record-reader regression | 150–190 |
| Audit/outbox/commit failure injection and complete atomic rollback assertions | 140–180 |
| SA-10: 7,300 slots, statement probes, warmup plus five timings including COMMIT | 140–180 |
| Remaining HTTP date/timezone, snapshots, customer/type/contract refusal cases | 110–150 |
| Pure audit/response mapper coverage | 100–120 |
| Resume, validation and review audit records | 60–80 |
| **Remaining estimate** | **1,100–1,430** |
| **Projected complete delivery against main** | **2,975–3,305** |

These are estimates, not executed tests or measured performance. The original brief says
to stop and report a further split when the delivery will exceed about 2,800 lines;
the manager plan review also requires stopping rather than cutting acceptance coverage.
Implementation therefore stops here pending the manager's split decision.

Recommended split for decision (not implemented or published):

1. **42-3b1: transaction internals without a registered HTTP route.** Access extraction,
   existing tenancy-reader reuse, use case, persistence, audit/event/response mapping,
   complete internal DB concurrency/rollback/performance and unit coverage. No generated
   endpoint or controller registration. Provisional inclusive estimate: 2,100–2,500 lines.
2. **42-3b2: sale endpoint activation after b1 merges.** Controller/filter/wiring,
   OpenAPI/generated clients and complete real HTTP authorization, refusal and replay
   coverage. Provisional inclusive estimate: 900–1,200 lines.

The split moves responsibility boundaries, not tests to an optional follow-up. The route
ships only after the complete acceptance matrix is verified. No second PR/session is
created by this proposal. Existing WIP remains preserved until the manager decides.

No private DB was started during this resume. Typecheck, lint, documentation/module-map
gates, focused tests, guards and Astra review remain outstanding. Governing-document
reading is not yet complete; truncated reads are not claimed complete. No PR, push,
merge to main or deploy occurred.

## 1. Base refresh

The branch `feat/p1-058-42-3b-sell-package-integration` was rebased onto `origin/main`
before any code. The starting point was `cf0e413e` (42-3a, PR #834), which predated two
merged commits:

| Commit | PR | Content |
| --- | --- | --- |
| `f5b61856` | #837 | PP-120 to PP-123 owner decisions (pipeline docs only) |
| `6bde5427` | #835 | 42-4a — the any-of access guard |

The branch now starts at `6bde5427`. No 42-3a file was rewritten by the rebase.

## 2. Re-check of the plan's identity changes against #835

42-4a changed `AccessReader.accessAt` to decide permission **before** the feature read:

```ts
accessAt(
  companyId: string,
  userId: string,
  request: AccessTargetRequest,
  options: { readonly featureFlag?: string; readonly allows: (inspection: AccessInspection) => boolean },
)
```

Files touched by #835: `identity/http/access.guard.ts`,
`identity/persistence/access-reader.ts`, `identity/ports/access-reader.port.ts`,
`identity/use-cases/authorize-request/authorize-request.ts`, plus specs and two ADRs.

**`identity/persistence/service-session-access.ts` was NOT touched by #835**, and
**`identity/index.ts` was NOT touched by #835**. The plan's D-1(a) shape therefore survives
the merge unchanged:

- extract the body of `readServiceSessionAccess` into a private
  `readBranchWriteAccess(tx, permission, companyId, userId, businessId, branchId, at)`;
- `readServiceSessionAccess` becomes a one-line wrapper over
  `record:service-sessions:branch` (behaviour-preserving; the existing 050 specs are the
  regression proof);
- `readPackageSaleAccess` is the second wrapper over `sell:packages:branch`, with the same
  union-across-covering-memberships semantics that `resolveSessionRecorder` consumes as
  `SessionAccess { record, denied, feature, membership_ids }`.

The two readers remain separate: #835's `readAccessTransaction` is the guard's
read-every-permission path inside `access-reader.ts`, while the sale needs the
role-snapshot-bearing, single-permission, union-shaped `SessionAccess` that
`readServiceSessionAccess` returns. Reusing the guard reader would change the sale's
membership semantics, so the plan's shape stands.

The plan's "not touched" list is re-verified against #835 and stays correct:
`identity/use-cases/authorize-request/*`, `identity/http/route-coverage.ts`,
`shared/access.decorators.ts` and `AccessGuard` are 42-4a files and are not edited here.
The sale route only **uses** `@Require('sell:packages:branch', { branch: 'branchId' })`.

## 3. Re-check of the plan's tenancy changes

`tenancy/queries/active-business-time-zone.query.ts` and `tenancy/index.ts` were not
touched by #835 either. The sale-specific branch-timezone reader
(`tenancy/queries/package-sale-place.query.ts`, branch timezone with business fallback)
remains an addition, not a change to the existing visit reader, so the visit semantics and
`activeBusinessTimeZone` are preserved.

## 4. Ownership check — no other open PR owns these files

`gh pr list --state open` returns exactly two PRs:

| PR | Title | Owns the 42-3b files? |
| --- | --- | --- |
| #793 | feat(commissions): plan screens' employee list API (48-2b, FR-010a) | No |
| #785 | feat(customers): 59b-2b rating-claims scheduler (DRAFT) | No |

File-by-file check of both PRs (`gh pr view <n> --json files`) against every file this slice
touches:

- Neither PR touches `apps/api/src/modules/identity/persistence/service-session-access.ts`,
  `apps/api/src/modules/identity/index.ts`, or anything under
  `apps/api/src/modules/tenancy/`. The identity and tenancy files this slice edits are
  unowned.
- #793 touches `apps/admin/src/shared/api/schema.d.ts`, `apps/pos/src/shared/api/schema.d.ts`,
  `packages/contracts/openapi/openapi.json`, `packages/contracts/src/__tests__/openapi-schema-names.ts`,
  `packages/contracts/src/index.ts`, `docs/module-map.md`, `apps/api/src/shared/errors.ts`,
  `apps/api/src/app.ts`, `apps/api/src/shared/log-events.ts`, the commissions and staff modules,
  `packages/db/migrations/0204_2026-11-04_employee-name-key-id-index.sql` and
  `packages/db/schema/staff.ts`.
- #785 touches `apps/worker/**`, `packages/contracts/src/customers/**`,
  `packages/db/schema/ratings.ts`,
  `packages/db/migrations/0204_2026-11-02_rating-requests-scheduled-index.sql`,
  `docs/adr/0010-phase-1-ports-and-events.md` and `docs/owner-decisions.ar.md`.

**Overlap that is real but not a blocker:** 42-3b regenerates
`packages/contracts/openapi/openapi.json`, `apps/admin/src/shared/api/schema.d.ts` and
`apps/pos/src/shared/api/schema.d.ts`, and adds three lines to `docs/module-map.md`. #793
also touches those generated artifacts and `docs/module-map.md`. These are generated or
append-only files, so the overlap is a merge-order item for the manager, not a parallel edit
conflict. 42-3b does not edit `packages/contracts/src/index.ts` (the sale contract already
exists from 42-1 and is re-exported through `packages/contracts/src/orders/index.ts`), does
not edit `apps/api/src/shared/errors.ts` (the package sale statuses already live in
`apps/api/src/shared/package-sale-error-statuses.ts` from 42-1/42-3a, and the sale's own
statuses are appended to that file), does not edit
`packages/contracts/src/__tests__/openapi-schema-names.ts` (it already names the sale
schemas), and adds no migration — so the `0204_*` migration paths and
`packages/db/schema/staff.ts` are untouched.

## 5. Migration check — none needed

- `package_entitlements`, `package_components` and `package_session_slots` already exist,
  created by `packages/db/migrations/0200_2026-11-02_package-storage.sql` (42-2), with
  their RLS policies, the `package_entitlements_sold_shape_check` constraint and the
  creation seal columns already in place.
- The `sell:packages:branch` permission and its role grants already exist, seeded by
  `packages/db/migrations/0201_2026-11-02_sell-packages-permission.sql`.
- The sale only **inserts** into the three existing tables. It adds no column, no table,
  no index and no policy.

**Conclusion: 42-3b needs no migration.** No migration file is added by this slice.

## 6. Result

| Check | Result |
| --- | --- |
| Branch rebased onto `origin/main` (`6bde5427`) | Done |
| D-1(a) identity extraction still valid against #835 | Yes — `service-session-access.ts` and `identity/index.ts` untouched by #835 |
| Sale-specific tenancy read still valid | Yes — #835 did not touch `tenancy/` |
| Another open PR owns the identity/tenancy files | No |
| Generated-artifact overlap with #793 | Yes — merge order for the manager, no edit conflict |
| Migration needed | No — the three package tables and the permission already exist |
| New module-map arrows | No — `orders -> identity` and `orders -> tenancy` already exist; three read lines are added |
| New ADR | No |

Work continues on Step 2 in the order the brief gives: contract → access reader/export →
tenancy read + adapter → use case → persistence + error mapper → route + wiring → OpenAPI
and generated clients → real-DB/HTTP tests.
