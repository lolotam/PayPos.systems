# AGENTS.md — entry point for Codex and other agents

> **Owner override — 2026-11-04, PP-117 (owner-decisions.ar.md §55).** This current instruction supersedes the older Super Admin routing/approval clauses below.
> Super Admin and its automations are frozen until Waleed explicitly resumes them. Project managers and execution sessions continue; questions, approvals and material reports go directly to Waleed in the project conversation. Do not send requests/status to Super Admin or wait for SA-13/SA-16.
> Each PR's session may merge an ordinary PR without returning for manager approval only after the existing exact-head CI/review gates, resolved findings, verified applicable backup and coordinated merge order pass. A migration, deploy change or HOLD requires Waleed's direct decision; quality gates and unrelated restrictions remain.
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
in the slice's `owner-questions.ar.md` (or `docs/owner-decisions.ar.md` for process questions). Ask Waleed directly in
the project conversation (PP-117); Super Admin is frozen and is not an approval or routing hop. Feature/business
questions also go to the existing numbered decisions-page batch under `docs/decisions-site.md`; Abu Salem's differing
business pick still binds. Technical questions go to Waleed only, never onto that page. Keep unanswered rules
`PENDING` / `TODO(spec)` and stop only dependent work. Preserve the existing page publication and audit roles.

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
