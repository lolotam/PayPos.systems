# Lane B — generate and review (51-1 PR 1, 51-1 PR 2, then 52-1)

Read `COMMON.md` first. Your parts are 3, 4 and 6 of `plan.md` _Lane B_. Private database lane name: `stmt-b`.

## Sources

- `spec.md` (059): Story 5 and Story 6; FR-025…FR-031, FR-029b; D-4, D-5, D-6, D-20, D-22, D-25, D-26; §6
  _Fingerprint_, _Schema changes_ (`commission_carries`, `commission_statement_returns`), _Permissions_, _Error codes_;
  §7 rows 51-1 and 52-1; §9 (the payable formula with carries).
- `owner-questions.ar.md`: CS-Q2, CS-Q2b, CS-Q5, CS-Q7, CS-Q26, CS-Q29, CS-Q37, CS-Q38, and CS-Q52 (= PP-227, §61).
- `docs/owner-decisions.ar.md`: PP-192 (the two-PR split of 51-1), PP-101.
- `docs/adr/0054-…md` §5, §6; `docs/adr/0025-…md` and migration `0239` (the permission reference-data pattern).
- What 50-5 delivered: `55-1d-50-5-delivery/` and `apps/api/src/modules/commissions/use-cases/get-commission-estimate/`.
- This delivery: `research.md` R4, R6; `data-model.md`; `contracts/statement-flow.md`.

## Part 3 — 51-1 PR 1 (Heavy: migration, money) — **start now**

**Scope.**

1. `commission_carries`: schema, a table migration and an `-rls` migration (as 0232/0233 did), grants, the three FK
   indexes on their exact columns, the inventories (`tenant-table-inventory`, `table-grants`, `schema/index.ts`), and
   the named isolation test CM-R11. Build on your private cluster; **no number and no push until «lane granted»**.
2. In `packages/commissions-engine`: the canonical-input builder, the statement builder, the two fingerprint inputs,
   and their types. Pure. They emit KWD strings and ISO dates only (`canonicalJson` refuses bigint). Fix the full
   canonical contract of both fingerprints in the code's doc comments: every list's fields, null handling, tie order
   and date formats, exactly as §6 _Fingerprint_ lists them, with the open blocked corrections of the month in the
   input fingerprint (CS-Q38) and the incoming carries.
3. In the API `commissions` module: the hash port (`hash(value) → hex`) and its `persistence/` adapter over
   `canonicalJson` and SHA-256.
4. Incoming carries in the estimate: a reader for the carries whose `target_statement_id` is the month's statement,
   and their place in the assembly (§9 formula). `estimate-projection.ts` is already over the file limit: add new
   files and split, do not grow it. Every reader that builds an engine plan version selects `repair_period`.

**Tests.** Builder unit tests for every input kind and for ordering and null handling; the CM-34e round trip (the
statement fingerprint of the builder's output equals the one computed from the same rows read back in the frozen
shape); CM-R11; the estimate with a commission carry and a card-tip carry (they never net each other, BR-06).

**Size.** About 390. **Merge:** after 55-2f, unless your manager rules otherwise (`research.md` R4). Report «ready for
the lane» when the code and tests are green.

## Part 4 — 51-1 PR 2 (Heavy: permission, migration) — after PR 1 and 55-2f are merged

**Scope.** `use-cases/generate-statement/` and `use-cases/get-statement/` (the second has reader ports only, a
`READ ONLY` transaction, no lock, no row created: D-25, with the constructor-surface test); the statement controller
and contracts; the branch-names and customer-names reader ports bound at the root, with their Port rows in
`docs/module-map.md`; the permission `review:commissions:business`: a reference-data migration (catalog row; global
grants to owner, general_manager, business_manager), `ROLE_DEFAULTS`, `access-catalog`, `system-role-policy`,
`OWNER_GRANTED_PERMISSIONS` (identity and `packages/db`), identity's `OWNER_ONLY_EDIT_PERMISSIONS`, the i18n permission
name; error codes `COMMISSION_PERIOD_NOT_ENDED` and `COMMISSION_STATEMENT_BLOCKED`.

«Not generated» is `current_fingerprint IS NULL` (`research.md` R6): `GET` then returns `generated: false`; amend
FR-025's sentence in spec 059 in this PR. **`GET` has two response shapes (FR-025, CM-28c):** the business-wide one
with both fingerprints, `reviewed_*` and the changed-since-review flag and cause; the branch-scoped one with the
status and the filtered rows only and **no** whole-statement field. Two Zod shapes, never optional fields on one; the
use case picks the shape with the same predicate as the guards.
Generate and review are usable only by a business-wide reader (CS-Q26, FR-029); reuse the predicate the estimate
already uses, do not write a second one.

**Tests.** CM-27, CM-28, CM-28b, CM-28c, CM-29; the generate part of CM-33 and CM-33d (default holders, owner-only
grant and revoke through the existing parameterized permission-edit proofs); the migrate-only regression (a company
and memberships created before the migration hold the defaults without re-running the seed; other roles gain
nothing); the statement-view part of CM-23d…CM-23h; the statement-view clauses of CM-51 and CM-53b.

**Size.** About 460.

## Part 6 — 52-1 (Heavy: permission, migration) — after PR 2 and issue #486 are merged

**Scope.** `commission_statement_returns` with RLS and CM-33c; `use-cases/review-statement/` (stores both
fingerprints, FR-029) and `use-cases/return-statement/` (open to a holder of review **or** approve, FR-031) calling the merged pure planner
`planCommissionStatementReturn` (`domain/statement-return-plan.ts`) — reason validation, authorization, locking,
persistence, audit and outbox are yours; the refusal of FR-048 at review; `approve:commissions:business` registered
exactly like the review code but owner only; the FR-029b warning on the grant screen
(`apps/admin/src/permissions/ui/`) for both codes; error codes `COMMISSION_FINGERPRINT_STALE`,
`COMMISSION_RETURN_REASON_INVALID`, `COMMISSION_STATEMENT_NOT_REVIEWED`.

**The notice (CS-Q52 = PP-227).** `StatementAwaitingApproval` (contract, template, registrations, `events/published.ts`
with its Arabic doc comment). It reads the alert rule of its kind through a commissions `AlertRulesPort` adapter in the
API (pattern: the staff module's alert-rules port and adapter) **only for whether the kind is on and for its channel**.
Its recipients are everyone who can approve at the time the event is appended: the holders of
`approve:commissions:business` who are business-wide readers, resolved with the **same predicate function as the
approval guard** (FR-030: one function, shared), in the same transaction. The rule's roles do not select recipients for
this kind; say so in the port's doc comment and prove it with a test (a delegated approver who is not an owner is
notified; an owner role-holder who fails the predicate is not; kind off → nobody). Grouping as FR-030: de-duplicated,
sorted by user id, groups of at most 100. Abu Salem's pick is pending; if it differs your manager will tell you.

**Tests.** CM-30, CM-31, CM-32, CM-32b, the review parts of CM-33, CM-33b, CM-33c, CM-33d, the FR-029b UI test
(asserting what the user sees), the migrate-only regression for the approve code.

**Size.** 350–480. Lane D's 56b-1 edits the same notification files after you: tell your manager the moment 52-1 is
merge-ready.

## Not yours

The repair route, the pending count, approval, payments, exports, reminders, the alert-rule validator (#486, lane D).
