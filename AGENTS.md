# AGENTS.md — entry point for Codex and other agents

> **PP-118, 2026-11-04 17:23 Kuwait:** at most five active task sessions, one PR per session, retained until merge; readiness alone never frees a slot. After more than four hours waiting for Waleed's decision on a HOLD or PENDING question, or for a migration-lane turn (which the manager, not Waleed, resolves under PP-124), park the PR and free its slot; at most two parked PRs, and resume the original session after Waleed's decision, or, for a migration-lane wait, when the manager grants the lane. At two parked PRs report the decision bottleneck directly to Waleed. During transition, open no new slice until open non-parked PRs are at most five. Morning report: open PR count, oldest age and recommended next step. See `docs/owner-decisions.ar.md` §56 and pipeline §13.

> **Owner override — 2026-11-04, PP-117 (owner-decisions.ar.md §55).** This current instruction supersedes the older Super Admin routing/approval clauses below.
> **PP-72.2 / PP-119 — 2026-11-04 (owner correction 18:01 Kuwait; owner-decisions §§34, 57).** PP-72.2 is the single decision superseding PP-72.1 and PP-114.2/W1: remove duplicate `full-check`, its `ci-gate` needs/result references, and move admin/POS `api:check` into `check`, preserving all component checks. Until the separately reviewed workflow lands, the current workflow remains required; afterward older full `pnpm check` CI references mean equivalent distributed coverage. PP-119.1 requires all bots to finish on the current head before one consolidated correction push; missing/failed receipts are not complete. PP-119.2 (R2 remote cache) is DEFERRED: do not send a brief or implement/provision secrets now; measure actual CI after PP-72.2, then wait for Waleed's decision.
> Super Admin and its automations are frozen until Waleed explicitly resumes them. Project managers and execution sessions continue; questions, approvals and material reports go directly to Waleed in the project conversation. Do not send requests/status to Super Admin or wait for SA-13/SA-16.
> Each PR's session may merge an ordinary PR without returning for manager approval only after the existing exact-head CI/review gates, resolved findings, verified applicable backup and its verified restore, and coordinated merge order pass. Under PP-124 the manager merges a migration PR after these gates and the coordinated migration order pass, without asking Waleed; a deploy change, a production or production-data change, a server change, a secret change or a HOLD requires Waleed's direct decision; quality gates and unrelated restrictions remain.
> Send one consolidated update when a batch completes or a blocker needs Waleed's decision. End every manager report with a recommended next step. Preserve the existing owner-decision audit and partner/business decision-page duties.

This repository's rules are **not** duplicated here, so they cannot drift apart.
Read these files fully, in this order, before any task or any review:

1. [`CLAUDE.md`](./CLAUDE.md) — day-to-day rules for every slice (workflow, comments, DB, API, security, testing)
2. [`CLAUDE.architecture.md`](./CLAUDE.architecture.md) — where code goes and what it may import
3. [`docs/06_Tech_Stack_Architecture_EN.md`](./docs/06_Tech_Stack_Architecture_EN.md) — which technology
4. [`docs/module-map.md`](./docs/module-map.md) — the allowed arrows between modules
5. [`.specify/memory/constitution.md`](./.specify/memory/constitution.md) — the project constitution
6. [`docs/PRD.md`](./docs/PRD.md) — product scope and phases

Before every new task, also read [the owner-confirmed delivery pipeline](docs/agent-delivery-pipeline.md).

The names say "CLAUDE", but the rules apply to every agent equally.

**Owner questions.** Never guess an owner answer. Record every question, options, recommendation and answer verbatim
in the slice's `owner-questions.ar.md` (or `docs/owner-decisions.ar.md` for process questions). The project/task manager
asks Waleed directly in the project conversation (PP-117); Super Admin is frozen and is not an approval or routing
hop. Implementation/review workers record the question as `PENDING` / `TODO(spec)`, stop only dependent work and
hand it to their owning manager; they do not independently contact Waleed or publish a decisions-page batch.
Feature/business questions also go to the existing decisions page as a **new numbered batch** under
`docs/decisions-site.md`; Abu Salem's differing business pick still binds. Technical questions go to Waleed only,
never onto that page. Preserve the existing page publication and audit roles.

## Review guidelines

When reviewing a pull request, report only real defects, ranked by severity. Check first:

- a boundary violation from `CLAUDE.architecture.md` §3.1 (deep cross-module import, infrastructure in `domain/` or `use-cases/`)
- money held as a JS `number` instead of `bigint` mills or `Money`
- a tenant table without an RLS policy and a negative isolation test in the same PR
- arithmetic or business rules outside `domain/`
- `Date.now()` or `randomUUID()` inside a use case
- a `domain/`, `ports/` or `events/published.ts` export without an Arabic doc comment
- a secret, token or real customer phone number anywhere in the diff
- a guard that nests transactions, runs two at once, or opens a second transaction for a read that could share its `withTenant` (`CLAUDE.md` §6)
- `packages/db` throwing a plain `Error` for an outcome an API request can cause in normal use, instead of a typed error the API maps to a known code (`CLAUDE.md` §5)
- a UI test (one that renders a screen or component) that only checks a mock was called, with no assertion on what the user sees (`CLAUDE.md` §9)
