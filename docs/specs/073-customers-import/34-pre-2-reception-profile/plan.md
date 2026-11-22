# 34-pre-2 · Implementation plan

[Delivery specification](spec.md) · [Canonical 073](../spec.md) · [Owner decisions](../owner-questions.ar.md) · [Expand release and compatibility design](../34-pre-1-plan.md).

## Summary and technical context

One implementation PR for all three items. Source reviewed at origin/main 68e2f4dafacc72aef364ef4a3d7bbd96bfe42f51. This design worktree starts at 8c46615f0c893178efbc9b4b963e9d6aff18d8a0. Start implementation on refreshed main and recheck the callers. PR #766 (34-pre-1) landed as 4a9898818. PR #1161 (32b-1 + 34-pre-3) landed as 09574e9e7. The ordered prerequisites exist in Git. A merge SHA does not identify a running API image.

**Item 1 — actual entry points.** Admin orders' record-service-session-form.tsx uses branch entry. package-sale-form.tsx passes the entry scope provided by its context (company/business/branch). Both use SessionCustomerField and useSessionCustomer. The POS ReceptionBody is not a caller. Keep SessionCustomerSelection as Pick<Customer, 'id' | 'name' | 'phone'> and preserve parent reset, disabled/offline and recovery behavior. Extract localized accessible controls into a child of the shared field. Keep explicit calling code and locale. Bind the proper resolver per scope. The hook currently parses only findOrCreateCustomerInput, so adding a note to the form alone would fail on its strict company parser. Construct typed company and scoped bodies separately with findOrCreateScopedCustomerInput for scoped entry, strip empty optional controls and omit unknown year. Never silently discard a supplied note or retry on a broader route. Validate using established contract/domain semantics, including calendar dates and code-point lengths. Keep field errors free of submitted data.

**Item 2 — selected card.** The POST returns Customer with masked phone, no profile. Use the existing matching GET with company header and customer ID, parse customerProfile, render CustomerProfile inside the selected card. A restored selection must also load by ID. Routes under /v1 are /customers/{customerId}/profile, /businesses/{businessId}/customers/{customerId}/profile and /branches/{branchId}/customers/{customerId}/profile. Select the same scope used for entry. Read notes across businesses only as returned by the authorized endpoint. Key ephemeral reads by user, tenant, scope, route IDs and selected customer. Clear/ignore stale responses on switch/unmount, disable previous-data placeholders, automatic retry and persisted caching, and discard unused data. Show loading, empty fields/list and retry; avoid rerunning the mutation on retry. Leave saved selection and allowed packages link available if reading fails.

**Item 3 — conditional write.** Company POST /v1/customers/find-or-create accepts FindOrCreateCustomerInput. The business and branch POSTs under /v1/businesses/{businessId} and /v1/branches/{branchId} use /customers/find-or-create and FindOrCreateScopedCustomerInput. Both strict schemas must continue accepting omitted gender for lookup. Document this conditional in published operation descriptions. Invalid supplied enum stays rejected at the input pipe. Normalize phone, retain existing supplied-field validation and scoped transaction. Inside FindOrCreateCustomerUseCase return a found customer before requiring gender. On a miss, domain validation must produce valid gender or InvalidCustomerProfileError (already mapped to VALIDATION_FAILED). Pass required gender through NewCustomer to the insert. Guard before ID, timestamp, branch-note resolution, insert and audit. Keep ON CONFLICT (company_id, phone) DO NOTHING plus reread and winner-only effects. No client-supplied existing flag or inferred value. Preserve the safe five-field Customer return and audit projection. UI may submit an otherwise valid request with no gender to find a legacy customer; clearly label gender as required for a new customer and on validation failure with empty gender guide the next attempt, without asserting that every validation error proves the phone is new.

## Constitution and compatibility gates

Reuse existing contracts, module boundaries, scoped permissions and customers feature. SQL stays in the customer adapter. Retain one transaction, the existing note-business resolution and the existing profile reader. No new dependencies, migration, permissions, background jobs, events, money handling or deployment changes. Direct SQL seed fixtures may intentionally represent old NULL data. Customer import will need its own worker/creation path enforcement and fill-empty tests when delivered; this PR neither implements nor certifies that future path.

| Admin / API combination | Required proof and release consequence |
| --- | --- |
| Expand / expand | Baseline accepts missing gender on a new write. Check paired image versions through the release owner. |
| New / expand | A genderless find on an unknown phone can still create a NULL row. Do not expose the new flow to an old API replica or roll the API back alone. A successful GET profile does not distinguish the releases. |
| Expand / new | Existing finds work. Old or cached forms cannot create new customers because they cannot supply gender. A green CI run or a new asset on the server does not refresh an open browser tab. |
| New / new | Rehearse all three scopes, legacy NULL, required-on-new, and typed scoped note. For separately authorized deployment, coordinate API cutover, admin asset switch, reload/drain old sessions and verify versions before opening writes. Rollback needs the same coordination; the old pair permits NULL again. |

S-2 excludes a rollout flag. Record mixed-version behavior on private test fixtures and verify the release owner's pairing and handling of stale tabs before activation. If uninterrupted mixed-version creation is required, stop for a release decision on a separately scoped compatibility design. No target DB or deployment evidence is assumed.

**PR #1162 (42-4 + 46-2a-S).** Compared the open diff at b631fafae9cbbb7abe43a75ec1681f4449697b1f. It edits session-customer-field.tsx, adds optional packagesScope and CustomerPackagesLink to its selected card, adapts visit/package callers, keeps the same three-field selection, and changes generated OpenAPI/admin/POS/menu clients for its own features. Its package detail card is a different screen. Do not overwrite link visibility, scope forwarding, resumed selection or package proof tests. Our direct source intersection is the shared field and potentially generated artifacts; parents are behavioral intersection even if our implementation never edits them. Rebase the later PR, regenerate from combined source and run both normal-entry suites plus link visibility. Parallel design/testing can proceed; the manager coordinates merge order. No business dependency on imported refunds or its migration.

## Project structure and estimate

Estimated diff LOC = additions + deletions, including modified fixtures. Each row allocates a single file, item and class. Shared-file allocations represent different hunks. New files are proposals. D includes these two planning docs once if carried in the final PR. Other paths are repo-relative. G is a regeneration allowance: accept zero changes where outputs are identical.

| Item | Class | File | LOC |
| --- | --- | --- | --- |
| 1 | P | apps/admin/src/orders/ui/session-customer-field.tsx | 35–60 |
| 1 | P | apps/admin/src/orders/ui/customer-profile-inputs.tsx (new) | 95–145 |
| 1 | P | apps/admin/src/orders/api/use-session-customer.ts | 28–48 |
| 1 | P | packages/i18n/src/service-session-catalog.ts | 24–40 |
| 1 | T | apps/admin/src/orders/ui/session-customer-field.spec.tsx | 45–80 |
| 1 | T | apps/admin/src/orders/api/use-session-customer.spec.tsx | 35–55 |
| 1 | T | apps/admin/e2e/session-ui.ts | 5–12 |
| 1 | T | apps/admin/src/orders/ui/package-sale-form.spec.tsx | 12–25 |
| 1 | T | apps/admin/src/orders/ui/record-service-session-form-customer.spec.tsx | 12–25 |
| 1 | D | docs/journey/47-record-visit-reception.md | 8–15 |
| 1 | D | 34-pre-2-reception-profile/spec.md (this folder) | 30–45 |
| 2 | P | apps/admin/src/orders/ui/session-customer-field.tsx | 12–25 |
| 2 | P | apps/admin/src/orders/ui/session-customer-profile-card.tsx (new) | 65–105 |
| 2 | P | apps/admin/src/orders/api/use-session-customer-profile.ts (new) | 50–85 |
| 2 | P | packages/i18n/src/service-session-catalog.ts | 12–26 |
| 2 | T | apps/admin/src/orders/ui/session-customer-profile-card.spec.tsx (new) | 65–115 |
| 2 | T | apps/admin/src/orders/api/use-session-customer-profile.spec.tsx (new) | 45–85 |
| 2 | T | apps/admin/e2e/session-fixture.ts | 10–25 |
| 2 | D | docs/journey/81-customer-profile-notes.md | 18–35 |
| 3 | P | packages/contracts/src/customers.ts | 4–10 |
| 3 | P | packages/contracts/src/customers-openapi.ts | 4–10 |
| 3 | P | apps/api/src/modules/customers/domain/profile.ts | 7–15 |
| 3 | P | apps/api/src/modules/customers/use-cases/find-or-create-customer/find-or-create-customer.usecase.ts | 6–15 |
| 3 | P | apps/api/src/modules/customers/ports/customer-transactions.port.ts | 2–6 |
| 3 | P | apps/api/src/modules/customers/persistence/drizzle-customer-transactions.ts | 1–4 |
| 3 | T | packages/contracts/src/__tests__/customers.spec.ts | 8–20 |
| 3 | T | apps/api/src/modules/customers/domain/__tests__/profile.spec.ts | 8–18 |
| 3 | T | apps/api/src/modules/customers/use-cases/find-or-create-customer/find-or-create-customer.usecase.spec.ts | 30–55 |
| 3 | T | apps/api/src/modules/customers/__tests__/customer-profile.spec.ts | 30–65 |
| 3 | T | apps/api/src/modules/customers/__tests__/customers.spec.ts | 8–20 |
| 3 | T | apps/api/src/modules/customers/__tests__/customer-persistence.spec.ts | 0–12 |
| 3 | T | apps/api/src/modules/identity/__tests__/role-followups.spec.ts | 2–6 |
| 3 | T | apps/api/src/modules/orders/__tests__/package-sale-context-access.spec.ts | 2–6 |
| 3 | G | packages/contracts/openapi/openapi.json | 3–12 |
| 3 | G | apps/admin/src/shared/api/schema.d.ts | 0–10 |
| 3 | G | apps/pos/src/shared/api/schema.d.ts | 0–10 |
| 3 | G | apps/menu/src/shared/api/schema.d.ts | 0–10 |
| 3 | D | docs/journey/10-customer-find-or-create.md | 6–15 |
| 3 | D | docs/specs/073-customers-import/spec.md | 4–12 |
| 3 | D | 34-pre-2-reception-profile/plan.md (this folder) | 85–145 |

| Item | Production | Test | Generated | Docs |
| --- | --- | --- | --- | --- |
| 1 | 182–293 | 109–197 | 0–0 | 38–60 |
| 2 | 139–241 | 120–225 | 0–0 | 18–35 |
| 3 | 24–60 | 88–202 | 3–42 | 95–172 |
| Total | 345–594 | 317–624 | 3–42 | 151–267 |

Preliminary production 500–850 counted a larger possible UI/API surface. Bottom-up 345–594 overlaps at 500–594. Existing profile endpoints, tenant-scoped note storage, normalization and one shared entry component remove the need for duplicate forms, new routes or schema work. The main uncertainty is the form's typed scope handling and stale-selection behavior. Reforecast if more normal-entry callers or incompatible deployed writers emerge.

## Execution and verification

1. Inventory all direct HTTP callers, tests and active release versions again at implementation head. Start from failing cases for actual new creation without gender and legacy success. Replace the expand-only HTTP test that expected a fresh NULL row; retain database compatibility coverage and explicitly seed an existing NULL row. Update only success fixtures that genuinely create customers (including identity and package-sale access tests). Verify invalid supplied inputs still fail and masked errors/audit contain no profile values.
2. Implement the three items in the same PR. Exercise branch and business note preservation, company-note rejection, invalid optional inputs, unknown-year birthday, existing non-overwrite and concurrent duplicate submissions against an isolated test DB. Test the visible card in Arabic and English, scoped GET/POST paths, two named notes, denial/missing behavior, switching actors/branches while reads are pending, retry without creating twice, recovering a visit, and package-sale scope selection. Use synthetic data. Check both actual flows in browser tests, including keyboard labels, RTL and narrow layout.
3. Regenerate with pnpm contracts:openapi and each admin/pos/menu package's api:generate. Inspect generated diff. Run focused contracts, customers HTTP/use-case, identity/orders integration and admin hook/component suites, then scoped browser suites, pnpm check, docs and whitespace checks. Record exact commands, head, counts and failures. No target DB. A separate release rehearsal is not a local-green result.
4. **Approved implementation tier: Medium.** Waleed approved this delivery and the navigation bundle on 2026-11-22: «اعتمد Medium للحزمتين (المقترح). كل حزمة في PR مستقل بعد توفر خاناتها.» Conditional API behavior and personal-data presentation exceed Light. Existing access rules, data model and masking remain intact. A change requiring permission or security architecture or a migration returns to the manager for reclassification. Use OpenCode **opencode/hy4-flash-free**, catalog default **high**. The implementer runs clean-code-guard and test-guard and addresses findings before a different model performs the independent review. Apply PP-195, PP-198, PP-202 and PP-208, including Medium MergePilot, fresh exact-head ci-gate, consolidated corrections and the three-round cap. CodeRabbit is optional. Resolve any P0/P1 before merge. The manager coordinates final merge and release authority.
5. **Measurement receipt.** Capture requested and executed provider/model/variant for every attempt, base/head SHA, start/stop times and outcome. Measure active implementation minutes to first local green, then active correction minutes per round. Log queue/provider outage, CI, reviewer, owner and coordination waits separately with timestamps; avoid double counting parallel intervals. Record actual numstat additions/deletions per file, class and item against the table, splitting shared hunks once. Record check commands/results, reviewer/round and deduplicated findings by root cause, severity, disposition and fixing head. Count attempts, timeouts, model/provider failures and any authorized switch. Record reported input/output tokens and cost/currency; label unavailable telemetry unknown. Compare observed effort and LOC to estimate only after verification.

**Handoff.** No open product or migration decision. Manager confirms tier and assigns implementation when eligible. Deployment pairing is a release gate. This design contains no deployment authorization or measured implementation results.
