Review based on the pasted documents; live documentation verification was unavailable.

1. **SEQUENCING**

The order has structural defects.

- **T9 is too late.** T8 cannot deliver authenticated company creation, server-resolved tenant selection, or mandatory guards before identity exists. T5 proves database behavior, **not SPEC §1’s session-through-API success criterion**. Move a minimal authentication/RLS integration spike before T5; complete the API isolation proof after T8.
- **T6 contracts are too late.** T5 fixes the schema before tenancy contracts, contradicting CLAUDE §1. Move tenancy contract definition before T5.
- **T7’s Clock/IdGenerator ports are late.** T4’s seed and T5 fixtures already need an agreed ID strategy. Establish their ownership earlier, including worker compatibility.
- **T12 needs an initial gate at T1.** Otherwise “each rule is a CI gate” is false for early PRs. Incrementally expanding CI is correct.
- **T11’s basic redaction belongs with T6.** Adding it after real requests creates an avoidable logging exposure. Full tracing can wait.
- **T13’s graph is wrong:** depending only on T12 permits staging completion without T9–T11. Add explicit release dependencies and the missing worker bootstrap.

SPEC §5 mandates serial slices; the plan permits parallel tasks. Resolve that contradiction before agents interpret it differently.

2. **MISSING WORK**

Before Phase 1 starts, the foundation needs:

- **T9: a documented principal-resolution contract**, for example `packages/auth/src/principal.ts`: session/device/PIN → user or employee → verified company membership → business/branch scope. `employee_ref` has no defined target, lifecycle, or tenant-safe link to the future employee record.
- **T9: onboarding and membership lifecycle specifications.** Who creates the first owner membership? How is company switching authorized? What happens after membership removal or device revocation? An `@Require` decorator alone answers none of this.
- **T7: a worker transaction/context entry point**, plus `apps/worker/src/main.ts` and health/readiness behavior. If Phase 1 commissions consume events, it also needs outbox dispatch, retries and consumer deduplication; a writer alone delivers no events.
- **T10/SPEC §4: a canonical branch-timezone source.** The schema puts timezone on Business while requirements repeatedly use branch timezone. Attendance cannot reliably assign working dates until this is resolved.
- **T3: signed rounding, decimal transport and persistence conversion contracts** for commissions.

Rotating-QR issuance, replay rules and commission effective-date rules belong in Phase 1 specifications. Their absence is not a reason to implement those features in Phase 0.

3. **RLS**

**T5’s four assertions are insufficient.**

- **Pooling:** transaction-local `set_config(..., true)` is correct and acceptable without PgBouncer. But tests must reuse connections across A → B → no tenant, including exceptions, rollback and concurrent transactions. Test for session-level settings surviving underneath transaction-local overrides.
- **Roles:** run tests using the actual restricted application role. Assert `NOSUPERUSER`, `NOBYPASSRLS`, no ownership, and no ability to assume privileged roles. `FORCE ROW LEVEL SECURITY` subjects the owner to policies during ordinary access; owners can still alter protection. Superusers and `BYPASSRLS` bypass it.
- **SECURITY DEFINER:** inventory callable functions and their owners. A privileged function can bypass otherwise-correct table policies. Restrict execution privileges and fix its `search_path`.
- **Mutation coverage:** add DELETE, same-tenant UPDATE attempting to change `company_id`, and relevant UPSERT cases. Cross-tenant UPDATE affecting zero rows is correct PostgreSQL behavior; claiming all cross-tenant writes must error is inaccurate. With this simple policy, omitted `WITH CHECK` can inherit `USING`; omission alone is not the defect.
- **Relational integrity:** A’s branch can reference B’s business through an ordinary UUID FK. RLS does not enforce tenant-consistent relationships. Use composite tenant-qualified foreign keys. Referential checks can also expose existence through constraint errors.
- **`plans`:** no RLS is acceptable for shared reference data, but runtime roles need read-only privileges. Otherwise every tenant may modify global entitlements.
- **Trusted tenant selection:** `withTenant(B, …)` legitimately accesses B. RLS cannot distinguish an authorized company ID from an attacker-controlled one. Add API tests proving A cannot select B.

Apply this suite to **T7, T9 and T10**, not just tenancy tables.

4. **BETTER AUTH + RLS**

**T9’s mitigation is invalid. Scheduling does not solve a bootstrap dependency.**

Login, session lookup, verification and password recovery occur before a company is trusted. With mandatory tenant policies, those queries either error because context is absent or see no matching rows. Global users may belong to several companies; attaching one required `company_id` to every authentication row misrepresents that relationship.

Additionally, wrapping an HTTP request in `withTenant()` does not automatically bind Better Auth’s adapter queries to that transaction. Queries using another connection lack its tenant setting.

Before T5, decide and prove:

- Global authentication tables versus tenant-owned organization/membership tables.
- A private, narrowly privileged authentication database access path.
- How verified membership establishes context for business-data transactions.
- Whether Better Auth organizations or application memberships own authorization, avoiding two conflicting authorities.

This requires an explicit amendment to CLAUDE §5’s “all access through `withTenant()`” rule. Do not give the ordinary auth connection unrestricted `BYPASSRLS`.

Test real login/session flows, two-company membership and revocation. Auth-handler routes also need explicit public/protected classification; Nest controller guard scanning cannot cover them automatically.

5. **OVER-ENGINEERING**

- **T4:** defer the unused future platform bypass role. It adds privilege without current value.
- **T9:** justify each plugin with a Phase 0 flow. Phone-number authentication depends on delivery explicitly excluded by SPEC §2. Defer unused phone/API-key capabilities; clarify whether organization functionality duplicates tenancy.
- **T11:** defer “100% of errors/slow traces.” Ordinary head sampling cannot guarantee that retrospectively; implementing suitable tail sampling is disproportionate now.
- **T13:** remove Chromium and Arabic fonts from an empty worker; document rendering is excluded.
- **T12/CLAUDE §9:** defer blanket execution-plan assertions on tiny fixtures; they are unstable evidence of future performance. Keep query correctness and index checks.
- **T10:** product naming should not block foundation formatters when invoice templates are out of scope.

Boundaries, money tests, isolation tests and a real restore are justified for a solo developer using agents.

6. **UNDER-ENGINEERING**

- **T7 idempotency is internally impossible:** a response hash cannot reconstruct a response. Specify stored status/body, company + operation + key uniqueness, request-mismatch rejection, concurrent duplicate handling, crash recovery and retention. Claim and business effect must commit atomically.
- **T5/SPEC §4:** define the tenant-root rule for `companies`. Adding both `id` and `company_id` without enforcing their relationship creates ambiguity. Add tenant-qualified relationships for branches, devices and scoped memberships.
- **T3:** define negative half-up behavior, percentage precision, overflow boundaries for `numeric(14,3)`, and lossless bigint JSON/database conversion.
- **T7/T9:** audit data can itself leak hashes, tokens and private fields through `before`/`after`. Specify field allowlists and privileges preventing runtime audit modification/deletion.
- **T13:** `pg_dump` plus archived WAL does **not** establish point-in-time recovery. WAL replay requires a suitable physical base backup. Choose explicit recovery objectives and test that recovery method. Restic supplies encrypted storage, not PostgreSQL recovery semantics.
- **T13:** a SHA image rollback does not reverse incompatible schema changes. Test old-image compatibility after migration.

7. **EFFORT**

**Four weeks is an optimistic coding budget, not a credible completion forecast.** T7’s one day and T9’s two–three days ignore concurrency, authentication bootstrap and authorization edge cases.

For the stated acceptance level, estimate **six–eight focused weeks**, excluding unresolved product decisions and provisioning delays.

**T9 is the likeliest overrun: seven–twelve working days instead of two–three**, roughly five–nine extra days. Discovering its schema/access-model conflict after T8 adds rework. AI accelerates implementation more reliably than security verification.

8. **TOP 5 CHANGES**

1. **T4/T9: resolve authentication bootstrap before schema commitment.** Prevents unusable login and privileged shortcuts around isolation.
2. **T5: specify production roles, tenant-qualified constraints and the expanded database/API test matrix.** Prevents cross-tenant access and inconsistent references.
3. **T7: replace hash-only idempotency with an atomic replay protocol.** Prevents duplicate financial effects and broken retry responses.
4. **T9/T10: define principal, scope, employee-link and timezone contracts.** Prevents Phase 1 attendance and commissions inheriting ambiguous ownership.
5. **T13: specify and rehearse valid recovery and schema-compatible rollback.** Prevents discovering during an incident that backups or rollback cannot recover service.

NEEDS REVISION - The authentication bootstrap, isolation proof and idempotency protocol are unresolved foundations that would force risky rework across later phases.