# ADR-0045 — Performer identity snapshot for the self-edit rule, and the editor role label

Date: 2026-10-16. Status: Accepted design for spec 050 row 35d (technical decision; no owner question — the merge of this
PR is the acceptance). Issues: #250, #252, #255. Owner answers it implements: ED-Q4, ED-Q13 (Waleed, 2026-10-13/16; Abu Salem has
not answered, his pick binds if different). Related: [spec-35d](../specs/050-orders-record-service-session/spec-35d.md),
[plan-35d](../specs/050-orders-record-service-session/plan-35d.md), ADR-0044 §5, ADR-0038, spec 050 SS-25.

## Context

**Self-edit (#250).** ED-Q4 forbids editing a line you performed, like recording (SS-25: even an unlimited owner). Recording
decides it by comparing the recorder's user with the performers' *current* `employees.user_id`. `line_performers` stores
employee ids only. On an edit, weeks later, the link may have been removed or moved: the original performer's user could edit
their own historical line, and a newly linked user could be treated as the performer. Plan-35d §8 therefore gated 35d-4 on a
decision.

**Editor label (#252, #255).** ED-Q13 shows an editor with no employee record as a role («المالك» / «المدير»). Plan-35d stored
`editor_role` as `owner|manager`. But `edit:service-line-prices:branch` is delegable to every human role (ED-Q1), so an
accountant, a receptionist or a company-defined role can edit with no employee record and the two values cannot describe them.

## Decision

### 1. Performer identity = snapshot ∪ current link

`line_performers` gains `linked_user_id uuid NULL` (FK to `"user"(id)`), written at insert by record and append (and by 37b for
added performers) from `SessionEmployee.user_id`, which `PerformerCheckPort.read` already returns inside the recording
transaction: no new port and no new arrow. The column is immutable (the table keeps `SELECT, INSERT` grants only).
The self-edit rule refuses when the editor's user equals any performer's `linked_user_id` **or** that performer's current
`employees.user_id` (read under `PerformerCheckPort.lock`, `FOR SHARE`, in the edit transaction). Null never matches.

There is **no backfill**. `line_performers` also gains `linked_user_snapshotted boolean NOT NULL DEFAULT false`; record and
append (and 37b, for performers it adds) write `true`. Existing rows, and rows inserted by an old instance during a rolling deploy, read `false`, and the edit
refuses such a line (`SESSION_EDIT_IDENTITY_UNKNOWN`, fail closed): its performers' identity at recording time cannot be
proven. A backfill would store the link at migration time, which cannot close the bypass when the link moved earlier, and a
tenant-row write by the migration owner is outside `CLAUDE.md` §5 / ADR-0038 (a data step runs as `pospay_app` and would need
a permanent `UPDATE` grant that breaks the column's immutability). The cost is that pre-35d-3b lines are not editable; Phase 1
has no production data (the salon pilot, row 63, has not started), so only staging test lines are affected.

Consequence accepted: a user who *was* linked to a performer at recording and was later moved off cannot edit that old line.
Another manager can. A false refusal is the safe direction for a commission-integrity rule.

**Rejected — link history.** No such table exists; it would be a staff-owned append-only history, and orders would need a
cross-module historical read (a new port and a module-map arrow) for a rule that is otherwise pure orders data. It answers
"who was linked at time T" more exactly than a snapshot but only for changes made after it exists, so it has the same backfill
limit. **Rejected — current link only:** bypassable, which is the bug #250 reports.

### 2. Editor label = real role + name snapshot + one pure function

The history row stores, at commit, the role of the membership the edit was made under: `editor_role` (the role code; the CHECK
is widened from `owner|manager` to the `roles_code_format` pattern), `editor_role_is_system` (global role vs company role) and
`editor_role_name_ar` / `editor_role_name_en` (the role's names then). A new CHECK requires `editor_name_en IS NOT NULL OR
editor_role IS NOT NULL`, so no row can lack a readable "who". The names of the active employee in the line's business stay as
shipped by 35d-3.

One pure function `editorLabel` in `packages/i18n` (beside `roleName`) computes the displayed label for both the worker bell and
the history read: the employee name if present; otherwise, for a system role, owner → «المالك»/Owner and the three manager
roles → «المدير»/Manager (ED-Q13 as answered), and every other system role through the owner-approved `roleName` table
(2026-10-03); for a company role, its own snapshotted name. Anything failing the display-name filter becomes a generic label.
Nothing else stores a label string.

**Rejected — refuse the permission for editors with no employee** (#255 option 3): contradicts ED-Q1 (delegable to any role) and
ED-Q13 (an owner who is not an employee must be able to edit). **Rejected — keep a two-value enum:** untruthful for every other
role. **Rejected — look the role up when the bell is built:** a renamed or removed role would change a committed row.

No new owner decision is needed: wording for the 13 system roles was approved on 2026-10-03; ED-Q13 chose "role only" and fixed
the wording of the two labels it names; a company role's name is whatever its owner typed.

## Consequences

- A storage sub-PR **35d-3b** (~250–350 lines) lands before the writer; a small **35d-2b** (~120–200) widens the bell consumer's
  label use. 35d-4 starts only after ED-Q14 is answered and 35d-3b and 35d-2b have landed. Sizes and gates are in spec-35d §5.
- Migration numbering follows merge order (after 35d-2's).
- The `TODO(spec)` comment on `editorRole` in `packages/db/schema/orders.ts` is removed by 35d-3b.
- 37b decided, in its own spec ([spec 055](../specs/055-orders-change-line-performers/spec.md) D-3): a performer it removes keeps blocking (her snapshot moves to the change history, never deleted); it also writes `linked_user_id` and `linked_user_snapshotted = true` for performers it adds (a non-null `linked_user_id` with the default `false` is rejected by the CHECK; an unlinked performer left at `false` would make the line permanently non-editable).
- No module-map change: the role snapshot is returned by the identity read `SessionEditAccessPort` already performs; if that
  needs a new export symbol, 35d-4 declares its §6 entry.
- The catalogs say «المالك» (bell) and «صاحب الشركة» (permissions screen) for the owner role; unifying is a copy change.

## Addendum (row 37b-2, performer change storage)

`line_performers` now also carries `DELETE` for `pospay_app`, but only through a performer change: a `BEFORE DELETE` trigger refuses any row that has no field-for-field matching `BEFORE` row (identity, snapshot flag and warnings included) under a history header created by the same transaction at the line's target revision, and deferred completion checks refuse the commit unless the `AFTER` rows equal the live set and a kept performer keeps her recording-time snapshot. The column `linked_user_id` is still never `UPDATE`d; a removed performer's recorded identity survives in the `BEFORE` rows (`service_line_performer_change_rows`, insert-only), which the retained-identity read of 37b-4d unions with the live rows so the self rule keeps blocking every writer of the line. See spec 055 §6.
