# 43-1 storage plan — PP-121

Status: bounded implementation approved in `43-1-manager-plan-review.md`.
All six Astra resolutions accepted. Migration generation,
numbering and push also await a separate explicit `lane granted` message.
Local implementation and candidate results are in `43-1-private-test-receipt.md`;
the original planning checkpoints below remain historical.

## Owner decision and sequencing

PP-121, source time 2026-11-04 23:50 Asia/Kuwait, relayed from Waleed's
speed-analysis session into this existing PP-120 task session:
«نفس الجلسة تعمل 43-1 الأول».

The owner explicitly authorizes this same Codex `gpt-6.1-sol`, medium session to
implement the full spec 058 43-1 storage/contracts/guards scope first, verify it on
its own private Docker cluster, then continue 43-1b after storage lands. This is a
sequencing exception, not a quality-gate waiver. Preserve the original blocker in
`43-1b-dependency-blocker.md` as history and preserve all correction budgets.

One scoped PR at a time. The manager owns merge sequencing and trial merges.
No merge, deploy, shared/staging database modification, or claim to migration
0204 is authorized. Migration renumbering, `db:generate`, and push wait for an
explicit manager message saying `lane granted`. No lane has been granted.
The current queue remains #793, then #785. No new top-level session or model
substitution. No Opus/Claude request in any role without Waleed approval.

## Proposed scope and estimate

1. Schema and reviewed SQL: `packages/db/schema/orders-packages.ts`, the existing
   service-line schema and schema exports as needed; a new redemption table with
   tenant/business keys, exact grants, RLS, reversal pairing, deferred FKs and
   child-side indexes; nullable immutable `service_lines.redemption_id`; the slot
   redemption FK/index. Keep migration SQL unnumbered outside the migration journal
   until the lane grant; do not generate snapshots before then.
2. Immediate and deferred guards: replace the existing slot guard without losing
   its refusals or seals; open only FREE/USED transitions. Enforce redemption/line
   reciprocity, service/customer matching, exact slot money and zero discount,
   redemption/slot reciprocity, one-time cancellation-backed reversal, and
   redeemed-line cancellation integrity. Read final rows at deferred check time.
   Keep expiry/refund transitions closed for their later slices.
3. Contracts: widen the package member of all three existing line event schemas
   and add the strict package draft union. Update cancel/performer refinements and
   contract tests where they share those shapes. Preserve old paid drafts/events.
   No redemption writer, route, UI, sale code or generic authorization change.
4. Tests and grants: add focused redemption isolation/guard specs and fixtures;
   extend `package-fk-indexes.spec.ts`, `test/package-grants.ts` and the existing
   privilege inventory. Add relevant docs and generated contract artifacts only
   when the confirmed contract tooling requires them.

Historical preliminary estimate: 1,000–1,600 authored changed lines. Astra's full
matrix shows that estimate was optimistic. The reviewed proposal is 1,700–2,500
authored changed lines in approximately 18–25 files, including SQL, tests and docs.
The original 43-1b estimate remains 300–700 lines in its later separate PR.

Generated changes have a separate proposed ceiling of 30,000 changed lines:
one new schema snapshot (the current 0203 snapshot has 26,369 lines), its journal
entry, OpenAPI event/standalone-schema changes and affected generated clients.
Proposed combined ceiling: 32,500 authored plus generated changed lines. These are
review bounds, not measurements or authorization to exceed the manager's scope.
Do not create an extra duplicate snapshot through a second custom migration merely
to hold guard SQL. Prefer one generated schema migration, augmented with reviewed
custom SQL in dependency order, after the lane grant. If tooling or the rebased
baseline requires more generated output, stop and present a bounded split/revised
artifact plan before generation/publication. Report additions plus deletions for
authored, generated and combined totals after every gate/push; do not hide generated
files from the combined count. No application or generated change exists yet.

## Private verification

Reserve a unique task-owned Docker project/container and loopback Postgres port,
with a new volume; do not reuse any existing container merely because its name
mentions 43. Use PostgreSQL 16 and the existing ADR-0006 migration/clone harness,
one cloned database per spec file. Credentials must remain local and secret-free
in receipts. Inspect the harness before running it. Docker inventory is available;
no task-owned cluster has been created yet.

Before seeding each new private clone, a task-local fixture applies
`43-1-candidate.sql` after the journalled baseline. It refuses any connection
outside the verified task-owned PG16 loopback lane. The candidate is the same SQL
intended for the eventual migration; the production journal and shared bootstrap
remain unchanged. Candidate receipts are distinct from baseline receipts. After
the lane grant, rerun against the actual generated and journalled artifacts;
candidate success does not certify the future migration.

Exercise positive redeem/reverse/reuse sequences and negative cases as pospay_app:
cross-tenant and same-tenant cross-business references; missing/crossed line,
wrong customer/service, every money mismatch; orphan live redemption; slot
repointing to reversed or unrelated redemption; cancellation without reversal,
wrong cancellation and second reversal. Include SET CONSTRAINTS IMMEDIATE and
re-deferred checks, earlier storage guard regressions, exact grants and FK indexes.
Existing 42-2 tests that require all forward transitions closed may need narrowly
updated expectations; retain negative coverage for invalid transitions.

Local PP-113 checks: focused database and contract suites, typecheck, lint,
lint:docs and boundaries/module-map checks. No full application/E2E suite locally.
After lane grant and publication, require internal Astra code review, all five
GitHub receipts and CI on the exact head. One consolidated correction push only
after all current-head receipts finish; missing/failed receipts do not count.
Five-round cap remains; no correction round has been consumed in this session.

## Astra advice and parent resolution

Exact response: [astra-43-1-design-receipt.md](astra-43-1-design-receipt.md).
Codex `gpt-6-astra`, `high`, completed 2026-11-04T21:26:13.926Z;
runtime 548.702 seconds. This is design advice only. All six findings are accepted
and resolved in this design; implementation and tests must still prove them.

| Finding | Design resolution and verification |
| --- | --- |
| A1, P1: final-state checks on both ends, including removed links | Queue checks on redemption insert/reversal, line insert/relevant update/status, and slot state/pointer changes. OLD/NEW identify affected IDs only; validators reload current rows. A released slot must have no live redemption, and a reassigned pointer must leave no previous live owner. Cover complete pair → IMMEDIATE → DEFERRED → mutate each end separately, including USED→USED pointer changes. |
| A2, P1: one-time reversal paired with cancellation | INSERT requires both reversal fields NULL. UPDATE allows only the paired NULL→value transition and freezes every other field; any second reversal, clearing, partial pair or changed timestamp/cancellation fails. Deferred validation joins the cancellation of this exact line and its final CANCELLED state. Retain 054's revision/previous-money completion checks. A reversed redemption's slot may be FREE or USED by a different matching live redemption, allowing redeem→reverse→reuse in one transaction. No expiry gate on cancellation and no new transaction seal for reversal. |
| A3, P1: immediate marker/money immutability | No new service-line UPDATE grant. A dedicated BEFORE guard forbids adding, clearing or changing redemption_id after insert and changing money on a redeemed line. Deferred checks prove reciprocal IDs, same company/business/entitlement/component/slot, visit customer equal to entitlement customer, matching service, list_price=price=net=unit_value and zero discount/bps. Preserve cancelled-row freeze and existing performer/history guards. Serving branch need not equal sale branch. No 43-1b use-case refusal in this PR. |
| A4, P1: union definition without route activation | Export a strict standalone package-draft schema and paid/package union; leave sessionLineInput and record/append route request contracts paid-only until 43-2. Paid draft retains optional discount_proposal_id; package draft rejects it, price, discount and extra nested package keys. Publish standalone schema documentation without widening request bodies. Events widen package from null to the strict object in all three envelopes; no defaults or rewritten old bodies. Keep recorded lines ACTIVE/revision 1 without change; kind-dependent change validation additionally forbids package PRICE_DISCOUNT_EDIT. |
| A5, P1: preserve 42-2 closures | New SQL replaces only package_session_slots_update_guard() under its existing signature. Allow FREE↔USED and only finally valid pointer changes, with deferred checks; preserve immutable slot fields, terminal states, component/slot insertion seals and conservation. Entitlement expiry/refund/revision remain closed. Never edit merged 0200. Rerun prior storage negatives with only the obsolete unconditional FREE/USED closure expectations narrowed. |
| A6, P2: complete inventory/circular FK representation | Update test/function-inventory.ts and test/tenant-table-inventory.ts alongside package-grants/privileges. Use SQL for deferred circular FKs following existing project precedent; document those SQL-owned constraints beside schema columns rather than adding a schema-module import cycle. Assert FK targets, order and deferrability through catalog tests. |

### Keys, grants and indexes

`package_redemptions` has PK `(company_id,id)`, candidate key
`(company_id,business_id,id)`, unique `(company_id,line_id)` and live-only unique
`(company_id,slot_id) WHERE reversed_at IS NULL`. The live-only unique is not an
FK-support index. Preserve company FK coverage too.

| FK | Child-side leading index columns | Deferred initially |
| --- | --- | --- |
| redemption→component | company_id,business_id,entitlement_id,component_id | no |
| redemption→slot | company_id,business_id,slot_id | yes |
| redemption→line | company_id,business_id,line_id | yes |
| redemption→user | recorded_by | no |
| redemption→membership | company_id,recorded_by,recorded_by_membership_id | no |
| redemption→cancellation | company_id,reversal_cancellation_id, partial IS NOT NULL | yes |
| line→redemption | company_id,business_id,redemption_id, partial IS NOT NULL | yes |
| slot→redemption | company_id,business_id,current_redemption_id, partial IS NOT NULL | yes |

ENABLE/FORCE RLS on the new table, USING/WITH CHECK on app_company_id(). Runtime
grants: SELECT, INSERT and UPDATE(reversed_at,reversal_cancellation_id) only;
no DELETE/TRUNCATE/table-wide UPDATE. Slots retain UPDATE(state,current_redemption_id),
components retain lock_touch solely for row locks, and service_lines gains no UPDATE
privilege. Functions remain SECURITY INVOKER with pinned search_path, restricted
EXECUTE and no PUBLIC privilege. Inventory tests verify inherited access too.

### Concrete authored file groups

- `packages/db/schema/orders-packages.ts`, `schema/orders.ts`, schema exports only
  if needed; one future numbered migration and its generated snapshot/journal.
- New `packages/db/src/__tests__/package-redemption-*.spec.ts` files split by
  links, reversal, isolation and concurrency; new `test/package-redemption-fixture.ts`.
- Existing package FK-index, storage-guard, privilege and tenant/function inventory
  tests and `test/package-grants.ts`, with narrowly required expectations only.
- `packages/contracts/src/orders/service-session.ts`, standalone draft schema if
  needed for file size, contract export/registration and focused contract specs.
  Existing cancel/performer refinements move only where shared event shape requires it.
- This plan, receipt and owner audit. Generated OpenAPI/clients only for changed
  schemas; no route request advertises redemption acceptance before 43-2.

The complete test matrix in the exact receipt is adopted, including per-column
money mutations, wrong-customer/cross-business pairs, duplicate IDs across tenants,
marker immutability even with privileged fixture writes, reversal/reuse, rollback
and savepoints, two-connection contention, RLS/context reuse, exact ACL/catalog
assertions, 42-2 seals/terminal-state regressions, and paid-writer/replay compatibility.
Existing writer tests stay focused; 43-2 owns date/expiry/lowest-slot/request rules.

## Reading and private test preparation receipt

Full prerequisite reading is complete across this session's turns, with truncated
segments reread in bounded output before this final design. Sources: AGENTS.md;
CLAUDE.md; CLAUDE.architecture.md; docs/06_Tech_Stack_Architecture_EN.md;
docs/module-map.md; .specify/memory/constitution.md; docs/PRD.md;
docs/agent-delivery-pipeline.md; full spec 058 and its owner record; 054 and 055
specs/owner records; 050 base spec, base plan, spec-35d, plan-35d and owner record;
phase-1/IMPLEMENTATION-PLAN.md. Relevant 054/055 delivery plans are their spec §7.
ADR-0006 and the actual database clone/global-setup/lane scripts were inspected.
Historical incomplete-reading statements in the original blocker remain unchanged.

The grilling frontier has no new business question. This plan resolves the two
technical choices Astra requested: standalone union staging and bidirectional
final-state coverage. Manager review remains required by the direct instruction.

Private cluster plan: `node scripts/test-db/lane.mjs up sol-43-storage-121 --port 55445`
only after verifying no existing container with that exact name and no existing
override owned by another lane. The helper copies the PG16 dev service, creates a
fresh anonymous volume, binds loopback only, labels the owning worktree and writes
the ignored test routing override. Verify actual container label, volume and port;
fail closed on mismatch. The existing harness migrates one template and clones per
spec. Never invoke the harness while it could fall back to port 5432. Do not run
`infra:up` or attach to goal-a-43/shared/staging containers. No private cluster has
been created and no database test has run at this checkpoint.

## Gates still open

- Manager's required one-time review completed and approved; ceilings are 2500
  authored, 30000 generated and 32500 combined additions plus deletions, including
  all documentation and receipts. Stop for split/artifact review if exceeded.
- Parent's design review completed: accepted all six findings, checked against
  the spec, existing contracts, 0200 slot guard, ADR-0006 and test harness. This
  does not substitute for the manager's review or later internal code review.
- Receive explicit migration lane grant before generation, numbering or push.
- Coordinate the storage PR and subsequent guard PR with the manager. Storage
  must land first; no dependent 43-1b code is included in the storage PR.

Trial receipts: prior dependency inspection was approximately three minutes.
Record new elapsed phases separately; exact provider tokens/cost/quota are not
exposed by the available runtime and must not be invented.
