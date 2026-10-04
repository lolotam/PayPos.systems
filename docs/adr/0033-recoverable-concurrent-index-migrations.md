# ADR-0033 — Recoverable concurrent index migrations

- **Status:** Accepted
- **Date:** 2026-10-04
- **Scope:** `packages/db` migration runner

## Context

The runner executes a leading `CREATE/DROP INDEX CONCURRENTLY` prefix outside a transaction,
under its existing session advisory lock. The remaining statements and Drizzle journal row
commit together. A crash after a completed build but before that commit leaves an unjournaled
index; an interrupted build can leave an invalid index. Both previously blocked retries of
unconditional CREATE statements, including migrations 0049, 0068 and 0070.

Merged migrations are immutable. Recovery therefore belongs in the runner, rather than in
edits to historical SQL or `IF NOT EXISTS`, which could silently accept the wrong index.

## Decision

Before each concurrent CREATE, resolve the index name and its namespace from the target
table ([PostgreSQL creates the index in the table's schema](https://www.postgresql.org/docs/16/sql-createindex.html)):

- No existing relation: execute the original statement.
- Existing invalid index: `DROP INDEX CONCURRENTLY` using its quoted, schema-qualified name,
  then execute the original statement. A further interruption is recoverable on the next retry.
- Existing valid index: skip CREATE only when the table identity and definition match.
- A valid index with a different definition, or a same-name non-index relation: abort with
  `Concurrent index <schema-qualified name> already exists with a different definition; migration aborted`.
  Do not change the existing relation or write the migration journal row.

PostgreSQL canonicalizes the expected definition by creating an index on an empty temporary
`LIKE` copy of the target table. The copy retains the table name for Drizzle's qualified
column references, lives only in the migration session, and is dropped at transaction commit.
Schema-qualified column references are rebound to that copy, preserving literals and comments.
This does not build another index over live data or acquire a write-blocking lock on the live
table. Comparison includes uniqueness, NULLS NOT DISTINCT, access method, ordered key and
included columns (expressions, collations, operator classes and sort/null ordering), predicate,
storage options and tablespace. Expressions and predicates are compared as PostgreSQL deparses
them, rather than by deleting whitespace or parentheses from the migration SQL.

All other statements, concurrent DROP behaviour, prefix-order validation, advisory locking,
and the transactional suffix/journal commit semantics remain unchanged. No dependency or
migration is added. This change does not make unrelated non-idempotent concurrent statements
or manually changed schema recoverable.

## Validation

Real PostgreSQL tests use the existing migrated-template/clone harness. They prove normal
first execution, completed build plus rolled-back suffix/missing journal retry without rebuilding,
invalid unique-build recovery, rejection of different valid definitions, and quoted index/table
names in a non-default schema. Parser tests cover UNIQUE, WHERE, escaped quotes, qualified
table names, optional IF NOT EXISTS, and every concurrent CREATE in migration history.

## Amendment — recovery safeguards (2026-10-04)

The target schema and table identity must match before either invalid-index recovery or
valid-index comparison. A same-name index on another table is rejected without dropping it,
regardless of validity.

An invalid index is not necessarily abandoned. Before recovery, inspect
`pg_stat_progress_create_index` and relation locks in the current database. An active build
or a lock held by another session aborts with a clear `retry later` message. Only an invalid
index with no active build or other-session relation lock is dropped. A live-build regression
holds an open writer transaction to pause a concurrent build in its invalid phase, proves
recovery leaves its OID intact and the journal empty, then releases it and retries successfully.

Parse exactly one concurrent CREATE before executing anything or creating a definition probe.
Leading comments and a trailing semicolon are permitted; extra statements and unterminated
literals are rejected. Semicolons in quoted names, strings, dollar-quoted strings, and comments
are not statement boundaries. Dollar-quote closing tags match case-sensitively.

This amendment supersedes the original inclusion of tablespace in the comparison above.
The project does not set custom tablespaces. Tablespace is excluded from the catalog signature,
and the TABLESPACE clause is omitted from the definition probe. No tablespace resolution is
performed. The original statement still determines storage placement on a first execution.
All other index-definition attributes, transaction handling and journal semantics are unchanged.

## Amendment — atomic invalid-index recovery (2026-10-04)

This supersedes the progress/lock detection and concurrent DROP approach above. A catalog
read and a separate activity check can race with a concurrent build completing: a stale
INVALID result must never authorize dropping an index that has since become VALID.

For an initially invalid index, begin a transaction and set `SET LOCAL lock_timeout = '5s'`.
Acquire `ACCESS EXCLUSIVE` on the quoted, schema-qualified target table. This conflicts with
the `SHARE UPDATE EXCLUSIVE` lock held by a concurrent index build, so recovery waits for
completion. Under the acquired lock, re-read the target table identity and index validity,
and reject any table-identity mismatch before dropping anything.

Only an index that is still INVALID under that lock is dropped with plain `DROP INDEX`
inside the same transaction. Commit before executing the original concurrent CREATE. If it
became VALID, preserve it and use the existing definition comparison to skip or reject it.
A lock timeout or deadlock rolls back recovery and reports `retry later` without changing the index or
journal. This recovery transaction can briefly block table access; valid-index comparison
and first-time builds retain their existing behaviour. The migration suffix and journal
still commit together in their original transaction.

Real PostgreSQL regressions pause a builder with an open writer, read the actual INVALID
catalog row, then use a test-only client barrier to finish the build before the runner acts
on that row. Matching and differing completed definitions both retain the original valid OID;
only the matching definition journals. A separate timeout case leaves the live build intact.
Waiting for the table lock can deadlock with a builder waiting for the recovery transaction's
virtual transaction; that lock failure is also surfaced as retryable rather than dropping
from the stale read.

Line comments terminate at either LF or CR, matching PostgreSQL lexical rules. A regression
uses an actual carriage return after `--` to expose and reject a hidden second statement
before execution or probing.
