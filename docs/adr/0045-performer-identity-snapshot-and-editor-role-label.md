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

Existing rows are backfilled once, best effort, with a plain SQL `UPDATE ... FROM employees` in the same migration, run by the
migration owner under the migration-0074 guard (`rolsuper OR rolbypassrls`) and idempotent (`WHERE linked_user_id IS NULL`),
as migration 0097 did. It is not an ADR-0038 data step: no TypeScript function is needed, and a data step runs as `pospay_app`,
which would need a permanent column `UPDATE` grant and defeat immutability. A backfilled value is the link at migration time,
possibly not the link at recording time; because the rule also checks the current link, it is never weaker than the interim
rule of issue #250 ("deny when the editor is linked to any performer now").

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
  label use. 35d-4 starts only after both. Sizes and gates are in spec-35d §5.
- Migration numbering follows merge order (after 35d-2's).
- The `TODO(spec)` comment on `editorRole` in `packages/db/schema/orders.ts` is removed by 35d-3b.
- 37b must write `linked_user_id` for performers it adds.
- No module-map change: the role snapshot is returned by the identity read `SessionEditAccessPort` already performs; if that
  needs a new export symbol, 35d-4 declares its §6 entry.
- The catalogs say «المالك» (bell) and «صاحب الشركة» (permissions screen) for the owner role; unifying is a copy change.
