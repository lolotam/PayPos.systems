# Quickstart: validating a part of the statements chain

For an implementer or reviewer in a worktree of this repository. Commands are run from the repository root.

## Prerequisites

1. Confirm the worktree: `git rev-parse --show-toplevel` prints this worktree's path, not the main checkout.
2. A private Postgres for this worktree, never the shared one: `node scripts/test-db/lane.mjs up <lane>`; stop it with
   `node scripts/test-db/lane.mjs down <lane>`. One lane per worktree; database tests run one file at a time per
   cluster. The `.env` is generated locally from `.env.example`, never copied from another worktree
   (`docs/runbook.md`, the test-database section).
3. Build what the database package depends on: `pnpm --filter "@pospay/db^..." build`.

## Local gates (CLAUDE.md §1 step 3, PP-113)

```text
pnpm --filter <touched package> typecheck
pnpm --filter <touched package> lint
pnpm lint:docs
pnpm module-map:check
pnpm migration-chain:check          # only when the part has a migration
pnpm contracts:openapi              # only when a contract changed, then:
pnpm --filter @pospay/admin api:check
pnpm --filter @pospay/pos api:check
```

The part's own tests, scoped:

```text
pnpm --filter @pospay/api exec vitest run src/modules/commissions --maxWorkers=1 --no-file-parallelism
pnpm --filter @pospay/worker exec vitest run src/modules/commissions
pnpm --filter @pospay/db exec vitest run src/__tests__/<file>.spec.ts
```

The full `pnpm check`, the API shards and the Playwright suite run in CI only. A part is reported as «implementation
complete, pending `ci-gate`», and is done only when `ci-gate` is green on the exact head.

## What proves each part

| Part | Proof |
| --- | --- |
| 55-2f-0 | the worker commission suite passes with no assertion changed |
| 55-2f | pure oracle tests, then CM-52, CM-52b, CM-52c |
| 51-1 | builder unit tests, CM-34e, CM-R11; then CM-27…CM-29, CM-33 (generate part) |
| #486 | validator units; the data step run twice gives the same rows; the CHECK refuses the role |
| 52-1 | CM-30…CM-33d, CM-33c |
| 53-1 | ADR-0012 groups 1–4 and 7 |
| #1032 | the three false-coverage cases never print `COVERED` |
| 53-2 | CM-34…CM-38b and ADR-0012 group 5 |
| 53-3 | CM-36 with barriers; component tests on visible outcomes |
| 54-1 | CM-40…CM-42; rounding units |
| 56-1c, #716 | CM-55d, CM-55e; an export of a paid statement for every method |
| 56b-1 | CM-57, CM-57b, CM-57c, CM-58, CM-58b |
| 62-2c | RT-26 and the off-switch cases |

## Failure paths worth running by hand

- Approve while a counted event has no consumer mark: expect 409 `COMMISSION_UPDATES_PENDING` and no frozen row.
- Repair with no open `NO_PLAN` block: expect 422 `COMMISSION_REPAIR_NOT_ALLOWED` and no version stored.
- Run the coverage report with a business of another company: expect `COMMISSION_COVERAGE_SCOPE_INVALID` and a
  non-zero exit.

## Not validated here

Nothing in this guide deploys. Staging migrate and deploy, the per-company coverage run that opens approval, and any
production step are separate decisions (plan.md _Three states_).
