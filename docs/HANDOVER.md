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
| `docs/specs/phase-0/IMPLEMENTATION-PLAN.md` (v3) | Phase 0 tasks T0–T13, order, "done when" | Phase 0 sequencing |
| `docs/specs/phase-0/SPEC.md` (v2) | Phase 0 scope and domain model | Phase 0 scope |
| `docs/PRD.md` (v1.1) | whole product: phases, tasks P0–P6, open decisions D-01…D-34 | product scope |
| `.specify/memory/constitution.md` (v2.0.0) | spec-kit constitution | — |
| `.specify/PROJECT-OVERRIDES.md` | local changes to spec-kit defaults | — |
| `AGENTS.md` | index for Codex and other agents; review guidelines | — |

ADRs: `0001` domain/subdomain topology · `0002` workspace tooling baseline · `0003` auth ↔ RLS boundary.

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
```

`.env` at the repo root (git-ignored) was generated with random local passwords; `.env.example` lists the keys.
Postgres is reached as `pospay_owner` until T4 creates `pospay_app` and `pospay_auth` (ADR-0003 §3).

### 3.4 Things that bite

- **`.claude/` and `.github/` are write-protected for remote/agent file tools** in Waleed's setup. If you cannot write there, prepare the file elsewhere and ask Waleed to copy it.
- **spec-kit** runs on Windows PowerShell only. Its defaults were changed (specs under `docs/specs/NNN-<module>-<use-case>/`, tests mandatory, business rules never guessed, mandatory *Slice design* section). A spec-kit refresh overwrites the skill copies — re-apply per `.specify/PROJECT-OVERRIDES.md`.
- `.agents/skills/` contains a personal skill library that is git-ignored except `speckit-*`. 186 unrelated skills were moved to `E:\PosPay.systems\_skills-archive`.
- CI (`.github/workflows/ci.yml`) ignores `docs/**` and `*.md`, so docs-only PRs show no CI run — that is expected.
- `lint:docs` fails on closing JSX comments, `FIXME`/`HACK`/`XXX`, commented-out code, and on any JSDoc in `domain/**`, `ports/**`, `events/published.ts` that has no Arabic **letter**.

## 4. Status — Phase 0

| Task | State | Where |
|---|---|---|
| T0 Auth ↔ RLS decision | ✅ done | ADR-0003 **Accepted** 2026-09-23 (PR #5) |
| T1 Workspace skeleton | ✅ done | PR #1, #2 |
| T12a Minimal CI | ✅ done (branch protection still to do) | `.github/workflows/ci.yml` |
| T2 Local infra | ✅ done | PR #12 — `deploy/docker-compose.dev.yml` |
| T3 `packages/domain` (Money, rounding, Percentage, TaxRule) | ⬜ **next** | — |
| T4 `packages/db` (roles, `withTenant` / `withUser` / `withNewTenant`, helpers) | ⬜ | ADR-0003 §2–§3 |
| T6a contracts → T5 tenancy schema + RLS suite → T6b api → T7 write primitives → **T9a → T8** → T9b → T10/T11 → T12b → T13 | ⬜ | plan v3 §2 |

**Critical path:** T0 → T1 → T3 → T4 → T6a → T5 → T6b → T7 → T9a → T8 → T9b → T12b → T13.

### 4.1 Next action — T3

- Choose the test runner (ADR-0002 defers it to T3; Vitest is the stated lean) and record it in an ADR.
- `packages/domain`: `Money` as `bigint` mills with lossless string transport and `numeric(14,3)` bounds; `roundKwd` half-up at line level **including negatives**; `Percentage`; `TaxRule` (VAT-ready).
- **Zero runtime dependencies**; exhaustive unit tests; full Arabic JSDoc on every export (`lint:docs` enforces it).
- Done when: tests pass and `dependencies` in `packages/domain/package.json` is empty.

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
