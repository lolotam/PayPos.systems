# 076 F1 — correction round receipt

Source WIP: `adff11bce507cb9bceaea84bf5140f0d8cd82006`. Continued on `feat/076-f1-staff-access-2`, in its own
worktree. No PR was created. The existing history was preserved; no main push, server operation or deployment.

## Findings

API paths below are relative to `apps/api/src/modules`; auth/DB paths to `packages/auth`/`packages/db`.

“Half” means some protection existed in the starting WIP but the complete reachable path or its verification was unfinished.

| Finding | State found | Correction (files) | Test and fail-before evidence |
|---|---|---|---|
| P1-1 | Half | API `staff/queries/employee-staff-access.query.ts`, `identity/persistence/staff-access.ts`, grant use case. GET reuses `readEmployeeDetailAccess`, hides denied employees with 404, and holds no write locks. Grant authority precedes state-dependent answers. `employee-staff-access-recovery.spec.ts` tests the hidden branch and lock-free read. Write responses recheck grant authority independently of GET read authority. | Recovery test fails when the read gate is removed (API mutant). |
| P1-2 | Half | API grant/cancel use cases and `staff/persistence/staff-access-auth.adapter.ts`; DB `src/staff-access-database.ts`. `CANCELLING` commits before auth deletion; only original granter or authorized owner may cancel. Repeated cancel completes. A crashed STOPPED regrant with committed user id instead returns to STOPPED with an audit row in one tenant transaction, never calling auth deletion or detaching history; phone binding remains as changed before the crash. A locked, already-committed tenant record gates auth provisioning, so cancellation cannot be overtaken by a stale request. Recovery, races, domain policy and auth operation-state tests cover the paths. A delayed request that observes ACTIVE reuses its committed user without invoking provisioning. | Recovery/races/policy and auth users tests fail without cancellation intent/state/ownership/ACTIVE gates (API, binding, policy and ACTIVE mutants). |
| P1-3 | Half | API `staff/persistence/staff-access-rows.ts`, `drizzle-employee-update.ts`, grant/cancel adapters. Company → employee → access-record on begin, provision validation, commit and cancel; employee update takes company first. Real barrier tests overlap requests, inspect executed lock order and exercise the HTTP edit. | Barrier race test fails when begin takes employee before company (API mutant); real update overlap also passes. |
| P1-4 | Half | API grant use case and `staff-access.adapter.ts`; DB `src/staff-access-database.ts`. Pending tuple fixes phone hash, role and branch; mismatches refuse without details. Auth serializes operation id before lookup and checks existing company/phone. STOPPED regrant fixes the new tuple and approves the requested phone atomically. Locked records supply membership/audit/event values. Recovery and auth binding tests cover each refusal. | Recovery tuple test and auth company/phone tests fail with those checks removed (API and binding mutants). |
| P1-5 | Half | DB `src/operator/staging-staff.ts`; API identity `onboarding-transactions.ts`, `staff-user-auth.ts`. Onboarding and staging membership writers read the auth company marker before insert. `grantStaffMembership` itself checks both company and operation through auth. Membership integration and staging operator tests use valid target scopes so an unrelated FK cannot hide the missing check. | Membership and operator tests fail after removing each writer check (API and operator mutants). |
| P1-6 | Half | Auth `src/staff-credential-adapter.ts`, `auth-service.ts`, `staff-access-users.ts`, `config.ts`. Actual target-account filters protect Better Auth update/updateMany; create hooks protect account/session issuance. Normal-session consumption, reset consumption and two-factor enabling check the marker. Tests use valid credentials and signed live cookies, actual account updates and real reset requests. Ordinary sign-in/reset/2FA regressions remain green. | Five real-path tests fail with adapter/hooks/consumption checks removed (auth mutant); normal-user regressions pass. |
| P1-7 | Open | API `staff/use-cases/update-employee/update-employee.usecase.ts`. Link eligibility is checked only on a changed `user_id`; an access record still forbids changing that link. The real PATCH route renames ACTIVE staff, then refuses unlinking. | Real PATCH test fails with unconditional eligibility check restored (API mutant). |
| P1-8 | Open | API identity `persistence/staff-pin-transactions.ts`, `sign-in-staff-pin.ts`, `verify-discount-approver-pin.ts`. Readers carry `temporary` with the hash. Both PIN paths compare first, refuse temporary PINs and charge the same user counter. Real PIN/device/Redis tests prove refusal, no session, and two failures on the user key. | PIN sign-in and discount tests fail without temporary refusal (API mutant); Redis counter identities are asserted. |
| P1-9 | Open | API `staff/http/staff-access-activation.ts`; admin `src/staff/ui/employee-access-section.tsx`. Fastify onRequest capability gate precedes authentication and malformed body/id handling. Admin hides only NOT_READY and displays other errors. HTTP and visible UI tests cover both. | All three malformed unauthenticated HTTP methods and visible UI error test fail without their gates/error state (API/UI mutants). |
| P1-10 | Open | Worker `src/outbox/known-event-types.ts`; identity published staff-access event factory. Worker recognizes `StaffAccessGranted` without a consumer until F2. The event factory retains a literal event type so the emitted-event inventory can enumerate it. The worker spec checks acknowledgement without tenant effects. | Consumer-less acknowledgement test fails when the known event is removed (worker mutant). |
| P1-11 | Open | API staff `employee-staff-access-{guards,recovery,races,phone}.spec.ts`, identity `staff-pin-temporary.spec.ts`; auth `staff-access-{d8,credentials,users}.spec.ts`; API test fixture. Replaced mock employee edits and row-only PIN checks. Independent fixtures, real HTTP/device paths, injected failures at all three grant stages, PIN/outbox replay comparisons, barrier concurrency, specific RLS denial and real credential hooks now assert behavior. Both phone-owned cases preserve an actual holder PIN and signed sessions and capture secret-free API logs; row fingerprints prevent a failing comparison from printing session tokens. | Independent fixtures and real paths detect the above removed protections; crash triggers, replay hashes/outbox, 42501 RLS and holder fingerprints assert behavior. |
| P2-1 | Indexes fixed; EXPLAIN open | DB `schema/staff-access.ts`, migration 0251; API identity `staff-access-membership.spec.ts`. Commit `36d57bd1c` already had both FK indexes. Regenerated 0251 retains them. The production state query is reused by an EXPLAIN ANALYZE test on 1,500 independent rows; it checks the employee index and result shape. | EXPLAIN ANALYZE on 1,500 independent rows uses the production query/index; pre-existing index fix is not claimed as a new runtime correction. |
| P2-2 | Open | API staff split ports/row reader, auth config/service split, API bootstrap split, contracts shared projection. Shared row projection, common employee/record lock reads, no duplicate auth input validation or unused facade options. Split auth configuration and API bootstrap by responsibility. Lint/function-size and whitespace gates cover the final files. | 37-task type/lint gate and explicit size assertion: 60 authored TS files, maximum 290 physical lines; F1 diff whitespace clean. |

No listed finding was dismissed. The manager corrected the overbroad P1-11 wording: staff eligibility is true,
attendance device access false for `staff`; both true for `reception`/cashier. Staff permissions were not widened.
The exact manager statement is retained in `owner-questions.ar.md` §د.

## Merge and generated artifacts

Initially merged main `a062297d968310bd2fd1b87a68705980c4b77016`. Its conflict files were
`meta/0248_snapshot.json`, `meta/0249_snapshot.json` and `meta/_journal.json`. Main versions were taken and
Drizzle regenerated the new schema and custom migration. Handwritten registries retained both sides.
OpenAPI, all three clients and module-map YAML were regenerated from main plus this feature.

- Final provisional migrations: `0251_2026-11-24_staff-access-schema.sql`, `0252_2026-11-24_staff-access-rls-and-seed.sql`.
- Final freshness merge: main `0f5b3bfb942d2ad5baed82c8840f18c990fef52a` added commission coverage migration 0250.
  Only new conflicts were `meta/0250_snapshot.json` and `meta/_journal.json`; main versions were taken and
  Drizzle regenerated 0251/0252 after removal of the previous F1 SQL/snapshot/journal entries. The schema
  SQL is byte-identical after renumbering too. All generated OpenAPI/clients/module-map YAML were again
  taken from main and regenerated; handwritten application bindings, exports and privilege inventories
  retained both sides. The new commission approval binding is preserved in the split API bootstrap.
- ADR: `0063-staff-access-and-invitations.md`; 0063 was unoccupied on the merged main.
- RLS/seed body is byte-identical before/after renumbering. Both git object hashes:
  `3b2f98cdde643d668adb237062c6ba452beec7cd`.
- ADR documents `platform_audit_log.details.user_id`, the NULL target FK and the accepted application DELETE
  grant. The privileges test retains the DELETE allowlist coverage.

## Self-review

Clean code: removed dead facade methods and duplicate projections/lock readers; kept SQL/crypto in adapters,
role policy in identity, injected clock/ids and Arabic domain/port/event documentation.

Test quality: replaced mocks that hid the real update route, unsigned-cookie probes, impossible PIN hashes,
order-dependent RLS seeds and permissive same-operation PHONE_TAKEN assertions. Failure injection operates at
real auth or SQL boundaries; barriers keep concurrent requests alive at a known stage.

Security: traced GET/grant/cancel authorization, auth markers at credential issuance/consumption, every
membership writer, tenant RLS/grants, cancellation/replay races and the phone/PIN/audit/event/log boundaries.
This was a focused local correction review, not a production, infrastructure or dependency advisory audit.

## File-size ruling

The owning manager explicitly limited P2-2 to F1-authored files and allowed inherited registries/bootstrap,
fixtures and specs already over 300 on main. No F1 addition may newly cross 400. The rulings are recorded
in `owner-questions.ar.md`. The later owner relaxation accepts 300–400 lines, retains the ESLint hard
limit and existing splits, and forbids further splitting solely to get under 300. No additional size-only
splits were made after that instruction.

All 60 newly authored TypeScript files are at most 300 physical lines; largest: `staff-access.adapter.ts`,
290. Inherited exceptions (physical lines, including blanks/comments):

| File | Main | Final |
|---|---:|---:|
| `apps/api/src/main.ts` | 361 | 362 |
| `apps/api/src/modules/identity/__tests__/access-guard.spec.ts` | 381 | 391 |
| `apps/api/src/modules/identity/identity.module.ts` | 329 | 334 |
| `apps/api/src/modules/staff/staff.module.ts` | 403 | 402 |
| `apps/api/src/shared/__tests__/session.spec.ts` | 313 | 323 |
| `apps/api/src/shared/errors.ts` | 415 | 414 |
| `apps/api/test/harness.ts` | 441 | 447 |
| `packages/db/src/__tests__/role-defaults.spec.ts` | 397 | 398 |
| `packages/i18n/src/ar.ts` | 370 | 375 |
| `packages/i18n/src/en.ts` | 376 | 383 |

`packages/contracts/src/index.ts` was restored byte-for-byte to main (403 lines): its existing staff barrel
already exports `StaffAccessStateRow`. F1 controller/type imports now come from `staff-access.providers.ts`,
keeping `staff.module.ts` at 402 versus main 403. The harness was already above 400 on main and is a fixture;
no previously-under-400 file crosses 400 because of F1. These are physical counts; ESLint applies the
project exclusions and blank/comment counting rules. Its configured hard limit passes. Unrelated inherited
code was not refactored.

## Final receipts

Runtime checkpoint: `c8f89575e9d175102e5715e162eb6bd8e0d316f9`, after the final main merge.
The receipt commit adds documentation only. All final command groups passed with zero failed/skipped tests.

Restored-source commands (all database specs use only the owned `f1b-076` lane on 55414 and
`REDIS_PORT=56414`; file parallelism disabled):

| Command | Result |
|---|---|
| `pnpm turbo run typecheck lint --filter=@pospay/db --filter=@pospay/auth --filter=@pospay/contracts --filter=@pospay/api --filter=@pospay/worker --filter=@pospay/i18n --filter=@pospay/admin` | 37/37 tasks passed; 27 inherited admin warnings, zero errors |
| `pnpm lint:docs` | zero errors, 28 existing warnings |
| `pnpm module-map:check` | passed |
| `pnpm migration-chain:check` | passed |
| `pnpm --filter @pospay/admin api:check` and equivalent `pos`, `menu` commands | 3/3 passed |
| `pnpm --filter @pospay/contracts test` | 106 files / 1,512 tests; node-export check passed |
| `pnpm --filter @pospay/db exec vitest run --no-file-parallelism src/__tests__/staging-staff.spec.ts src/__tests__/privileges.spec.ts src/__tests__/staff-access-defaults.spec.ts src/__tests__/role-defaults.spec.ts` | 4 files / 1,255 tests passed |
| `pnpm --filter @pospay/auth exec vitest run --no-file-parallelism` | 24 files / 231 tests passed; zero failed |
| `pnpm --filter @pospay/api exec vitest run --no-file-parallelism` with the exact paths below | 12 files / 64 tests passed; zero failed |

Supplemental final replay:

| Command | Result |
|---|---|
| `pnpm --filter @pospay/worker exec vitest run --no-file-parallelism src/outbox/__tests__/known-event-types.spec.ts` | 1 file / 15 tests passed; zero failed |
| `pnpm --filter @pospay/api exec vitest run -c vitest.unit.config.ts` | 160 files / 2,606 tests passed; zero failed |
| `pnpm --filter @pospay/admin exec vitest run src/staff src/shared/api/staff` | 124 files / 855 tests passed; zero failed |

The final phone-only replay passed 1 file / 2 tests, verifying token-safe row fingerprints separately.
The STOPPED regrant cancellation reproduction failed before its fix (HTTP 500 after CANCELLING); the two approved before-auth
and after-auth crash regressions then passed 2/2, including successful corrected grants afterwards. This is
additional real pre-fix evidence, separate from the 29 deliberately mutated failing assertions.

API selection: staff `employee-staff-access-{grant,state,guards,recovery,races,phone}.spec.ts`, identity
`staff-pin-temporary.spec.ts`, `staff-access-membership.spec.ts`, `access-guard.spec.ts`, staff
`update-employee-user-link.spec.ts`, `update-employee-locks.spec.ts`, and shared `session.spec.ts`.
Each file executed serially; the full API integration suite was never run locally.

```sh
pnpm --filter @pospay/api exec vitest run --no-file-parallelism src/modules/staff/__tests__/employee-staff-access-grant.spec.ts src/modules/staff/__tests__/employee-staff-access-state.spec.ts src/modules/staff/__tests__/employee-staff-access-guards.spec.ts src/modules/staff/__tests__/employee-staff-access-recovery.spec.ts src/modules/staff/__tests__/employee-staff-access-races.spec.ts src/modules/staff/__tests__/employee-staff-access-phone.spec.ts src/modules/identity/__tests__/staff-pin-temporary.spec.ts src/modules/identity/__tests__/staff-access-membership.spec.ts src/modules/staff/__tests__/update-employee-user-link.spec.ts src/modules/staff/__tests__/update-employee-locks.spec.ts src/modules/identity/__tests__/access-guard.spec.ts src/shared/__tests__/session.spec.ts
```

The first final API replay had 58 passes / 4 failures: a duplicated employee number in the added ACTIVE
race fixture, corrected to an independent number, and three PIN-grant HTTP 500 responses without captured
cause. PIN+races then passed 7/7 in isolation; the complete 12-file replay passed 62/62. Those three 500s
were not reproduced and no unproven runtime fix is claimed. The final post-merge replay passed 64/64,
including both added STOPPED cancellation regressions. Diagnostics now emit only safe symbolic/error
codes and SQLSTATE, rather than raw response or log bodies.


Mutation checks deliberately removed the relevant protection, ran selected behavioral tests, required nonzero
exit with a matching failing assertion, and restored the exact saved source bytes in `finally`. No mutation
was committed. API: 15 failures across P1-1/2/3/4/5/7/8/9; auth binding: four failures across non-PENDING,
company and phone mismatch; the delayed ACTIVE race: one failure; staging exclusivity: one failure.
The other removed protections produced five auth D8 failures (including reset consumption), one worker acknowledgement failure, one visible-UI failure and one cancel-policy failure: 29 failing assertions in total. These are intentional mutant failures, not failures in the final restored source.

The starting FK-index correction was already present, so no fail-before claim is made for that prior code.
P1-11 improves the strength of the same behavioral regressions rather than adding a runtime rule.

## Whitespace and inherited main changes

`git diff --check origin/main..HEAD` passes. The broader requested baseline comparison
`git diff --check 98bd2048f..HEAD` reports inherited EOF blank lines from main:
`apps/admin/app/(dashboard)/_frame/approvals-route.spec.tsx:158` and
`apps/admin/app/(dashboard)/_frame/menu/carried-hide-conditions.spec.tsx:361`.
The final freshness merge adds the inherited EOF blank in
`apps/api/src/modules/commissions/__tests__/approve-statement.usecase.fixture.ts:205`.
Their HEAD/main blob hashes are identical (`61caec078f8e46b927c41cca7f709530b832196a`,
`1f7ba2e1fac8396f7cd3eb793d271587928a1a64`, and `04ce939af91314c77f6351566ce5e0eaa8e1c769`). They were not reformatted under the manager's scope ruling.

## Handwritten diff size

File-level additions plus deletions, with documentation, tests and reviewed/mixed SQL included.
Excluded generated files: OpenAPI JSON, the three `schema.d.ts` clients, `docs/module-map.yaml`, migration
`meta/**`, lockfiles, and the entirely generated 0251 schema SQL. Handwritten RLS/seed 0252 is included.

- Requested `98bd2048f..HEAD`: 512 files; +30,431 / -3,259; **33,690 changed lines** (15 generated files excluded).
- Feature-only `0f5b3bfb942d2ad5baed82c8840f18c990fef52a..HEAD`: 118 files; +7,396 / -526; **7,922 changed lines** (9 generated files excluded).

The requested baseline range includes changes merged from main; feature-only size separates those inherited
changes. Counts include this receipt. They count changed lines (additions + deletions), not net growth.

## Resource handoff

The owned test lane remains available for review: `pospay-test-f1b-076` on `127.0.0.1:55414` and
`pospay-test-f1b-076-redis` on `127.0.0.1:56414`. Both ownership labels match this worktree. All test commands
have completed. Local helpers and JSON receipts are preserved as ignored `.log` artifacts; they are not
part of the branch. No worktree, test volume, production resource or secret was removed or copied.

## Remaining authority

The activation flag stays off. F2/G1/F3/G2, production/staging deployment, CI/reviews and any owner merge card
are outside this implementation handoff. No remote CI or PR review result is claimed by local test success.
