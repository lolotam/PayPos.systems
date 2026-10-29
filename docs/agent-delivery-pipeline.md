# Agent delivery pipeline — PosPay

> **Confirmed by the owner (Waleed) on 2026-10-26 (Asia/Kuwait)**, and saved in the repository so that every agent starting a task here reads it locally. **Revised on 2026-10-27/28 (PP-69, `docs/owner-decisions.ar.md` item 31):** the lanes, the single internal reviewer, Fable's advisory role, three parallel tasks with per-worktree databases, the five GitHub reviewers and the split-on-exhaustion rule. **Revised on 2026-10-28 (PP-73, `docs/owner-decisions.ar.md` items 35–38):** the Opus 5.5 high planner lane for the spec, the plan and the `grill-me` questions; the deployment wording corrected against the PR #701 evidence; the PR #701 completion record.
>
> **Revised on 2026-10-30 (PP-84.1, PP-84.2, `docs/owner-decisions.ar.md` item 39):** T3 Code routes every model. MiniMax and Kimi run through T3's OpenCode provider, and Claude Code is the fallback for every delegated role. Only a shell-run `opencode` or `codex` is forbidden.
>
> **What this overrides.** The explicit owner choices below — who writes the code, which transport carries the delegation, which reviewers must answer, how many of them, and when work moves from one implementer to another — supersede older role, tool and reviewer counts in `.claude/skills/pospay-pipeline/SKILL.md`, `docs/owner-decisions.ar.md` and older session notes. Where an older document says "four bots", "opencode transport" or "Kimi implements by default", the rule here wins.
>
> **What this does not override.** Every technical, architectural, database, security and testing rule stays exactly as written in `CLAUDE.md`, `CLAUDE.architecture.md`, `docs/06_Tech_Stack_Architecture_EN.md`, `docs/module-map.md`, `.specify/memory/constitution.md` and `docs/PRD.md`. If this file and a governing document disagree about a technical or security rule, the governing document wins and the conflict is reported to the owner.
>
> Read it together with the six documents listed in `AGENTS.md`, and with `docs/decisions-site.md` for the decisions page.
>
> **Session and worktree lifecycle confirmed on 2026-10-28:** §1.1 records the owner's approval in `docs/owner-decisions.ar.md` item 32, indexed as PP-73.2 in item 36.

## 0. One transport rule for every delegated role

- Every delegated role — the initial implementer, the design advisors, the independent reviewers and every correction round — runs on the **built-in delegation facility of the agent runtime** (`functions.delegate` under Codex, `delegate_task` under T3 Code) and nothing else.
- The lanes (PP-69, PP-73.3 and PP-84.1). Under T3 Code each runs on the provider named here, which T3 routes:

  | Role | Primary | Fallback |
  | --- | --- | --- |
  | Spec, plan and `grill-me` questions (documentation only) | Claude Code, `claude-opus-5-5`, effort `high` | Cursor, `claude-opus-5-5`, effort `high` — the same model on a different provider |
  | Initial implementer | MiniMax `MiniMax-M3.1-Flash` on T3's OpenCode provider (`minimax-coding-plan/MiniMax-M3.1-Flash`) | Claude Code, `claude-opus-5-5` |
  | Correction rounds | Kimi `K3.1 Pro` on T3's OpenCode provider (`kimi-code-plan-global/k3.1-pro`, variant `high`; `max` for money and database work) | Claude Code, `claude-opus-5-5` |
  | Design advice (read-only) | Codex, `gpt-6-astra`, effort `high` | Claude Code, `claude-opus-5-5` |
  | Code review (read-only) | Codex, `gpt-6-astra`, effort `high` | Claude Code, `claude-opus-5-5` |
  | Advisor on hard decisions, when asked | Claude, `claude-fable-5-1` | — |

- A role moves to its fallback only after the primary failed **twice** on availability or rate limits (not on the quality of its work), and the PR description records the switch. For the planner, **confirmed exhausted native quota** also permits the same-model Cursor fallback without another quota probe; other availability failures follow the two-attempt rule (PP-73.3).
- T3's **OpenCode provider** is a delegation lane T3 routes, so it is allowed (PP-84.1). Running `opencode run` or `codex exec` from a shell is not.
- While T3 cannot reach the OpenCode server, MiniMax and Kimi dispatches wait until Waleed starts it (PP-84.2). This replaces the two-attempt fallback below for that one failure: the orchestrator does not start the service itself, and does not move the dispatch to Claude Code unless Waleed says so.
- **No external CLI, relay or process fallback of any kind**: not a shell-run opencode, not any other launcher, not a hand-run command standing in for a delegated lane.
- The owner confirmed it directly: *«always use you built-in your delegation tool not cli external and if the model not included ask me to add to the delegation lines»*.
- If a role needs a model the configured fleet does not offer, **stop that dispatch and ask Waleed to add or enable the delegation lane**. Never invent a provider, a model id, a variant or an effort level, never change a provider, and never set up a new login or API key to work around it.
- Lane names and their configuration can change. Match the **current runtime** lane that serves the role, and never treat a deployment UUID or a provider id as a durable identity.
- The delegation transport is **not** a technical sandbox. Do not claim isolation stronger than what has actually been verified.

## 1. Orchestrator: refresh the real state, then choose the task

- Refresh first: the repository working tree and recent history, the roadmap on https://plan.pospay.systems, the live decisions and the reviews of **both** Waleed and Abu Salem, and every open partner request.
- One use case per PR (`CLAUDE.md` §1). A task needing two use cases is two PRs.
- Each task runs on its own branch and in its own worktree, so unrelated local work in the main checkout is preserved untouched and never swept into a diff.
- Never treat a task as ready because it looks ready: verify it against the live page and the repository.

### 1.1 Management session, task sessions and worktree lifecycle

- Keep a persistent **project-management session** for priorities, milestones, decisions, provider usage and coordination. Keep its status tied to repository, task and review evidence.
- Give each **independent delivery ending in a PR** its own task session, branch and worktree. The unit is a deliverable, not each implementation, test or correction step. Existing in-progress work stays attached to its current task and worktree.
- Keep implementation, related tests and corrections attached to that same task. Delegated stages still follow §§0 and 5–8; a new session or worktree never resets the task's logical correction budget or changes implementer ownership.
- Give the reviewer fresh, independent context. A read-only reviewer may inspect the task's existing worktree; a separate checkout is needed only when the assigned work requires one. Preserve the declared write scopes and concurrency limit in §13.
- A new session needs a short, current handoff: task and approved scope, branch/worktree and HEAD, decisions, completed work, actual check/review receipts, remaining work, blockers, correction-budget usage and any live worker or process it must account for. Do not assume session history transfers automatically; do not include secrets.
- **Closing a session is distinct from stopping its workers or processes and from removing its worktree.** Before closing it, account for delegated work, tests, owned database containers and any other live process; finish, transfer or explicitly stop that work rather than leaving its ownership unclear.
- Remove a task worktree only after its PR is merged and delivery verification is complete, with important work and audit evidence preserved. Check tracked changes, untracked files and valuable ignored files; `git status` alone is insufficient. Account for live workers, processes and owned containers before removal. Never force removal past these checks or sweep another task's files into cleanup.
- This policy does not itself create or close sessions, remove existing worktrees or schedule automatic cleanup. Dependent tasks and the existing review, backup and staging gates remain governed by §§8–10 and 13.

## 2. Every new task starts with the grilling round

- Use the installed **`grill-me`** skill (its underlying **`grilling`** skill) before **every new task**. Discover it by name in the runtime skill catalog; if the catalog does not list it, locate and read the installed `SKILL.md` (a stable hint is `~/.agents/skills/grill-me/SKILL.md`). Do not hardcode a synced-folder hash here, and do not guess a path.
- If neither the catalog nor the installed files can be found, say so plainly and ask the owner. **Never silently substitute another interview skill** (for example `interview-me`).
- The order is fixed:
  1. Inspect the discoverable facts yourself. Never ask the owner for something the repository, the spec, the roadmap or the decisions page already answers.
  2. Map the unresolved decision frontier for this task — what is genuinely undecided.
  3. Ask every independent, ready question in **numbered rounds**, each question carrying a recommended answer.
  4. Wait for the answers and the confirmation before any implementation starts.
- Do not re-ask a question the decisions page has already settled, and do not reopen a settled answer unless the owner asks for it.
- The spec, the plan and the questions of this round are drafted on the **planner lane** of §0 (`claude-opus-5-5`, effort `high`). That lane writes documentation only; it does not write application code.

## 3. Owner questions: record first, then route

- Every question and its answer is recorded **verbatim**, in Arabic: in the slice's `owner-questions.ar.md`, or in `docs/owner-decisions.ar.md` when the question belongs to no slice (a pipeline, tooling or process rule).
- **Feature and business questions** go to Waleed as a card **and** onto the same decisions page, https://plan.pospay.systems, as a new numbered batch. Both static decision files are updated together (`public/decisions.json` and `public/decisions.en.json`).
- **Technical questions** (implementer, tools, pipeline, infrastructure, CI, server, code design) go to **Waleed only** and never on the partner page (`CLAUDE.md` §1 5b, V3.17).
- On a difference between the two owners on a feature or business question, **Abu Salem's pick binds**. Until he answers, work follows **Waleed's** pick.
- No business rule is ever guessed. An unknown rule marks the affected slice `TODO(spec)`, defers that slice, and lets independent ready work continue.
- Never overwrite a live review or a live answer blindly. Follow the API's ETag discipline in `docs/decisions-site.md`: read the document and its ETag in one call, send `If-Match`, and on a `412 stale` read again and re-decide instead of writing anyway.

## 4. Spec and plan before code

- The slice spec comes first (`docs/specs/NNN-<module>-<use-case>/spec.md`), then the plan.
- The **spec, the plan and the design are drafted on the planner lane** of §0: Claude Code, `claude-opus-5-5`, effort `high`, with Cursor on the same model and the same effort as the quota or availability fallback (PP-73.3). That lane writes documentation only — never application code.
- The **orchestrator (lead) reviews the spec and the plan once, personally**, before any implementation starts. That review happens **once**: it is not a repeated approval step, and it does not reopen a question the owner has already answered.
- For a risky slice — money, auth, RLS, parsing, long-running work, or anything the owner flags — **Astra** gives independent, **read-only** design advice and the directions, dispatched through the built-in delegation of §0. **Fable** is no longer a required design reviewer; it is consulted only when the orchestrator is undecided on a hard design decision (PP-69.6).
- The findings and the owner's choices are consolidated and resolved **before** code is written.

## 5. The initial implementation lane

- The initial implementation runs on the **built-in delegation facility of the agent runtime**, on the user-enabled **MiniMax-M3.1-Flash** lane, T3's OpenCode provider (PP-69.1, PP-84.1), under the transport rule of §0.
- The owner confirmed this directly: *«sorry you dot need to delegate open code minimax 3.1 you have already the delegation tool here and i already login fore minimmax provider so the delgation model will be minimax m3.1 flash»*.
- **No external process** stands in for that lane (see §0), no new login, no new API keys, no invented model id or variant.
- The implementer authors the code, tests, contracts, migrations and RLS policies inside a **bounded, declared scope**. It does not publish anything, does not touch the server, and does not read secrets.

## 6. The orchestrator reviews and runs the gates itself

- The orchestrator reads the delivered changes personally and runs the gates itself. A worker's claim that a check passed is never a result.
- **Locally**, the gates run scoped to the packages the slice changed. The full `pnpm check` is mandatory on **CI, on the exact head being merged** (PP-69.7).
- The gates, as the slice requires them: `pnpm check` (CI); typecheck; lint; `pnpm lint:docs`; boundaries; cycles; `pnpm module-map:check`; unit; integration; RLS negative tests; `EXPLAIN` checks; the regenerated OpenAPI and the generated clients; and the relevant UI, E2E, build and Docker CI steps.
- Integration and RLS tests run against the **real local Postgres** of ADR-0006 (the compose stack, one cloned database per spec file). Each worktree gets **its own local Postgres container** on its own port, so parallel PRs migrate and test separate databases at the same time (PP-69.9). **Never** run tests against a shared or staging database.
- The guards run as well: `clean-code-guard` on production code, `test-guard` on tests, `docs-guard` on documentation.
- A gate counts as passed **only** when that exact command ran and returned success. Record every failure, stale artifact and limitation instead of rounding it up to "passed".
- Every change the implementer made is read **before** it is executed. No script, test, config or package change is executed unreviewed.

## 7. Handoff: when the work moves from one implementer to another

- The **initial implementer keeps its own failed attempt** until the required checks and the review are complete and ownership is handed back. A tool that resumes the original worker cannot move failed work to another model to get past a failure, and a failing delivery is never marked complete to force a handoff.
- Only after a **clean initial handoff** does a **new, bounded Kimi `K3.1 Pro` task** take the subsequent review, PR and CI findings (Claude Code `claude-opus-5-5` when Kimi falls back under §0, except while the PP-84.2 wait applies). The same worker is reused for its own correction rounds, dispatched through the built-in delegation of §0.
- The correction already settled in the `feat/p1-057-3b-self-approval-notice` worktree is Kimi's own work and legitimately stays with Kimi.

## 8. Independent reviews

- There is **one internal code review** (PP-69.5): **Astra** (`gpt-6-astra`, effort `high`; fallback `claude-opus-5-5`) reviews every PR, including the mandatory database and security review on every PR that touches `packages/db/**`. It reviews from **fresh context**: the diff, the spec and the governing documents — never the implementer's session history. The former Sonnet layer 2 is removed.
- The reviewer is **read-only** and dispatched through the built-in delegation of §0.
- Findings that arrive after a clean initial handoff go to Kimi, and are then re-reviewed and re-tested.
- **No P0 or P1 may be open.** The existing policy of at most five review and fix cycles holds: lower severities are deferred only under that documented policy with linked issues, and there is no silent waiver. **If the five cycles end with a P0 or P1 still open, the task is split into smaller PRs** (PP-69.8) instead of adding cycles. If the runtime's correction budget for a run is narrower, stop and report — never bypass it.

## 9. Pull request and CI

- The orchestrator commits, pushes and opens the PR **only when the user authorized that task**. The description carries the spec link and the delivery checklist.
- The required reviewers are **five** (PP-69.10): the Codex GitHub bot and the **four MergePilot panel bots**. CodeRabbit is no longer required. Discover the actual bot identities and configuration at PR time; never invent a panel name.
- Trigger `@codex review` again after every push.
- Approval means: **all five required reviews are complete on the exact head being merged**, every finding they raised is fixed or properly deferred under the §8 severity policy, **no P0 or P1 is open**, and CI is green **on that same head**. A pending, missing, failed or stale receipt is not a completed review. A neutral or comment-style review counts as complete: the requirement is that all five answered and their findings are resolved, not that all five explicitly approve.
- No gate is skipped without an explicit, current authorization from the owner. An old bot-failure waiver is not reused without a fresh one.

## 10. Merge and staging

- The owner has generally authorized **reviewed PR → merge → staging, for the delivery queue only**. A change outside that queue — this file's own save, for example — is not published without a fresh instruction.
- **A merge to `main` is not by itself a release.** The owner recorded on 2026-10-28 that a merge to `main` auto-deploys through Dokploy (PP-69.11); that stays the owner's policy. What PR #701 actually proved is narrower: the live staging service is an existing Dokploy **raw compose** whose image references are **pinned to a SHA**, and that release needed an explicit update of the persistent compose definition plus a controlled deploy through the official Dokploy API. A merge, or an `autoDeploy` flag, is **not proof of a release**. Before claiming a release, inspect what actually happened: the CI run on the merged SHA, the built images, the pinned refs in the live compose definition and the live SHA. The general authorization above covers the reviewed merge and the rollout it may trigger.
- Dokploy takes no backup before a deploy, so the orchestrator runs the backup with the tool in `deploy/backup/` **before every merge** and verifies it (PP-69.12). **No merge skips that backup**, whether or not the merge turns into a release.
- If Dokploy authentication fails, **prepare the reviewed PRs but do not merge** unless Waleed explicitly authorizes an alternative release path. **For PR #701 only**, Waleed authorized `ssh-abdulaziz-mcp` on 2026-10-28 (PP-71.1, `docs/owner-decisions.ar.md` item 33). The orchestrator may use SSH to inspect and operate the existing staging deployment, with exact-head CI/reviews, verified pre-merge backup/restore and release/rollback checks still required. This does not authorize a second stack, a manual database change or a credential change.
- Staging is deployed only through the controlled existing Dokploy compose service. No second stack beside the live one, and no manual database change.
- A **documentation-only** change needs **no application rollout**. For the two documentation paths changed in PP-73, the pull request is classified as non-code: the heavy jobs (`check`, `full-check`, `api-tests`, `build`, `images`) are skipped and `ci-gate` requires exactly that (`.github/workflows/ci.yml`). Changes to `docs/module-map.md` or `docs/module-map.yaml` count as code because the gate consumes them. A push to `main` still runs the full workflow and publishes SHA-tagged images when its image job succeeds; staging stays on the last released SHA. Pointing staging at another SHA requires published images and the release order below; a documentation-only merge does not require that rollout.
- The release order is fixed: green CI and the SHA images → backup and restore verification → the pinned SHA and its migration step → readiness, the live SHA and a smoke test → the required rollback proof → forward to the new SHA.
- No production change, no server change, no new credential and no new cost without a specific owner consent.
- SSH and the Dokploy tools are useful for **read-only** checks; SSH release operations require the explicit authorization above. Never print a secret.

## 11. Status, roadmap and communication

- Update the roadmap **in place** after a `git pull`, after every merge, after every task-row change and after every partner request, then verify the live page https://plan.pospay.systems. Follow `docs/decisions-site.md`. Never rebuild the roadmap file and never write to its SQLite database directly.
- A user-visible release gets an Arabic **and** English journey and testing guide in `docs/journey/`.
- The owner report states what is done, what is in progress, what comes next and what is blocked, with the counts **recounted from the current sources**, never invented.
- **Always answer Waleed in Arabic**, even when he writes in English. Commands, paths, identifiers and quoted text keep their original form and are never translated.
- An artifact follows the language of the project it belongs to, unless the owner specifies otherwise for that artifact.
- Nothing is reported as finished before it is verified.

## 12. Notifications (ntfy)

Only the existing confirmed topics are used: `pospay-features` (shared — a plain-Arabic notice of something **users can see or do**, not technical merge or test noise), `pospay-questions` (shared — a new question batch) and `pospay-waleed` (private — an owner decision that blocks the work). No all-engineering milestone feed was requested, so none is sent.

The publish API, the topics and the credential handling are in `docs/decisions-site.md`: publish as JSON so the Arabic stays intact, keep the server credential in an environment variable only, verify that the message was sent, and never put an answer, personal data or a secret in a message. An internal documentation save like this one triggers no notification.

## 13. Concurrency and the lighter docs-only lane

- Up to **three tasks** run at a time (PP-69.3), chosen to be as unrelated as possible. A task that depends on another waits until that one is merged. No two authors touch the same file, and no two open tasks change the same table.
- More than one task may carry a migration. Migration numbers are **reserved in the expected merge order** when the tasks start and made final at merge: a task merged after another rebases its migration on `main` before merging. Each worktree tests on its own local Postgres container (§6). `.specify/memory/constitution.md` Principle I (3.2.0) carries the same rule.
- A **docs-only** change uses the lighter documented quality lane (the formatting check and the guards that fit it), not the unrelated application database tests. If it is actually published, the PR bots, CI and the roadmap update still apply, and it needs no application rollout (§10).

## Never

- Never guess a business rule, a reviewer count, a tool name or a lane identity.
- Never report a check as passed without having run that exact command and seen it pass.
- Never publish, merge or change a server without the authorization that covers that action.
- Never call a merge or an `autoDeploy` flag a release. Only the pinned compose definition, the live SHA and the verified checks prove that one happened (§10).
