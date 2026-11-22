# Quickstart for the implementer: 61-2a + 62-2e

Read `spec.md`, `plan.md`, `contracts/api.md`, `data-model.md` and `research.md` §2 before writing code.

## 1. Start

- Work in a worktree cut from `origin/main` at `cf70114e2cbe9efcb2b5dc4d327f2c82f87d54b3` or later. Confirm with
  `git rev-parse --show-toplevel` and `git merge-base --is-ancestor cf70114e2 HEAD` before any write.
- This planning folder was written in a checkout that is older than the pin. Copy the folder into the new branch;
  do not merge the old branch.
- Apply `pending-deltas.md` §3–§4 and the port-table rows of §2 first (documents). The `reads` lines of §2 go in
  the same commit as the adapter they name, followed by `pnpm module-map:generate`.
- Do not read `.env*`. Do not use `git stash`. Do not reformat files outside the plan's list.

## 2. Database

- Use a private cluster for this lane: `node scripts/test-db/lane.mjs up <lane>` (build `@pospay/db` first, as the
  repo's lane notes say). One suite at a time per cluster.
- Build and test the migrations with provisional numbers (next free after the tail on your base).
- Generate with `pnpm db:generate employee-document-number`, then add `SET LOCAL lock_timeout = '5s'` and the
  `NOT VALID` suffix as migration 0194 does; create the second file with
  `pnpm db:generate employee-document-number-validate --custom` and put the `VALIDATE CONSTRAINT` statement in it.
- The final renumber and regenerate happen only after the manager says the migration lane is yours.
- Never run a migration against staging or any shared database.

## 3. Local gates (PP-113: heavy suites run in CI only)

Run from the repo root; all must exit 0 before reporting.

```text
pnpm typecheck
pnpm lint
pnpm lint:docs
pnpm format:check
pnpm module-map:check
pnpm migration-chain:check
pnpm contracts:openapi
pnpm --filter @pospay/admin api:check
pnpm --filter @pospay/pos api:check
pnpm --filter @pospay/menu api:check
```

Run the focused validation with the private Postgres lane from §2. The remaining slice suites are listed in `plan.md`
§6. The full API suite and Playwright run in CI.

```text
pnpm --filter @pospay/api exec vitest run --no-file-parallelism src/modules/customers/__tests__/own-rating-summary-http.spec.ts src/modules/staff/__tests__/employee-document-numbers-http.spec.ts
pnpm --filter @pospay/admin exec vitest run src/notifications/ui/document-number-bell.spec.tsx src/staff/api/employee-document-refresh-access.spec.tsx src/staff/ui/employee-document-form.spec.tsx
```

The personal session receives the rating summary. An authenticated Admin session receives `401` on that route.
For a valid document lookup, an authorized reader sees only current numbered documents. An authorized lookup with
no matches returns an empty list, and an inaccessible or missing business returns the same `404`. Invalid query
shape returns `400` before document access evaluation. The Admin specs verify that an older document response stays
visible, uploads remain pending until the document refresh completes, and the bell falls back after access is lost.
If `api:check` fails, run `api:generate` in that app and commit the regenerated `schema.d.ts`.

Report: «implementation complete, pending `ci-gate`». The slice is done only when `ci-gate` is green on the exact head.

## 4. What the independent reviewer checks first

1. The summary route: personal session only; authority before the column gate; no subject from the client; one
   transaction; `no-store`; strict response; the column gate file untouched.
2. Month window: bare `submitted_at` compared to bounds; business timezone; both boundaries tested.
3. The number never leaves `employee_documents` except through the two permission-checked reads: search the diff for
   `document_number` in `events/`, `appendOutboxEvent`, `appendAuditLog`, `safe_parameters`, logger calls, the `POST`
   response type and anything under `apps/worker`.
4. The lookup: access decided before any document row is read; one refusal for shape-valid requests to missing or inaccessible businesses; business, tenant,
   current-document and live-employee predicates all present; id count bounded.
5. Admin: numbers are not cached after the panel closes; the bell falls back to today's text on every failure.
6. Migration: expand only, nullable, no backfill, `NOT VALID` then `VALIDATE` in a second file, no grant change.

## 5. Token counters

Take three snapshots of the CLI's own counters (input, output, reasoning, cache read, cache write): before writing
any code, after implementation and tests, after the guard skills. Report the two deltas and the total. If the CLI
does not expose a counter, write «unavailable» and the command you tried.
