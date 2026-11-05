# 43-1 pre-lane candidate verification

Checkpoint: 2026-11-05 00:53 Asia/Kuwait. Implementation remains local and
unnumbered. This receipt certifies the candidate below, not a future generated
migration, CI, GitHub reviews, merge or deployment. Internal Astra code review
was still pending at this checkpoint. Subsequent round 1 requested changes;
see `astra-43-1-code-review-receipt.md` for the P2 correction, focused rerun,
incomplete-review reading gate and preserved one-of-five cycle counter.

## Isolation and exact candidate

- Container: `pospay-test-sol-43-storage-121`, image `postgres:16-alpine`.
- Binding: `127.0.0.1:55445`; owning worktree label matches this checkout.
- Fresh volume: `111e76cc60b5ce8386794cb245d4c8f96993ab39ba9a0488f487ba2d2e67c9cb`.
- Candidate: `43-1-candidate.sql`, SHA256
  `AA22FB41D40A0344357004C64932C694235B1D0FD9CB96330349E3C8BB654D97`.
- Start command: `node scripts/test-db/lane.mjs up sol-43-storage-121 --port 55445`.
  The first attempt refused the missing local `.env`; the existing main checkout's
  ignored environment was copied locally without displaying secrets, then startup
  succeeded. No shared cluster was used.

`packages/db/vitest.redemption-candidate.config.ts` selects the task-local
`test/redemption-candidate-setup.ts`. Before any baseline bootstrap it verifies
the host, port, Docker image, ownership labels, loopback binding and data volume.
It invokes the unchanged ADR0006 global setup to migrate the journalled baseline,
temporarily opens that run's private template, applies the exact candidate SQL in
one transaction, closes the template, and lets the existing harness clone it once
per spec. Fixtures are seeded only after cloning. Cleanup uses the existing
run-owned database teardown. Neither the production journal nor shared bootstrap
was changed. The same reviewed SQL is intended for the eventual migration.

## Results

- Candidate DB: **188 tests passed, 14 files**, final run started 00:52:11 and took
  **45.82 seconds**. Filters: `package-redemption`, `package-fk-indexes.spec.ts`,
  `package-storage-guards.spec.ts`, `privileges.spec.ts`, `function-inventory.spec.ts`,
  `rls-orders-service-sessions.spec.ts`, `rls-service-line-edits.spec.ts`,
  `rls-service-line-cancellations.spec.ts`, `service-line-cancellation-attacks.spec.ts`,
  `service-line-performer-change-writes.spec.ts`,
  `service-line-performer-change-checks.spec.ts`.
  Command prefix: `pnpm --filter @pospay/db exec vitest run --config vitest.redemption-candidate.config.ts`.
- Contracts: `pnpm --filter @pospay/contracts exec vitest run service-session`:
  **98 tests passed, 10 files, 1.25 seconds**. Old paid inputs, saved responses and
  event bodies remain accepted unchanged; the standalone union does not activate
  package inputs in current routes.
- DB and contracts typecheck and lint: passed. The package lint includes boundary
  enforcement. `pnpm module-map:check`: passed. `pnpm lint:docs`: **0 errors**,
  **29 existing warnings**. `git diff --check`: passed.
- No baseline-only run is claimed as candidate verification. No full local API or
  E2E suite was run (PP-113). Required current-head CI and all five GitHub receipts
  remain future publication gates.

The first DB attempt could not resolve an unbuilt `@pospay/ids`; building the DB's
workspace dependencies fixed setup. An intermediate privileges run exposed only
the newly added allowlist entries' ordering; sorting them resolved both failures.
An expanded catalog probe also found the older
`service_lines_discount_proposal_binding_fk` (0180) lacks a supporting index under
this check. That unrelated gap was reported to the manager. This slice now adds
exact coverage of `service_lines_redemption_fk`; every FK of the package tables
remains covered. No old test coverage or unrelated migration was removed.
The manager subsequently recorded that separate gap in issue
[#836](https://github.com/lolotam/PayPos.systems/issues/836); its resolution is
outside this storage PR.

## Remaining gates and trial usage

PP-122 queue remains #793, then #785, then this storage turn. No migration number
is reserved. No `db:generate`, numbering, renumbering, push, merge or deploy ran.
After explicit `lane granted`, reconcile current main, produce one snapshot and
journal entry, preserve reviewed SQL ordering, generate required contracts, then
rerun the focused checks against the actual journalled artifacts. Storage must
land before any 43-1b application work.

Observed candidate-build interval: candidate file created at 00:38:46; checkpoint
at 00:53:13, **14 minutes 27 seconds** elapsed, including test/debug work. This is
not a claim of the whole persistent session duration. The earlier Astra design
run took **548.702 seconds**. Provider token, cost and quota values are unavailable.
Authored/generated/combined additions plus deletions are measured separately in
the manager handoff; all docs and this receipt count toward the 2500 authored cap.
