# Data model — 048 employee default shifts

## `employee_default_shifts` (new, tenant table)

| Column | Type | Rule |
|---|---|---|
| `company_id` | uuid NOT NULL | tenant key, RLS predicate |
| `business_id` | uuid NOT NULL | the employee's and the branch's business |
| `employee_id` | uuid NOT NULL | FK `(company_id, business_id, employee_id) → employees(company_id, business_id, id)` |
| `branch_id` | uuid NOT NULL | FK `(company_id, business_id, branch_id) → branches(company_id, business_id, id)` (DH-Q7) |
| `day` | smallint NOT NULL | CHECK `0 … 6`, 0 = Saturday, as schedules (DH-Q2) |
| `start`, `end` | time NOT NULL | branch-local; overnight when `end <= start`; ≤ 16 h checked in the domain (DH-Q1) |
| `break_start`, `break_end` | time NULL | both NULL or both NOT NULL (CHECK); strictly inside the day, checked in the domain (BW-Q6) |
| `updated_by` | uuid NOT NULL | → `user(id)`, indexed |
| `updated_at` | timestamptz NOT NULL | |

- PK `(company_id, employee_id, branch_id, day)`. Index `(company_id, business_id, branch_id)` (grid, report).
- RLS ENABLE + FORCE; `pospay_app` SELECT / INSERT / DELETE on `company_id = app_company_id()`; no UPDATE (a branch's
  set is replaced by delete + insert).
- No backfill. No rows for a currently linked branch = the profile notice (DH-Q6).

## Derived values (pure, `packages/domain`)

- Day length in minutes = `end − start` (+1440 when overnight); the break is not subtracted (BW-Q4).
- Contracted minutes (employee, branch, range) = Σ day length of that weekday's entry over the dates of the range on
  which the employee is employed (`hire_date ≤ d`, `contract_end` null or `≥ d`) and linked to the branch
  (`from ≤ d` and (`to` null or `d < to`)). Example: Sara, Salmiya, October 2026 = 228 h.

## Audit

Entity `employee_default_shifts`, entity id = employee id, action `updated`, before/after `{ branch_id, shifts }`.
