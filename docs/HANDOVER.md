# HANDOVER — PosPay (for Claude Code in the IDE)

> **Written:** 2026-09-23, at the end of a Claude (Cowork) session. **Refreshed:** 2026-10-16 (status, open issues, environment facts).
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

ADRs `0001`–`0043` exist in `docs/adr/` (2026-10-16); the earliest foundational ones are: `0001` domain/subdomain topology · `0002` workspace tooling baseline · `0003` auth ↔ RLS boundary ·
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
   fresh Claude reviewers → the four PR bots: the Codex GitHub bot (`@codex review` after every push) and the
   MergePilot panel (MergePilot, waleed_bot, mohamed_bot). Every bot's result on the head SHA is read before a merge.
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

**Two facts that cost time before:**

- **DB-backed vitest runs share one Postgres and one advisory lock.** Every spec that touches the cluster roles takes
  the advisory lock `pospay:test-cluster-roles` (`packages/db/test/role-lock.ts`), so two DB test runs started at once
  — two worktrees, or two shells — block or fail each other. Run **one DB-backed run at a time** on the machine.
- **Deleting a merged worktree on Windows** fails on long `node_modules` paths. Empty it with
  `robocopy <empty-dir> <worktree-dir> /MIR`, then `Remove-Item` the folder, then `git worktree prune`, then
  `git branch -D <branch>`. `/MIR` deletes without asking, so first run `git status --porcelain` in that worktree and
  stop if it prints anything (uncommitted or untracked work would be lost). Git-ignored files are not listed there and
  are deleted too — the copied `.env` is expected to go, anything else you care about must be copied out first.

### 3.4 Things that bite

- **`.claude/` and `.github/` are write-protected for remote/agent file tools** in Waleed's setup. If you cannot write there, prepare the file elsewhere and ask Waleed to copy it.
- **spec-kit** runs on Windows PowerShell only. Its defaults were changed (specs under `docs/specs/NNN-<module>-<use-case>/`, tests mandatory, business rules never guessed, mandatory *Slice design* section). A spec-kit refresh overwrites the skill copies — re-apply per `.specify/PROJECT-OVERRIDES.md`.
- `.agents/skills/` contains a personal skill library that is git-ignored except `speckit-*`. 186 unrelated skills were moved to `E:\PosPay.systems\_skills-archive`.
- CI (`.github/workflows/ci.yml`) runs on every PR. A `changes` job skips the heavy `check` job when only `docs/**` or `*.md` changed; the small `ci-gate` job always reports, and **`ci-gate` is the check branch protection requires** on `main` (plan v4 T12a).
- `lint:docs` fails on closing JSX comments, `FIXME`/`HACK`/`XXX`, commented-out code, and on any JSDoc in `domain/**`, `ports/**`, `events/published.ts` that has no Arabic **letter**.

## 4. Status — 2026-10-16

**Source of truth:** the «المشروع أول بأول» tab of the decisions page
https://claude.ai/artifact/VirV1CDguH46v7rgcRqwqF (published file `roadmap.json`), updated after every merge.

| Phase | Name | Status |
|---|---|---|
| P0 | Foundation | ✅ done — 10/10 acceptance gates |
| P1 | Staff, attendance, commissions | 🟡 in progress — 6/6 gates; 65 of 106 rows done, 1 in progress |
| P2 | Catalog, orders, payments, cash, POS | ⬜ not started |
| P3 | Inventory, recipes, production, kitchen | ⬜ not started |
| P4 | Appointments, e-menu, loyalty, channels, notifications | ⬜ not started |
| P5 | Reporting, platform, subscriptions, sale-readiness | ⬜ not started |
| P6 | Expansion | ⬜ continuous |

Phase 1 by group (done / in progress / not started): M1 shells and access 13/0/0 · M2 staff 18/0/0 ·
M3 attendance 15/0/2 · M4 commission engine 3/0/0 · M5 catalog, customers, sessions 3/1/10 · M6 packages 0/0/6 ·
M7 commissions 0/0/15 · M8 ratings and alerts 0/0/6 · M9 pilot 0/0/1 · follow-up issues 13/0/0. Row 35 (`record-service-session`) is still the one row in progress: 35a, 35b
and all of 35c are merged, 35d is not started.

Phase 0 leftovers, deferred on purpose: optional local Garage container, OpenTelemetry sampling, Sentry hook, and —
waiting on the new server (D-11) — the PITR restore drill and the production sizing ADR.

186 PRs merged, none open, on 2026-10-16 (`main` at `27f635ad`). Staging runs `migrate`, `api` and `worker` (`CLAUDE.md` §10).

### 4.1 Next action

- **35c (the reception screen of row 35) is complete.** All 18 PRs are merged (PR #184–#233): 35c-1…11, 35c-3b,
  35c-11b, 35c-12a, 35c-12b, 35c-13a-1 (#230), 35c-13a-2 (#231) and 35c-13 (#233, the recorder clears an EXPIRED
  recording with the own-recordings panel). The 35c PRs are sub-tasks of row 35, so row 35 stays «in progress» until 35d.
  The design is ADR-0042 (recovery proof, answers #209–#211, #223, #224, #226) — all closed.
- Since 2026-10-14 the other merged PRs were hardening, not features: #232 (IBAN history no longer shows the raw actor
  id), #235 (owner-granted parity unit spec), #237 (one time-zone formatter per schedule materialization), #239 and #240
  (clock-dependent order specs; api domain specs added to the unit gate), #243 (one generic refusal for a taken card
  code), and three database-runner fixes: #244 (postgres.js closed-socket patch, ADR-0043), #242 (the migration runner
  holds a dedicated connection for its advisory lock and aborts when it is lost) and #246 (data-step client runs one
  statement at a time).
- **Next action: row 35d** — edit the price/discount of a saved service line (batch 17 answered: ED-Q1…ED-Q8, spec 050,
  plan row 35d). It is **blocked on issue #189**: the 35d plan must declare the edit-bell event and its consumer
  (ED-Q6, a bell to the branch manager on every edit) before any code is written. Resolve #189 first, then spec and brief 35d.
- Owner questions SS-Q18 and SS-Q19 are answered by Waleed and Abu Salem and built: the recorder confirms «checked —
  recorded / not recorded» herself without a manager (SS-Q18, #199 closed), and before confirming she sees only the visits
  she recorded in that branch on the attempt date (SS-Q19). SS-Q20 is answered by Waleed (option 1) and built: the
  recovery read states whether the attempt committed and pre-selects the matching button. **Abu Salem has not answered
  SS-Q20 yet** (`docs/specs/050-orders-record-service-session/owner-questions.ar.md`); his pick binds if it differs.

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

The list is `gh issue list --state open` (20 open on 2026-10-16). Those that touch the current row or the pipeline:

- #189 — 35d plan: declare the edit-bell event and consumer (ED-Q6) before implementing; **blocks 35d**.
- #221 — service-session same-key retention (24 h from commit) is shorter than the client retry window (25 h from last send).
- #201 — 35c reception: polish the recovered-draft display after reload (deferred).
- #193 — picker name-order indexes: measure, then add ICU expression indexes in their own migration PR (deferred).
- #161 — all-branches attendance report as a worker job, before large customers (deferred).
- #204 — pipeline: define the Codex CLI evidence that satisfies the four-bot gate when the bot is out of quota.

Older and not on the current row: #125 (PR 48 plan builder, owner decision), #123 (clock-by-card UX text), #113 (deny staff
login to one Cashier), #78 and #54 (admin public API origin), #69 and #67 (worker startup follow-ups), #19 (company
membership invitations). From Phase 0: #9 (D-34, platform-only company creation), #10 🔒 (`Grant` constraints, P2-T7),
#11 🔒 (offline operator credential, P2-T9) and the spec-kit items #6, #7, #8.

Closed since 2026-10-14 (25): #57, #112, #115, #138, #141, #145, #199, #202, #207, #209, #210, #211, #213, #214, #216, #217,
#219, #223, #224, #226, #229, #236, #238, #241, #245.

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
