# 42-3b — dependency and ownership refresh

This is the Step 1 record required by the 42-3b brief: the plan's identity and tenancy
changes are re-checked against the merged 42-4a work before any code is written. Nothing in
this document claims implementation, CI or merge.

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
