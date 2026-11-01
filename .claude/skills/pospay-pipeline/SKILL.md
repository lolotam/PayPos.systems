---
name: pospay-pipeline
description: "Apply PosPay's owner-confirmed delivery pipeline to phase-plan rows, slices, use cases and fix PRs. Use MiniMax for initial implementation, GLM 5.3 Flash for small exactly pinned tasks, Kimi for corrections after clean handoff, built-in delegation, three concurrent tasks and five GitHub reviews. Apply the lighter docs-only lane to documentation changes."
---

# PosPay delivery pipeline

## 1. Authority and required reading

Read `AGENTS.md` and all six governing documents it lists, then
[the owner-confirmed delivery policy](../../../docs/agent-delivery-pipeline.md).
Apply that policy as the authoritative source for roles, transport, fallback, reviewer counts,
concurrency and handoff. This skill is its operational companion, aligned with PP-69, PP-73,
PP-84 and PP-91/PP-92 (owner-decision items 31, 35–39 and 43–44; PR #749).

Preserve every technical, architectural, database, security and testing requirement in the
six governing documents and applicable ADRs. If a technical or security rule conflicts,
follow the governing document and report the conflict to Waleed. Use
`waleed-implementation-v2` only for compatible process mechanics; do not reopen owner choices
already settled by the policy. Historical decisions remain audit records, not active alternatives.

Act as the orchestrator: prepare bounded briefs, judge deliveries personally, run checks and
coordinate authorized publication. Do not take over production implementation to bypass a lane.

## 2. Roles and transport

Use the runtime's **built-in delegation facility only** (`delegate_task` in T3 Code;
`functions.delegate` in the Codex runtime described by the policy). Match the current configured
lane; do not invent an API, provider, model id, variant or effort when it is unavailable.

| Role | Primary lane | Fallback |
| --- | --- | --- |
| Spec, plan, design and `grill-me` questions; documentation only | Claude Code, `claude-opus-5-5`, effort `high` | Cursor, same model and effort |
| Initial implementation | MiniMax `M3.1-Flash · thinking`, T3 MiniMax Code provider | Claude Code, `claude-opus-5-5` |
| Small, exactly pinned initial tasks, beside MiniMax | GLM `5.3 Flash`, T3 OpenCode provider, `opencode/glm-5.3-flash-free`, variant `high` | MiniMax, then Claude Code, `claude-opus-5-5` |
| Corrections after clean initial handoff | Kimi `K3.1 Pro`, T3 OpenCode provider, `kimi-code-plan-global/k3.1-pro`, variant `high`; `max` for money and database work | Claude Code, `claude-opus-5-5` |
| Risky-slice design advice; read-only | Codex `gpt-6-astra`, effort `high` | Claude Code, `claude-opus-5-5` |
| Single internal code review, including database/security review; read-only | Codex `gpt-6-astra`, effort `high` | Claude Code, `claude-opus-5-5` |
| Hard-decision advisor, only when asked | Claude `claude-fable-5-1` | — |

Move to the stated fallback only after **two availability or rate-limit failures**, not poor
work quality, and record the switch in the PR. Confirmed exhausted native planner quota permits
the same-model Cursor fallback without another quota probe. Apply PP-84.2 as the exception:
when T3 cannot reach the OpenCode server, **hold Kimi dispatches until Waleed starts it**;
do not start it yourself or switch those dispatches to Claude Code without Waleed's instruction.

If the configured fleet lacks a required lane, stop that dispatch and ask Waleed to add or
enable it. Do not create a login, API key or alternative provider. T3's OpenCode provider is
allowed; shell-run `opencode run`, `codex exec`, external CLIs, relays and process substitutes
are forbidden. Do not use the legacy CLI generator, checker or session-stopper files beside
this skill as a dispatch recipe. Built-in transport alone proves no technical sandbox.

## 3. Scope, concurrency and lifecycle

- Run **at most three tasks**, including GLM tasks. The four-task PP-88 evaluation was temporary,
  not a standing exception. Choose unrelated work; dependent tasks wait for their prerequisite
  to merge. Never let two authors touch the same file or two open tasks change the same table.
- Keep one use case per PR, with its own task session, branch and worktree. Keep a persistent
  management session for priorities and coordination. Keep related tests and fixes with the task;
  a new session or worktree never resets its correction budget or ownership.
- Allow concurrent migration tasks only with separate local Postgres containers and ports per
  worktree. Reserve migration and ADR numbers in expected merge order; finalize at merge and
  rebase later migrations on `main`. Never test on shared or staging databases.
- Give reviewers independent fresh context: diff, spec and governing documents, never implementer
  history. A read-only reviewer may inspect the existing task worktree.
- Hand off current scope, branch/worktree/HEAD, decisions, actual check and review receipts,
  blockers, remaining work, correction-budget usage and live workers/processes, without secrets.
- Account for workers, tests, owned containers and processes before closing a session. Remove a
  worktree only after merge and delivery verification, preserving audit evidence and checking
  tracked, untracked and valuable ignored files. Never force cleanup or remove another task's work.

## 4. Preparation and delegated brief

1. Refresh repository/history, the live roadmap, both owners' reviews/answers and partner requests.
   Follow `docs/decisions-site.md`; do not infer readiness from an old note.
2. Use the installed `grill-me`/`grilling` skill before every new task, following policy §2.
   Discover facts first, do not re-ask settled decisions, then ask unresolved questions in numbered
   rounds with recommendations and wait for answers/confirmation. If the skill cannot be found,
   tell Waleed and ask; never silently substitute another interview skill.
3. Record questions and answers verbatim in Arabic in the slice's `owner-questions.ar.md`, or
   `docs/owner-decisions.ar.md` for process questions. Technical questions go only to Waleed;
   feature/business questions also go to the shared decisions page, where Abu Salem's pick binds
   on a difference and Waleed's pick applies until then. Follow the orchestrator-only routing
   rules in `CLAUDE.md` §1 5b. Unknown business rules become `TODO(spec)` and defer affected work.
   Preserve live answers using the ETag/`If-Match` discipline; on `412`, re-read and re-decide.
4. Draft the spec and then plan on the planner lane. The lead personally reviews them once before
   implementation. Request Astra's read-only design advice for risky work; consult Fable only
   on hard decisions when needed. Resolve findings before writing code.
5. Capture the baseline and declare exact writable paths, task bounds and acceptance criteria.
   Point to `CLAUDE.md`, `CLAUDE.architecture.md`, the spec, plan, applicable ADRs and starting files;
   quote applicable rules verbatim. Send paths rather than unnecessary source dumps.
6. Put role and fences first, required reading next, applicable rules next, and the task or new
   findings last. Corrections use `file:line — defect — expected outcome`. Keep evaluation notes
   outside the deliverable diff: first-pass checks, fix rounds, missed findings, violations and time.

## 5. Implementation fences and handoff

Use MiniMax for initial implementation. GLM may instead take a **small, exactly pinned task**
(one error fix, a contract bound, an error-code mapping) in **any code area**, including money,
auth or database code (PP-92). Do not impose a backend-only or sensitive-area exclusion.
Try a medium database or UI task before anything bigger; everything else stays on MiniMax.
Keep the Zen free-tier data-usage terms review pending as recorded in owner-decision item 43;
PP-92 permits any code area but does not resolve that review or relax the data fences.

Apply these fences to implementers and correction workers:

- Read and edit only the declared task files inside the assigned worktree. **No shell, command,
  test, build, script, git, network or MCP tool access**; no publication or server access.
- Never read, list or write `.git`, read `.env*`, or access anything outside the worktree.
  For GLM these read restrictions are explicit PP-91 conditions, including when reading references
  or following links. Keep its brief free of **secrets, keys, customer data and real phone numbers**.
  Do not send secrets to any delegated lane. Do not claim fences are enforced unless verified;
  if required access controls cannot be provided, hold the dispatch.
- Do not edit unrelated paths, reformat unrelated lines or squash lines to evade `max-lines`.
  Preserve the no-shell security boundary when replacing the old CLI instructions.

The initial implementer retains its own failed attempt until required checks and review are
complete and ownership is handed back cleanly. Do not reset or discard partial work to bypass
a failure, and do not mark a failing delivery complete to force a model switch.
**Only after clean initial handoff**, create a bounded Kimi correction task for subsequent
review, PR and CI findings; reuse that worker for its own rounds. Apply §2's fallback and wait
rules. Never revive the old automatic Kimi-to-MiniMax quota-switch procedure.

## 6. Verification and review

Read every delivered change before executing it, including tests, scripts, package or build
configuration. Inspect the diff against the baseline and account for unexpected tracked,
untracked and ignored artifacts; report scope violations without discarding unrelated work.
Diff rewritten SQL functions line by line, especially money, database and permission guards.
The orchestrator runs checks itself: a worker's claim is not a receipt. Executing authored code
under the orchestrator's account remains a residual risk; transport does not isolate it.

Run locally scoped checks for affected packages, with the full `pnpm check` required on CI on
the exact head for code changes. Include relevant typecheck, lint, `pnpm lint:docs`, boundaries,
cycles, module-map, unit, integration, RLS negative, EXPLAIN, generated API/client, UI/E2E and
build checks. Use `clean-code-guard`, `test-guard` and `docs-guard` where applicable. Record the
exact commands and failures; never label an unavailable or unrun check passed.

Use **one internal Astra review**, not a second Sonnet layer or mandatory Fable review.
For every PR touching `packages/db/**`, include the database/security checklist:

- Tenant tables: `company_id`, composite primary key `(company_id, id)`, ENABLE and FORCE RLS,
  policy and negative isolation test in the same PR (`CLAUDE.md` §5, ADR-0007).
- Grant allowlist in `packages/db/src/__tests__/privileges.spec.ts`; no runtime `BYPASSRLS`;
  auth follows ADR-0003. Index RLS predicates/FKs; existing-table indexes use CONCURRENTLY
  (ADR-0033). Use expand/contract migrations, `numeric(14,3)` money, UUID v7 and `timestamptz`.

Re-review and re-test fixes. Allow at most **five review/fix cycles**, with **no open P0/P1**.
If those remain after cycle five, split into smaller PRs; do not add cycles or reset the budget.
Defer lower severities only under the documented policy, with linked issues. A narrower runtime
budget requires stopping/reporting, never a workaround.

## 7. Docs-only quality lane

Use the lighter lane only when there is no code, migration or generated-file change. Apply
formatting and relevant guards, not unrelated application database tests. A pure docs fix needs
no production implementer dispatch or slice spec unless it is itself a spec. Use the planner
lane for specs/plans/questions as required by §2. Do not change `docs/module-map.md` or
`docs/module-map.yaml` under a non-code classification: CI consumes them as code.

Run the formatting check (`pnpm format:check`, or a scoped Prettier check with the scope recorded)
and the relevant documentation guard. Keep prose P2/P3 fixes to one batch and link deferred issues.
Treat a contradictory operational or governing rule as P1. Do not use docs-only status to waive
review receipts, CI, the no-P0/P1 bar, pre-merge backup or the roadmap update. Follow the current
CI classification and report the actual skipped/passed jobs. No application rollout is required.

## 8. PR, merge and delivery

Commit, push and open the PR only within the user's authorized task; include the spec when
applicable and a delivery checklist. Require **five completed GitHub reviews**: Codex plus all
**four MergePilot panel bots**, on the exact head being merged. Discover live identities and
configuration rather than pinning stale panel model names. Trigger `@codex review` after every
push. Comment/neutral reviews count as completed, but pending, missing, failed or stale receipts
do not. Do not revive the old waleed_Bot failure waiver or substitute a CLI review for a bot.
Require green CI on the same head and fixed/properly deferred findings with no open P0/P1.

Follow policy §10 and `docs/decisions-site.md` for delivery rather than an older SSH recipe:

- The standing reviewed-PR → merge → staging authorization covers the delivery queue only;
  do not assume it covers unrelated documentation saves. Never skip a gate without current consent.
- Before **every merge**, run and verify the backup using `deploy/backup/`; Dokploy does not take
  it automatically. If Dokploy authentication fails, prepare the PR but do not merge without an
  authorized alternative. The SSH exception for PR #701 is not a general authorization.
- A merge or `autoDeploy` flag does not prove a release. For a code rollout, verify green merged-SHA
  CI and published images, backup/restore, the existing Dokploy compose's pinned SHA/migration,
  readiness/live SHA/smoke checks, rollback proof and forward deployment. Never start a second
  stack or edit the database manually. A docs-only merge needs no application rollout.
- No production/server/credential/cost change without specific owner consent. Never print secrets
  or touch another project's containers, data or files.
- After every merge or task/partner-request change, pull and update the existing roadmap in place,
  then verify the live page. Never rebuild it or edit SQLite directly. Follow the existing roadmap
  CLI in `scripts/roadmap/cli.mjs` and the decisions-site instructions. Read owners' answers back.
- Give user-visible releases Arabic and English journey/testing guides. Use only the existing
  confirmed notification topics and rules in policy §12; internal documentation saves send none.
  Send messages only when authorized by the user or an explicitly invoked workflow.
- Report in Egyptian Arabic: done, running, next and blockers, with counts recounted from current
  roadmap/repository/PR evidence and actual review/fix rounds. Keep identifiers untranslated.
  Do not report delivery complete before verification, or invent quota/usage figures.
