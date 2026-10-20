# ADR-0048 — Name substring search is not indexed under RLS

- **Status:** Accepted
- **Date:** 2026-10-20
- **Decided by:** issue #373 (found by Codex on PR #371). The manager chose this option on 2026-10-20; the evidence is below.

## Context

Two staff reads search employee names with a substring match:

- the staff list's search box `q` (8c-4b, `apps/api/src/modules/staff/queries/list-employees.query.ts`);
- the reception performer picker (`apps/api/src/modules/staff/queries/session-performer-options.query.ts`).

Both use `icuNameMatch` (`apps/api/src/modules/staff/queries/employee-name-search.ts`):
`lower(name_ar COLLATE "und-x-icu") LIKE '%' || lower(q COLLATE "und-x-icu") || '%'`, and the same for `name_en`
(ADR-0041 fixed the folding and escaping). A B-tree index cannot serve a leading wildcard, so #373 proposed a trigram
index (`pg_trgm`, GIN `gin_trgm_ops` on the two lowered names).

`employees` has FORCE ROW LEVEL SECURITY. `pospay_app` reads it through the policy
`employees_select ... USING (company_id = app_company_id())` (migration 0039), inside `withTenant()` (`CLAUDE.md` §5).

PostgreSQL gives the policy's qual a lower security level than the quals the query itself writes, and evaluates
it first. A qual at a higher level can become an index condition only when every function in it is `LEAKPROOF`, so
it cannot run on a row the policy would hide (`restriction_is_securely_promotable` in the planner). `LIKE` is `~~`,
implemented by `pg_catalog.textlike`, which is not leakproof (`proleakproof = f`; `lower` is not leakproof either;
`texteq` is). A qual inside the policy itself is not held back this way.

A scratch database on PostgreSQL 16.15 (the dev compose image) confirmed this. It had a table shaped like
`employees`, both trigram indexes and FORCE RLS:

- As a superuser, the search above ran as a `BitmapOr` over the two trigram indexes.
- As a role subject to RLS, the same query ran as a sequential scan. With the `company_id`/`business_id` filter the
  production queries carry, the scan ran on the `(company_id, business_id, id)` B-tree, and `LIKE` stayed a filter.
- With 200 tenants of 100 employees each and one tenant of 20,000, the small tenant took 0.6 ms (100 rows filtered)
  and the large one 119 ms (20,000 rows filtered). The trigram index was not used for either.

## Decision

1. **No trigram index, and no `pg_trgm` extension, for these searches.** It would cost write time and disk and would
   never be chosen for `pospay_app`.
2. **The tenant B-tree bounds the scan.** Both queries filter on `company_id` and `business_id` with leakproof
   equality, so the planner can read only that business's employees through an index led by those two columns
   (`employees_company_business_id_idx`, or the `name_*_key` indexes of migration 0098), then filter by name. Each
   query has an `EXPLAIN ANALYZE` test, run without `enable_seqscan=off` and with other tenants' rows present. The
   test checks that `employees` is read through an index condition on both `company_id` and `business_id`, that it
   has no sequential scan on `employees`, and that it reads no more rows than the business holds.
   A change that drops the tenant filter, or reorders it out of the index, fails the test.
   The planner's choice is cost-based, so this holds when the business is a small share of `employees`, which is the
   multi-tenant case. When one business holds most of the table, a sequential scan is legitimate: it reads about the
   same number of rows the index would, and RLS still hides every other tenant's row. The 20,000-employee probe above
   (half the table) still used the tenant index.
3. **`ALTER FUNCTION pg_catalog.textlike LEAKPROOF` is rejected.** It needs a superuser. It edits `pg_catalog` in our
   database, which `pg_dump` does not carry, so a restored backup would quietly lose the index's use. Upstream
   deliberately leaves `textlike` without `LEAKPROOF`. The shared server's migration role may not be a superuser.
4. **This is a project-wide constraint.** On a table behind a tenant policy, a predicate the query writes that uses
   a non-leakproof function (`LIKE`, `ILIKE`, `~`, `lower()`, most functions) never drives an index, whatever the
   index type. Only leakproof comparisons (`=`, `<`, `>` on the built-in types) on the tenant key, or on columns
   indexed with it, narrow the rows read. A new search must be bounded by such a filter.
5. **If substring search is ever needed at scale**, it needs its own design and slice, not an index on these
   queries. One example is a tenant-keyed side table of name trigrams, matched with equality and then rechecked with
   `LIKE`. Another is a different search contract (prefix only, or an external search service).

## Consequences

- A search reads every employee of the business, not only the matches. Staff lists are small (#373 deferred the
  issue for that reason); even the 20,000-employee case above took about 120 ms.
- No new extension, migration or grant. RLS is unchanged.
- #373 closes as "won't index under RLS". The catalog service picker
  (`apps/api/src/modules/catalog/queries/session-service-options.query.ts`) runs the same `LIKE` on `services` and is
  bounded the same way; its plan test is follow-up issue #410.
