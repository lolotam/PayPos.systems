# Data model: statements chain delivery

The authoritative column lists are in [spec 059](../spec.md) §6 _Schema changes_. This file names what each part
adds on top of `origin/main` `7c5a318e` and the invariants its tests prove. It defines one table that spec 059 implies
but does not list (the per-employee payment record, research R7).

## Existing at the base (unchanged by this delivery unless noted)

| Object | Note |
| --- | --- |
| `commission_statements` | status `DRAFT` / `REVIEWED` / `APPROVED` / `PAID`; the five fingerprint columns; 54-1 adds the payment columns and replaces the update guard |
| `commission_statement_lines`, `commission_statement_attachments` | insert-only, guarded by `commission_statement_frozen_insert_guard`; kinds already include `CARRY_COMMISSION` and `CARRY_TIP_CARD` |
| `commission_plan_versions` | a repair row has `repair_period` set and `effective_from` = the first day of that month (existing CHECKs) |
| `commission_corrections`, `commission_period_generations`, `commission_blocked_corrections` | written by the correction step; 55-2f writes through the same step |
| `commission_statement_exports` | 56-1c writes requests and `collected_at` |
| `alert_rules` | `recipient_roles text[]`; #486 adds a CHECK for the statement kinds |

## Added

### `commission_carries` — 51-1 PR 1, written by 53-2

Columns and constraints as spec 059 §6: `employee_id`, `kind` (`COMMISSION`, `TIP_CARD`), `amount` (< 0),
`source_statement_id`, `source_period`, `target_period` (> source), `target_statement_id`, `created_at`.
`UNIQUE (company_id, source_statement_id, employee_id, kind)`; `CHECK (kind IN ('COMMISSION', 'TIP_CARD'))`
(`commission_carries_kind`: the ledger is append-only for the app role, so a row with another kind could never be
repaired and would break every estimate that reads it); the two composite statement FKs and the employee FK,
each with an index on its exact columns. Insert-only. **State:** a carry is written once at approval of its source
month and read by its target month's estimate, fingerprint and freeze. **Isolation test:** CM-R11.

### `commission_statement_returns` — 52-1

`statement_id`, `returned_by`, `returned_membership_id`, `reason` (1…500 trimmed), `returned_at`. Insert-only; the
reason is never logged. **Isolation test:** CM-33c.

### Payment — 54-1

- On `commission_statements`: `paid_by`, `paid_at`, `paid_on date`, `paid_method` (the three choices of CS-Q6: «مع المرتب»,
  «تحويل بنكي», «كاش»; their stored codes are fixed by the part) and an optional note. Expand-only; the column grant and the APPROVED → PAID
  update guard are widened to exactly these columns.
- **Per-employee payment record** (new table; name fixed by the part, proposed `commission_statement_payments`):
  `statement_id`, `employee_id`, `exact_payable numeric(14,3)`, `paid_amount numeric(14,3)`. One row per frozen
  `EMPLOYEE` line of the statement. `UNIQUE (company_id, statement_id, employee_id)`; `CHECK (exact_payable >= 0)`,
  `CHECK (paid_amount >= 0)`; a tenant-and-business qualified FK to the statement; insert-only; an insert is accepted
  only in the transaction that sets the statement `PAID`, and only for an employee who has a frozen `EMPLOYEE` line in
  that same statement (a guard, tested with a same-company employee absent from the statement). The «same transaction» proof is its own
  column on the statement, set by the APPROVED → PAID transition and compared by the insert guard with
  `pg_current_xact_id()`, the mechanism the freeze uses with `approval_xact_id`; a check of `status` alone would accept
  a late insert. **Completeness is enforced by the database, not only by the use case:** membership of each row in the frozen set does
  not prove the set is whole. The transition to `PAID` is refused at commit unless the employees of the payment rows
  are exactly the employees of the statement's frozen `EMPLOYEE` lines. Because the status is updated before the rows
  are inserted (the insert guard needs the `PAID` proof), the check is deferred to commit (a deferred constraint
  trigger on the statement, in the same migration as the table). Test: mark-paid with one row left out fails and the
  statement is still `APPROVED` with no payment row. `paid_amount` = `exact_payable` rounded half up to 0.005 KWD
  when the method is cash, else equal (CS-Q12, D-19). The statement's paid total is the sum of `paid_amount`.
  **Isolation test:** named by the part and added to spec 059's table of named isolation tests in the same PR.

### Pending-event count — 53-1

No table. Role `pospay_approval_reader` (NOLOGIN, member of nothing); function
`public.statement_pending_commission_events(approval_started_at timestamptz) RETURNS bigint`; `SELECT` policies for
that role on `outbox` and `consumed_events`; column-level grants; no new index (withdrawn by CS-Q56, ADR-0012 addendum 2026-11-23). Everything as ADR-0012 §1–§2 states; this file adds nothing to it.

### Reminders — 56b-1

- `commission_statement_reminders`: `statement_id`, `kind`, `reminder_date`, `recipient_count`;
  `UNIQUE (company_id, statement_id, kind, reminder_date)`; insert-only. **Isolation test:** CM-R09.
- `operational_recovery_flags` (global, no RLS, D-24): `(id, code, raised_at, cleared_at, cleared_by)`; partial
  `UNIQUE (code) WHERE cleared_at IS NULL`; `CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))`. Grants: CS-Q31's
  `SELECT, INSERT` for `pospay_dispatcher` on this table only, plus whatever ADR-0061 names for the clear; nothing for
  `pospay_app` or `PUBLIC`.

## State transitions

```text
(no fingerprint) ──generate──► DRAFT ──review──► REVIEWED ──approve──► APPROVED ──mark paid──► PAID
                                 ▲                  │
                                 └── input change (D-5) or return by hand (FR-031)
```

A closed month (APPROVED, PAID) never returns; later changes are corrections or carries into the earliest DRAFT month
after it (D-13, D-22).
