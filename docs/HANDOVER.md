# HANDOVER — PosPay (for Claude Code in the IDE)

> **Written:** 2026-09-23, at the end of a Claude (Cowork) session.
> **Read this first, then `CLAUDE.md`, then `CLAUDE.architecture.md`.** This file is a snapshot of *where
> the work stands*; the rules themselves live in the files listed in §2 and win on any conflict.
> Update §4–§6 of this file at the end of every session, in the same PR as the work.

---

## 1. What the project is

**PosPay** (`pospay.systems`) — multi-tenant, multi-vertical business-management SaaS for Kuwait: POS,
inventory, appointments, staff attendance & commissions, customers/loyalty, reporting. Arabic-first +
English, RTL, KWD with 3 decimals (money = `bigint` mills). Modular monolith, TypeScript end-to-end.
Solo developer (Waleed) building entirely with AI agents.

- **Repo:** https://github.com/lolotam/PayPos.systems — local clone `E:\PosPay.systems\pospay` (Windows)
- **Parent folder** `E:\PosPay.systems\` holds business docs, logos and archives — **not** part of the repo
- The repo is **public for now** (GitHub Actions minutes). Nothing secret may ever be committed. It will go private later.

## 2. Governing documents (read in this order)

| File | Answers | Wins on |
|---|---|---|
| `CLAUDE.md` | day-to-day rules for every slice | workflow |
| `CLAUDE.architecture.md` | where code goes, what it may import | structure, dependency direction |
| `docs/06_Tech_Stack_Architecture_EN.md` | which technology | technology |
| `docs/module-map.md` | allowed arrows between modules (+ §3.1 the one sync write) | module arrows |
| `docs/adr/0003-auth-rls-boundary.md` | **Accepted.** Auth ↔ RLS, DB roles, wrappers, principal, grants | anything auth / RLS |
| `docs/specs/phase-0/IMPLEMENTATION-PLAN.md` (**v4**, after `DEBATE-2026-09-23.md`) | Phase 0 tasks T0–T13, order, "done when" | Phase 0 sequencing |
| `docs/specs/phase-0/SPEC.md` (v2) | Phase 0 scope and domain model | Phase 0 scope |
| `docs/PRD.md` (v1.1) | whole product: phases, tasks P0–P6, open decisions D-01…D-34 | product scope |
| `.specify/memory/constitution.md` (v2.1.0) | spec-kit constitution | — |
| `.specify/PROJECT-OVERRIDES.md` | local changes to spec-kit defaults | — |
| `AGENTS.md` | index for Codex and other agents; review guidelines | — |

ADRs: `0001` domain/subdomain topology · `0002` workspace tooling baseline · `0003` auth ↔ RLS boundary ·
`0004` test runner (Vitest) · `0005` money rounding (half away from zero) and percentage precision (4 dp) ·
`0006` database tests on the compose Postgres, postgres.js driver, migration naming · `0007` tenant tables key on `(company_id, id)` · `0008` API stack pins, explicit `@Inject`.

## 3. How work is done here

### 3.1 The loop — one slice per branch per PR

1. `git switch main && git pull`, then `git switch -c feat/phase0-<task>-<short-name>` (or `fix/`, `docs/`, `chore/`).
2. Implement exactly one task/slice, in the order `CLAUDE.md` §1 prescribes (contract → migration + RLS → domain + tests → use case → adapters → integration tests).
3. `pnpm check` must be green locally.
4. Conventional commit; end every commit message with:
   ```
   Co-Authored-By: Claude <noreply@anthropic.com>
   ```
5. `gh pr create`. **Never push to `main` directly.**
6. **Codex reviews the PR.** It reviews automatically only when a PR is *opened*. After every later push,
   comment `@codex review` on the PR, or it will not look at your fixes.
7. Read Codex's line comments (`gh api repos/lolotam/PayPos.systems/pulls/<n>/comments`), judge each one,
   fix what is valid, push, request review again.
8. **Deferral policy (agreed with Waleed 2026-09-23):** fix every **security or correctness** finding before
   merge. Findings that are wording, consistency or later-phase details become GitHub issues linked to the
   task that will resolve them, and the PR is merged. Say which was which in a PR comment.
9. Merge with `gh pr merge <n> --squash --delete-branch`.

### 3.2 Talking to Waleed

- Reply in **Egyptian Arabic**, with English technical terms kept in English. Deployment and GitHub content stays in English.
- He is learning: explain *why*, briefly. Use a header per topic, short bullets, then a table where it helps.
- **Do not mix Arabic and English inside one running line** — put the English term and its Arabic explanation on separate bullets.
- Never guess a business rule (money, tax, commissions, stock, permissions, tenant scope, time rules). Ask, or mark `TODO(spec)` and stop.
- Before deleting anything on his machine, list it and ask.

### 3.3 Environment facts (Windows dev machine)

| Tool | Version / note |
|---|---|
| Node.js | 24 LTS (`.nvmrc`) |
| pnpm | 12.5.1 (`packageManager`). Build scripts are denied by default → `pnpm-workspace.yaml` `allowBuilds`. pnpm enforces a minimum release age; too-new pins land in `minimumReleaseAgeExclude` |
| TypeScript | **pinned to 6.0.3**, not 7 — `typescript-eslint` 8.70 supports `<6.1`. Do not upgrade until it does (ADR-0002) |
| Docker Desktop | installed under `%LOCALAPPDATA%\Programs\DockerDesktop`; must be started before `pnpm infra:up` |
| gh CLI | logged in as `lolotam` |
| Git identity | `waleed team` / `dr.vet.waleedtam@gmail.com` |
| Shell | PowerShell 5.1. Beware: it mangles UTF-8 (`§` → `Â§`, emoji) when a script edits files — write files with `[IO.File]::WriteAllText(path, text, New-Object System.Text.UTF8Encoding($false))` |

**Local infra (T2):**

```
pnpm infra:up      # Postgres 16 + Redis 7, waits until both are healthy
pnpm infra:ps      # status
pnpm infra:logs
pnpm infra:down    # stops; data volumes are kept
pnpm db:migrate    # roles bootstrap + every migration, as pospay_owner (ADR-0006 §4)
pnpm db:generate <kebab-name> [--custom]   # new migration: NNNN_<UTC date>_<name>.sql
```

`.env` at the repo root (git-ignored) was generated with random local passwords; `.env.example` lists the keys.
`MIGRATION_DATABASE_URL` is `pospay_owner` (migrations only); `DATABASE_URL` is `pospay_app`. `pnpm check` needs Docker
running and `pnpm infra:up` done — the db tests use the compose Postgres (ADR-0006).

### 3.4 Things that bite

- **`.claude/` and `.github/` are write-protected for remote/agent file tools** in Waleed's setup. If you cannot write there, prepare the file elsewhere and ask Waleed to copy it.
- **spec-kit** runs on Windows PowerShell only. Its defaults were changed (specs under `docs/specs/NNN-<module>-<use-case>/`, tests mandatory, business rules never guessed, mandatory *Slice design* section). A spec-kit refresh overwrites the skill copies — re-apply per `.specify/PROJECT-OVERRIDES.md`.
- `.agents/skills/` contains a personal skill library that is git-ignored except `speckit-*`. 186 unrelated skills were moved to `E:\PosPay.systems\_skills-archive`.
- CI (`.github/workflows/ci.yml`) runs on every PR. A `changes` job skips the heavy `check` job when only `docs/**` or `*.md` changed; the small `ci-gate` job always reports, and **`ci-gate` is the check branch protection requires** on `main` (plan v4 T12a).
- `lint:docs` fails on closing JSX comments, `FIXME`/`HACK`/`XXX`, commented-out code, and on any JSDoc in `domain/**`, `ports/**`, `events/published.ts` that has no Arabic **letter**.

## 4. Status — Phase 0

| Task | State | Where |
|---|---|---|
| T0 Auth ↔ RLS decision | ✅ done | ADR-0003 **Accepted** 2026-09-23 (PR #5) |
| T1 Workspace skeleton | ✅ done | PR #1, #2 |
| T12a Minimal CI | ✅ done — `ci-gate` required on `main`, PRs required, enforced for admins (PR #20) | `.github/workflows/ci.yml` |
| T2 Local infra | ✅ done | PR #12 — `deploy/docker-compose.dev.yml` |
| T3 `packages/domain` (Money, rounding, Percentage, TaxRule) | ✅ done | PR #14 — ADR-0004, ADR-0005 |
| T4 `packages/db` (roles, `withTenant` / `withUser` / `withNewTenant`, helpers) | ✅ done | PR #15 — ADR-0006 (+ issue #16 for T5) |
| T6a contracts | ✅ done | PR #17 |
| Plan v4 (debate with Codex) | ✅ done | PR #18 — `DEBATE-2026-09-23.md` |
| T5 tenancy schema + RLS suite | ✅ done | PR #21 — ADR-0007, closed #16 |
| T6b `apps/api` foundation | 🟡 **PR open** | ADR-0008 |
| **T7 write primitives** (next) → T7b worker + dispatcher → **T9a-1…4 → T8** → T9b → T10/T11 → T12b → T13 | ⬜ | plan v4 §2 |

**Critical path:** T0 → T1 → T3 → T4 → T6a → T5 → T6b → T7 → T7b → T9a-1 → T9a-2 → T9a-3 → T9a-4 → T8 → T9b → T12b → T13.

### 4.1 Next action — finish T6b, then T7

- T6b: get the PR through Codex (CLI + GitHub) and merge it.
- T7 per plan v4: `outbox`, `audit_log`, `idempotency_keys` (one transaction, unique-key coordination, no
  `IN_FLIGHT`), `Clock` port, UUID v7 in `packages/ids` bound to `@pospay/db`'s `IdGenerator`.
- Local dev database: its `0001`/`0002` tenancy migrations predate ADR-0007 and must be reset (drop + `pnpm db:migrate`
  + `pnpm db:seed`) — ask Waleed first; it holds only the seeded plan. Tests use cloned databases and are unaffected.

### 4.2 Package facts worth knowing

- `packages/domain` builds with `tsc -p tsconfig.build.json` to `dist/` (git-ignored) and exports `dist/index.js`
  + `dist/index.d.ts`, so a plain, unbundled Node consumer (api/worker) can import it. Turbo builds a package's
  dependencies before `typecheck` and the package itself before its `test`; `test:node` imports `@pospay/domain`
  with plain Node to catch a broken export. Relative imports in `src/` use `.js` extensions.
- `packages/domain` may import only files inside its own `src/` — a local lint rule (`kernel/own-files-only`)
  checks the resolved path, not the spelling.
- `packages/db` exports only `createDatabase`, which returns `withTenant` / `withUser` / `withNewTenant` / `close` — the
  Drizzle client stays in a closure. Its `src/` uses `.ts` import extensions (`rewriteRelativeImportExtensions`), so
  `node scripts/migrate.ts` runs the source directly with Node 24 type stripping and `tsc` still emits `.js`.
- `apps/api`: `createApp(deps, options)` builds the app (tests pass fakes and a log sink); `main.ts` wires the real
  database, Redis and config. Inject with `@Inject(TOKEN)` only (ADR-0008). Errors: add a code to
  `src/shared/errors.ts` — never inline a message. Start locally: `pnpm --filter @pospay/api build` then `start`.
- Tenancy tests (T5): `test/tenancy-fixtures.ts` seeds two companies A/B as the owner inside a cloned test database (the
  test-only exception to ADR-0003 §5.3). `privileges.spec.ts` holds the **reviewed grant allowlist** — a new table's grants
  must be added there in the same PR, or the suite fails. `pnpm db:seed` writes the provisional plan only.
- Tests that need Postgres: `createTestDatabase()` from `packages/db/test/test-database.ts` clones the migrated
  template for one spec file; connect with `appUrl` (`pospay_app`) and drop it in `afterAll`.
- `packages/contracts`: API fields are snake_case; every published schema carries `.meta({ id })` and is listed in
  `src/openapi.ts`. `pnpm contracts:openapi` rewrites the committed `openapi/openapi.json`; a test fails if it is stale.
  Decisions (Waleed 2026-09-23): names 1–255 chars, branch address free text ar/en, opening hours = intervals per
  ISO weekday (overnight allowed, no overlap), currency any ISO 4217 code — **`Money` is still 3-dp, so arithmetic is
  correct for KWD only until multi-currency**.
- A package linted from its own folder does not match the shared `packages/<name>/src/**` globs. It re-scopes
  `requireArabicJsdoc` (exported from `@pospay/config/eslint/jsdoc`) to `src/**` — see `packages/domain/eslint.config.js`.

## 5. Open items

### 5.1 GitHub issues (deferred per §3.1 step 8)

| # | Topic | Must be closed before |
|---|---|---|
| #6 | `/speckit-implement` must not start while a business-rule checklist item is open | first `/speckit-implement` |
| #7 | Align the spec path in the constitution and PRD with `docs/specs/NNN-<module>-<use-case>/spec.md` | first `/speckit-specify` |
| #8 | `/speckit-implement` must run `pnpm check` before reporting done | first `/speckit-implement` |
| #9 | **D-34** — Waleed to confirm platform-only company creation | end of T9a |
| #10 🔒 | Carry `role_permissions.constraints` in `Grant` | P2-T7 |
| #11 🔒 | Offline operator credential for POS PIN actions | P2-T9 |

### 5.2 Open product decisions

The full list is `docs/PRD.md` §11 (D-01…D-34). Those that block Phase 0 tasks:
D-02 (legal check on "Pay" in the name → invoice header, T10) · D-08 PIN length/lockout and D-09 device-token lifetime (T9b) · D-10 branch timezone (T10) · D-11 staging host (T13) · D-34 (#9).
D-31 (DENY wins) is **decided**.

## 6. Deployment context (not needed until T13)

- Domain `pospay.systems` on Cloudflare DNS; all A records point to `82.29.164.194` (Abdelaziz's shared server, **temporary**), DNS-only (grey cloud).
- Dokploy on that server (`dokploy3.walidmohamed.com`) with Traefik + Let's Encrypt. Project `pospay` exists with a `traefik/whoami` test app on `pos.pospay.systems` (HTTPS works).
- The server is shared: never touch other projects there. Waleed plans to move to his own server later.
- `docs/adr/0001-domain-and-subdomain-topology.md` defines the subdomains (`app.`, `platform.`, `pos.`, `menu.`, `api.`, `cdn.`).
