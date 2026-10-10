# Data model — 044 attendance change requests

## `attendance_change_requests` (new tenant table)

| Column | Type | Rule |
|---|---|---|
| `company_id` | uuid NOT NULL → companies | tenant key |
| `id` | uuid NOT NULL | UUID v7 |
| `business_id`, `branch_id`, `employee_id` | uuid NOT NULL | tenant-qualified FKs to employees and branches |
| `kind` | text NOT NULL | IN ('ADD_SESSION','VOID_SESSION') |
| `status` | text NOT NULL DEFAULT 'PENDING' | IN ('PENDING','APPROVED','REJECTED','CANCELLED') |
| `session_id` | uuid NULL | → `attendance_sessions (company_id, id)`; void target or created session |
| `session_revision` | integer NULL | ≥ 0; the session revision seen (void) |
| `reason` | text NOT NULL | `= btrim(reason)`, 1–500 characters |
| `requested_by` | uuid NOT NULL → user | |
| `requested_at` | timestamptz NOT NULL | |
| `decided_by` | uuid NULL → user | an owner |
| `decided_at` | timestamptz NULL | |
| `decision_reason` | text NULL | trimmed 1–500 when present |
| `cancelled_by` | uuid NULL → user | the requester |
| `cancelled_at` | timestamptz NULL | |
| `revision` | integer NOT NULL DEFAULT 0 | ≥ 0, +1 on every transition |

**CHECKs**: kind, status, revision ≥ 0, session_revision ≥ 0, reason bounds, decision_reason bounds, and the
status shape:

- PENDING ⇒ `decided_by`, `decided_at`, `decision_reason`, `cancelled_by`, `cancelled_at` all NULL
- APPROVED ⇒ `decided_by`, `decided_at` NOT NULL; cancelled NULL
- REJECTED ⇒ `decided_by`, `decided_at`, `decision_reason` NOT NULL; cancelled NULL (ACR-Q7)
- CANCELLED ⇒ `cancelled_by`, `cancelled_at` NOT NULL; decided and `decision_reason` NULL

**Indexes**: PK `(company_id, id)`; `(company_id, business_id, status, requested_at)`;
`(company_id, business_id, branch_id, status, requested_at)`; `(company_id, employee_id, requested_at)`;
`(company_id, session_id)`; `(company_id, requested_by)`; `(company_id, decided_by)`; `(company_id, cancelled_by)`;
partial UNIQUE `attendance_change_requests_one_pending_void` on `(company_id, session_id)` WHERE
`status = 'PENDING' AND kind = 'VOID_SESSION'`. The table is new, so plain `CREATE INDEX` is used (no
`CONCURRENTLY` needed on an empty new table).

**RLS and grants**: ENABLE + FORCE; policy `company_id = current_setting('app.company_id')::uuid` for all commands;
`pospay_app`: SELECT, INSERT, UPDATE (`status`, `decided_by`, `decided_at`, `decision_reason`, `cancelled_by`,
`cancelled_at`, `session_id`, `revision`); no DELETE, no TRUNCATE. Other runtime roles: none.

## State transitions

```text
          file (non-owner)            approve (decide holder, kind.check + kind.apply)
(none) ───────────────────► PENDING ─────────────────────────────► APPROVED
   │                          │  └── reject (decide holder, reason) ► REJECTED
   │                          └───── withdraw (requester) ────────► CANCELLED
   └── file (owner, one step: kind.check + kind.apply) ───────────► APPROVED
```

Terminal states never change again. No row is ever deleted. No expiry (ACR-Q9).

## Permission

| Code | Default holders | Device |
|---|---|---|
| `request:attendance-change:branch` | owner, general_manager, business_manager, branch_manager | forbidden |
| `decide:attendance-change:company` | owner only (ACR-Q4 option 2); only an owner may grant/revoke it | forbidden |

Approve/reject: holders of `decide:attendance-change:company`; non-owner holders never decide their own filings or
their own attendance (research R1).

`kind` CHECK lists kinds explicitly; 26c extends it with `RESTORE_SESSION` (ACR-Q21 option 2).
