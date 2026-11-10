# #836 — Full discount-proposal binding FK index

Baseline: `ff551062ce56a9a57cd6aa7a9abd6f67e1a2bbb2`. Issue: <https://github.com/lolotam/PayPos.systems/issues/836>.

## Requirements

- Declare a nonunique, nonpartial B-tree index on `service_lines` with ordered key columns `(company_id, discount_proposal_id, id, business_id, service_id)` and `.concurrently()`.
- Preserve current indexes, foreign keys, grants, RLS and financial data. Never rewrite merged migrations or their historical comments.
- The eventual migration uses the existing concurrent-index runner, with concurrent statements first and recognized breakpoints. Provisional number `0217` is finalized against main at integration.
- Executable migration, schema and snapshot/journal must agree. Worker prepares schema/tests only; `I836-Q1` in `owner-questions.ar.md` authorizes the manager alone to generate/integrate migration metadata after source review.

## Acceptance and proof

Real PostgreSQL catalog assertions verify exact key order, B-tree method, no uniqueness/predicate, `indisvalid` and `indisready`. Existing proposal binding/consumption tests must pass. After authorized generation, apply on fresh and populated fixtures through the real runner, verify safe repeated application and migration-chain consistency.

## Scope

Worker may edit `packages/db/schema/orders.ts`, one dedicated `packages/db/src/__tests__/discount-proposal-binding-index.spec.ts`, and this task's docs. Read existing adjacent fixtures without editing them. No migration/meta/runner changes by worker. No root configuration, lockfile, contracts, auth or shared documentation edits.

## Delivery

Expected authored additions plus deletions: 150 lines, generated artifacts separate. More than 300 requires rescoping. No broader FK audit, index removal or constraint changes.
