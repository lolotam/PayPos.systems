# ADR-0048 — A restore-stable write seal: `(write_system_id, write_xid)`

- **Status:** Proposed
- **Date:** 2026-10-20
- **Issue:** #338
- **Scope:** `packages/db` — `session_tip_revisions`, `service_line_performer_changes`

## Context

**The seal.** A performer change (`service_line_performer_changes`, migration 0144) and a tip
revision (`session_tip_revisions`, migration 0145) are written in the same transaction as the rows
they authorise. The header row carries `write_xid`, stamped by a `BEFORE INSERT` trigger with
`pg_current_xact_id()`. The guards then accept a child row only when the parent's
`write_xid = pg_current_xact_id()`: a tip entry, a performer side row, a `line_performers` DELETE,
or a `service_lines` revision move. The rule is what makes the write atomic — a child row cannot
attach to a header that some earlier, already-committed transaction wrote.

**The problem.** A transaction id is cluster-local and carries no history of its own. A logical
restore (`initdb` + `pg_restore`) into a fresh cluster gives that cluster a **new**
`system_identifier` and an XID counter that starts low, while the restored `write_xid` values stay
in the dump as plain data. When the new counter reaches a restored value, that one transaction
sees an old committed header as its own:

- a late `session_tips` row lands in an old committed tip revision — money recorded twice, with no
  event for it;
- a late performer side row, or an unjustified `line_performers` DELETE, passes the 0144 guards for
  that line;
- the `(company_id, session_id, write_xid)` and `(company_id, line_id, write_xid)` uniques can
  reject one legitimate write after the restore.

The probability is low — it needs a restore into a new cluster and the counter to reach one
specific old value — but the seal is a money-integrity control, so it must not depend on a
cluster-local counter.

**What the alternatives do.** Pairing `write_xid` with a cluster-stable identifier stamped by the
same trigger fixes all three symptoms at once. Resetting the stored seals in the restore runbook
would need a write to every restored row (the migration owner is the only role that can do it, and
it would have to be proven to touch every row), and a restore-time migration step has the same
problem. A caller-settable GUC nonce was rejected on sight: the app could forge it.

## Decision

The seal becomes the pair **`(write_system_id, write_xid)`**.

### 1. `write_system_id` is the writing cluster's identifier

`public.pospay_system_id()` returns `system_identifier` from `pg_catalog.pg_control_system()`. It
is `LANGUAGE plpgsql`, `STABLE`, `SECURITY INVOKER`, `SET search_path = pg_catalog`; `PUBLIC` has no
`EXECUTE` and only `pospay_app` has it. Migration 0158 refuses to run when
`has_function_privilege('pospay_app', 'pg_catalog.pg_control_system()', 'EXECUTE')` is false, and
refuses to run when the identifier reads back as `NULL` or `0`.

`system_identifier` is the right anchor because it separates exactly the cases that matter:

| Restore kind | `system_identifier` | XID history | Safe? |
|---|---|---|---|
| Logical restore (`initdb` + `pg_restore`) | **new** | restarts low | yes — the restored rows carry the old identifier, which the new cluster never has |
| Physical restore (file copy), replica promotion, PITR | unchanged | unchanged | yes — identifier and XID history both survive, so the seal keeps its meaning |
| `pg_upgrade` | **new** (it always targets a freshly `initdb`'d cluster) | **kept** (the counter is carried over) | yes — a new identifier with the old XID history is exactly the case the pair separates |

### 1a. The identifier read costs a control-file read, so it is retried and read lazily

`pg_control_system()` reads `global/pg_control` through PostgreSQL 16's backend
`get_controlfile()`. In PostgreSQL 16, `pg_control_system()` holds `ControlFileLock` in shared mode
around that read, and writers update the file under the exclusive lock, so a CRC error is not
expected in normal operation. The reader itself has no retry in the backend (the retry in that
file is frontend-only), and a money write must not roll back because of one transient read, so as
defence in depth `public.pospay_system_id()` retries the read **at most three times**, and only for
that error: the message has to start with `calculated
CRC checksum does not match`, and anything else is re-raised unchanged. A localized `lc_messages`
makes the message comparison fail, and that only re-raises — the write fails closed rather than
losing its seal. The function never returns `0` or `NULL`.

The read is cheap in the common case, but on a hot path it must not be the reason a write fails.
Three guards therefore read the identifier **lazily**: they first check whether the transaction has
a header for the line at all (`EXISTS … write_xid = pg_current_xact_id()`, which costs an index
lookup on a small table), and only then read the identifier and run the paired lookup. The three
are `service_lines_performer_transition` (every `service_lines` update),
`line_performers_change_guard`'s INSERT branch (every performer row written at the till) and
`slpc_change_complete`'s remaining branch (every `line_performers` insert). The other seal-reading
functions run only inside a tip or performer change, so they keep the eager read. A header is
never picked by its XID alone: the cheap check is only a pre-filter, and the lookup that follows
compares the pair.

### 2. The seal is stamped by a trigger, never by the caller

`session_tip_revisions_begin` and `slpc_begin` set `NEW.write_system_id` and `NEW.write_xid`
themselves, overwriting anything the caller supplied. If the identifier reads back as `NULL` or `0`
the trigger raises a plain exception (SQLSTATE `P0001`, so the API answers 500, `CLAUDE.md` §5)
instead of falling back: an infrastructure failure must never produce a seal that looks like the
legacy sentinel.

Every guard that compared `write_xid` with `pg_current_xact_id()` now compares the pair. Each
`plpgsql` function reads the identifier **once** into a declared `bigint` and uses that variable in
its predicates; the identifier is never called inside a per-row predicate. The seal-reading
functions stay `STABLE` — the value cannot change inside a transaction, and the same value is
read by every function in it.

### 3. `0` is the legacy sentinel

`ALTER TABLE … ADD COLUMN write_system_id bigint NOT NULL DEFAULT 0` gives every row that existed
before the migration the value `0`. Zero is an identifier no cluster has, so a legacy row can never
be "this transaction's" header — which is the point: a legacy row restored from a dump must not
become current. The default is a constant, so adding the column does not rewrite the table.

`slpc_begin` stamps the identifier on **every** insert, including an insert made outside a tenant
context (the migration owner, or a test). The deferred completeness check
(`slpc_change_complete` → `slpc_validate_change`) runs for those rows too, so a header that never
received an identifier could never commit; the sentinel stays reserved for the rows that predate
the migration. The `DEFAULT 0` is kept on both tables for those rows.

### 4. The uniques swap to the pair

`session_tip_revisions_session_xid_uq` and `slpc_line_xid_uq` become
`(company_id, session_id | line_id, write_system_id, write_xid)`. The **constraint names do not
change** — the tests and the plan assertions name them — and migration 0159 builds the new unique
indexes `CONCURRENTLY` and attaches them with `ADD CONSTRAINT … UNIQUE USING INDEX`, which renames
the index to the constraint name (ADR-0033).

### 5. The seal cannot be forged

`pospay_app` has `SELECT, INSERT` on both tables and **no `UPDATE`**, at table level and at column
level, so it cannot rewrite a stamp after the fact. The trigger overwrites the value on insert. The
identifier itself is only readable through `public.pospay_system_id()`, whose `EXECUTE` grant
belongs to `pospay_app` alone.

### 6. Supported restore procedure

A logical restore of these tables must run **into a freshly `initdb`'d cluster with triggers
disabled**: `pg_restore --disable-triggers` as superuser, or `SET session_replication_role =
replica` for the session. A restore that fires the triggers re-stamps every restored row with the
new cluster's identifier, and the deferred `slpc_change_complete` check plus the four-column
uniques then refuse the rows — that refusal predates this ADR and is the reason the seal is not
restored by replaying it. This is the path the seal protects: the restored rows keep the writing
cluster's identifier (or the `0` sentinel for the rows that predate it), so they can never
authorise a write in the new cluster.

## Consequences

- A restored row can never authorise a write, and a legitimate write after a restore is never
  refused by the old unique.
- The rows written before the migration keep `write_system_id = 0`. They stay readable and
  immutable, and no guard accepts them as current — the same behaviour they had before, except
  that the acceptance now also requires the identifier to match.
- The migration refuses to run when the runtime role cannot read the identifier, rather than
  installing guards that would silently refuse every write.
- **Known residual, out of scope:** loading rows into a cluster that *shares the writer's*
  `system_identifier` but has a different XID history is not covered. That means a PITR to an
  earlier point followed by loading a later logical dump of the same cluster, or importing data
  from a physical fork of it. The restore runbook must therefore load logical dumps only into a
  fresh `initdb` cluster, with triggers disabled, never into a cluster that kept the writer's
  identifier (`docs/runbook.md`, "Restoring a logical dump").
- The residual needs a different anchor (a per-row UUID written by the writer, or a signed
  cluster epoch) if it ever has to be covered.

## References

- Issue #338; the Codex review comment on PR #336.
- ADR-0003 (roles; no runtime role has `BYPASSRLS`), ADR-0033 (recoverable concurrent index
  migrations), ADR-0007 (tenant tables key on `(company_id, id)`).
- Specs 053 (tips) and 055 (performer changes).
