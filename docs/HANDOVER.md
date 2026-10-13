# HANDOVER — PosPay (for Claude Code in the IDE)

> **Written:** 2026-09-23, at the end of a Claude (Cowork) session. **Refreshed:** 2026-10-14 (status, paths, pipeline).
> **Read this first, then `CLAUDE.md`, then `CLAUDE.architecture.md`.** This file is a snapshot of *where
> the work stands*; the rules themselves live in the files listed in §2 and win on any conflict.
> Update §4–§6 of this file at the end of every session, in the same PR as the work. The live, row-by-row
> status is the «المشروع أول بأول» tab of the decisions page (§4) — this file only summarises it.

---

## 1. What the project is

**PosPay** (`pospay.systems`) — multi-tenant, multi-vertical business-management SaaS for Kuwait: POS,
inventory, appointments, staff attendance & commissions, customers/loyalty, reporting. Arabic-first +
English, RTL, KWD with 3 decimals (money = `bigint` mills). Modular monolith, TypeScript end-to-end.
Solo developer (Waleed) building entirely with AI agents.

- **Repo:** https://github.com/lolotam/PayPos.systems — local clone `F:\Dev\Projects\PosPay.systems\main` (Windows);
  task worktrees live under `F:\Dev\Worktrees\PosPay\<branch>`
- Business docs, logos and archives live outside the repo and are **not** part of it
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
| `docs/specs/phase-1/IMPLEMENTATION-PLAN.md` + `SPEC.md` | Phase 1 rows (M1–M9), order, "done when" | Phase 1 sequencing |
| `.claude/skills/pospay-pipeline/SKILL.md` | lanes, review rounds, merge, staging deploy, status page, owner report | delivery workflow |
| `docs/specs/phase-0/SPEC.md` (v2) | Phase 0 scope and domain model | Phase 0 scope |
| `docs/PRD.md` (v1.1) | whole product: phases, tasks P0–P6, open decisions D-01…D-34 | product scope |
| `.specify/memory/constitution.md` (v2.1.0) | spec-kit constitution | — |
| `.specify/PROJECT-OVERRIDES.md` | local changes to spec-kit defaults | — |
| `AGENTS.md` | index for Codex and other agents; review guidelines | — |

ADRs (0001–0041 on 2026-10-14; the Phase 0 ones): `0001` domain/subdomain topology · `0002` workspace tooling baseline · `0003` auth ↔ RLS boundary ·
`0004` test runner (Vitest) · `0005` money rounding (half away from zero) and percentage precision (4 dp) ·
`0006` database tests on the compose Postgres, postgres.js driver, migration naming · `0007` tenant tables key on `(company_id, id)` · `0008` API stack pins, explicit `@Inject`.

## 3. How work is done here

### 3.1 The loop — one slice per branch per PR

The full delivery pipeline — lanes, review rounds, guard pass, merge, staging deploy, status page, owner report — is
`.claude/skills/pospay-pipeline/SKILL.md`. In short:

1. One row of the phase plan per branch, worktree and PR (`feat/…`, `fix/…`, `docs/…`). **Never push to `main`.**
2. Spec first (`/speckit-specify`); owner questions go to the slice's `owner-questions.ar.md` **and** to a new numbered
   batch on the decisions page (`CLAUDE.md` §1 5b). When Waleed and his partner (Abu Salem) differ, the partner's pick binds.
3. The implementer is the **Grok CLI, `grok-4.7-build-fast`, effort high** (owner, 2026-10-14), one resumed session per
   task to keep its cache warm. Claude Code orchestrates, judges the diff and runs `pnpm check`.
4. Guard pass (`clean-code-guard`, `test-guard`, `docs-guard`), then up to **5 review rounds**: Codex astra 6 →
   fresh Claude reviewers → the Codex GitHub bot (`@codex review` after every push).
5. Fix every security or correctness finding before merge; P2/P3 left after the cap become linked GitHub issues.
6. Merge with `gh pr merge <n> --squash --delete-branch --match-head-commit <reviewed-sha>` once `ci-gate` is green on
   that head; deploy to staging; update the decisions page's status tab; journey doc in its own PR.

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

## 4. Status — 2026-10-14

**Source of truth:** the «المشروع أول بأول» tab of the decisions page
https://claude.ai/artifact/VirV1CDguH46v7rgcRqwqF (published file `roadmap.json`), updated after every merge.

| Phase | Name | Status |
|---|---|---|
| P0 | Foundation | ✅ done — 10/10 acceptance gates |
| P1 | Staff, attendance, commissions | 🟡 in progress — 6/6 gates; 52 of 96 rows done, 1 in progress |
| P2 | Catalog, orders, payments, cash, POS | ⬜ not started |
| P3 | Inventory, recipes, production, kitchen | ⬜ not started |
| P4 | Appointments, e-menu, loyalty, channels, notifications | ⬜ not started |
| P5 | Reporting, platform, subscriptions, sale-readiness | ⬜ not started |
| P6 | Expansion | ⬜ continuous |

Phase 1 by group (done / in progress / not started): M1 shells and access 13/0/0 · M2 staff 18/0/0 ·
M3 attendance 15/0/2 · M4 commission engine 3/0/0 · M5 catalog, customers, sessions 3/1/10 · M6 packages 0/0/6 ·
M7 commissions 0/0/15 · M8 ratings and alerts 0/0/6 · M9 pilot 0/0/1 · follow-up issues 0/0/3.

Phase 0 leftovers, deferred on purpose: optional local Garage container, OpenTelemetry sampling, Sentry hook, and —
waiting on the new server (D-11) — the PITR restore drill and the production sizing ADR.

161 PRs merged, none open, on 2026-10-14. Staging runs `migrate`, `api` and `worker` (`CLAUDE.md` §10).

### 4.1 Next action

- Row **35** `record-service-session`, reception screen **35c**: 35c-1…11 and 35c-3b are merged (PR #184–#200).
  Next: **35c-11b** (the two correctness findings of issue #202), then **35c-12** (publish the full route + Playwright).
- Then **35d** (edit price/discount after saving; batch 17 answered) after issue #189 declares its bell event.
- Owner question #199 (leaving an EXPIRED recording without logging out) goes in the next decisions-page batch;
  until answered, logout or a scope change is the exit, and it does not block 35c-12.

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

### 5.1 GitHub issues

The list is `gh issue list --state open` (27 open on 2026-10-14). The ones that touch the current row:
#199 (owner question), #201, #202, #193 (picker indexes — measure first), #189 (35d bell event). Still open from
Phase 0: #9 (D-34, platform-only company creation), #10 🔒 (`Grant` constraints, P2-T7), #11 🔒 (offline operator
credential, P2-T9) and the spec-kit items #6, #7, #8.

### 5.2 Open product decisions

`docs/PRD.md` §11 lists D-01…; the decisions page holds every answered batch. D-11 (the new server) blocks the PITR
drill, production sizing and the salon pilot (row 63, partner request AS-17).

## 6. Deployment

- Domain `pospay.systems` on Cloudflare DNS; A records point to `82.29.164.194` (Abdelaziz's shared server,
  **temporary**, until D-11), DNS-only.
- Dokploy with Traefik + Let's Encrypt on that server; the reverse proxy is Dokploy's shared Traefik, never a container
  of ours (`CLAUDE.md` §10).
- Staging lives in `/opt/pospay-staging`, reached over the `abdulaziz` SSH profile; images come from GHCR tagged by
  commit SHA; `staging-deploy.sh <sha>` migrates, starts and proves `/ready`; `known-good/<sha>/` keeps every ready
  pair for one-step rollback; a nightly backup runs from `pospay-backup:<sha>`. Steps: pipeline skill §6.
- The server is shared: never touch other projects there.
