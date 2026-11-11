# 57-2a — complete own tips API after the approved functional split

Approved technical extension, correction R1/3: see the verbatim manager decision in
`57-2a-aggregate-authorization.ar.md`, recorded before source correction. Inventory
adds a monthly-only bigint domain aggregator/formatter and domain tests under
`packages/domain`, a monthly response-only contract scalar, and DB/HTTP/contract
overflow regressions. Per-entry Money/sessionMoney, existing visit aggregation,
write paths and tables remain unchanged. The monthly scalar alone may represent
the exact larger nonnegative sum. All additions/deletions remain inside A's 3400
and combined A+B 5600 limits; recount after code, generated artifacts and receipts.

R2/3 documentation correction inventory: record the manager's task-specific
ordering withdrawal in `57-2a-ordering-authorization.ar.md`, synchronize the
current order statements, and add the exact OwnWorkReads dependency rationale and
consequences to ADR-0041 with a module-map reference. No reader/API change follows.

## Authority and lineage

Operational update, 2026-11-07: the manager withdrew the automatic wait for
68-1b/#897 after the limited PP-136 consultation found no technical dependency or
independent owner constraint. The earlier administrative order below and in the
verbatim authorization is historical, not a current requirement to wait for #897.
The committed task-specific authority and exact manager excerpts are in
`57-2a-ordering-authorization.ar.md`; no dependency on publishing PP-138 is added.
PP-138's canonical reference is `docs/owner-decisions.ar.md` item 95, imported
2026-11-11 from the manager checkout's local section 74.
Test-resource order remains separate: G, this unit, then card 3, with direct
handoff; yield immediately if a blocker prevents using the resource.
Notify the owning manager directly on phase completion, readiness or a blocker,
with task/PR, exact head, actual results, remaining work and next action/decision.
No separate push is made for this operational record. Exact-head freshness,
reviews, applicable backup/restore and coordinated merge gates remain required.

The manager explicitly approved the A/B functional split and staged delivery under
Waleed's night delegation. The verbatim decision is preserved alongside this brief
in `57-2a-manager-authorization.ar.md`; it is a manager decision, not a new owner
quotation. `split-proposal-r2.ar.md` supplies the approved inventory.

Original PR #894 is superseded without merge. Its final head, 3/3 exhausted rounds,
3,143 changed lines, P1 finding and complete history remain preserved; there is no
reset. P1 https://github.com/lolotam/PayPos.systems/pull/894#discussion_r4498824739
remains unresolved and binds planned unit 57-2b until a proven fix.

Gate 0 must complete before source edits: durable archive/hash and commit/ref
verification, final superseded comment, close #894 unmerged without resolving P1,
then read back closure and comment. Preserve its branch/worktree/checkpoint.

## Implementer and isolation

The same existing delivery session owns 57-2a and later 57-2b, sequentially, one
active PR at a time. No new top-level thread, extra task slot or duplicate implementer.
Implementer remains Codex gpt-6.1-sol, reasoningEffort medium, serviceTier default
(standard). Use T3-owned isolation from live main; no shell worktree or checkout
setup and no copying secrets. Verify new workspace/path/branch/full base SHA/status
before edits. Inventory env names/ownership/ignore only; do not read existing values.
Read the six governing documents and complete delivery pipeline from that checkout.
Record this brief and manager decision before implementation source edits.

## Complete scope

Ship GET /v1/staff/me/tips only, with the previously approved VISIBLE/HIDDEN contracts.
Do not ship the own service-lines query, route, OpenAPI operation, generated client
operation or stub. No unused future-only readers/projections are included for B.

- Staff `readOwnEmployee` and identity `readOwnServiceSessionsAccess` public readers,
  with provider-owned SQL, same transaction and sampled clock as the caller.
- Orders used-only own-work context adapter/read interface, domain month-window
  callback, period/column settings readers, and injected domain tip aggregation.
- Live own permission, feature/membership/employee/attachment checks, private-window
  STAFF_POS policy, personal staff route and no-store on success and refusal.
- Caller/session determines employee/company/business. Current device branch proves
  authority without narrowing historical tips in the session business. Client scope
  keys are rejected. No new financial arithmetic in the read layer.
- HIDDEN returns exactly month/status after authority/window checks, with zero tip
  query or amount materialisation/aggregation. VISIBLE reads only the employee's
  current-revision CASH/CARD amounts, without a truncating limit.
- Extract the identical ownWorkMonth validator to a shared contract file, preserving
  its accepted YYYY-MM language; own-tips must not import own-service-lines.
- Module composition/public exports additions only; update module-map and generate
  OpenAPI plus admin/POS/menu clients on the actual main base, preserving its format.

D1–D3 and Q1–Q5 are unchanged. Service-line-specific D2/Q1/Q4/Q5 implementation is
reserved for B, not weakened or exposed as a partial endpoint in A.

## Tests and evidence

Adapt the HTTP tests to call tips and assert its actual shape, not `items`. Cover
personal/kiosk sessions, private window idle/cap/replacement, live post-guard
eligibility refusals, DENY, client scope rejection, no-store and log privacy.
Create eligible real data/positive reads in foreign businesses/tenants before
asserting exclusion and refusals. Retain strict HIDDEN/no-query/no-callback tests,
current revision and colleague/superseded exclusion, month windows and shared domain
tests. Tips tests must have no dependency on ownServiceLinesStatement or its page,
cursor or EXPLAIN helpers. Include historical/business authority cases relevant to tips.

Retain representative 600 visits/602 own current-revision tip entries and exact
CASH 2.100 / CARD 2.250 evidence, query + driver/array materialisation + domain
aggregation timing and heap/RSS measurement, under 200 ms without raised timeouts,
planner/config/index changes or dropped rows. Post-seed ANALYZE is benchmark
preparation, not a claim to cure B's query. Keep appropriate EXPLAIN/index evidence
for the tips query without requiring an entry-table index for an all-matching scan.

Before any push report local size, coverage and explicit absence of the service-lines
route/operation from OpenAPI and all three generated clients. Obtain a fresh
independent review after separation and test adaptation, then all applicable gates.

## Delivery and size

57-2a expected size: 1,700 ALL changed lines; refuse above 3,400. Count all +/- in
production/tests/docs/generated, including audit/brief/spec changes. New unit has
at most three correction rounds, starting 0/3; original #894 remains 3/3 history.
57-2b is planning only: expected 1,800/refuse 3,600, no code/experiment/dispatch until
its query-hardening design is presented and approved. Additional combined cap for
A+B delivered diffs: 5,600 including repetition. Original unmerged #894's 3,143 is
historical and excluded from the delivered A+B sum. Stop before proceeding if a cap
is exceeded; do not silently increase a brief.

Record the split in spec 060 A.5: 57-2 is complete only after A+B; 57-4 waits for both.
No UI scope change or claim of overall completion after A. Current coordination:
A need not wait for 68-1b/#897 (see `57-2a-ordering-authorization.ar.md`); test
resource order is separate from merge eligibility. B may begin implementation
only after A merges and its separate design authorization is received.

One PR for A after the pre-push report, independent review and local gates. Wait all
four panel reviews on each current head, consolidate correction pushes, Codex once
on the final head, exact-head CI and applicable backup/restore plus merge turn.
No migration/index/config/deploy, no fourth correction on #894 or P1 issue deferral.
