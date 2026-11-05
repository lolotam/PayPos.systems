# 42-4a personal manager plan review

Reviewed 2026-11-04 at 23:43 Kuwait, against base `f7b6f9ef`.

## Disposition

The bounded residual design is approved with the corrections below. Apply them to
`42-4a-plan.md` and finish the disclosed governing-document reading before any
application edit. These are corrections within this one personal review, not a
request for another delegate or a second owner approval round. Implementation
remains in the existing Codex `gpt-6.1-sol` medium session; merge remains with the
manager.

## Evidence personally inspected

- The complete residual plan, `AuthorizeRequest`, `AccessReader`, the current
  persistence adapter and `readAccessTransaction`.
- `AccessGuard` and `FeatureGuard` (both in `identity/http/access.guard.ts`), the
  shared `RequestAuthorizer` contract and the existing transaction-level
  `readFeatureEnabled` helper.
- The call sites of the proposed obsolete port methods.
- Live issue #506: OPEN; explicitly requires target and grants to share
  `withTenant(companyId, ..., { userId })` after `companiesOf` under `withUser`.

The supplied Opus and Astra task identifiers are recorded in the session's
handoff. Their reported completion does not turn the planner's incomplete
governing-document reading into a passed gate. This manager review is of the plan
and current code; it is not a claim of executed tests or implementation review.

## Required plan corrections

1. Replace D-2 and every corresponding table/text entry, including transaction T2:
   share the requested feature read in the adapter-owned access transaction.
   For a valid permission-based feature route, expect one `withUser` and one
   `withTenant`, with no overlap or nesting. The feature table row, residual scope,
   port result/input description, guard section and size estimate must agree.
2. Keep `companiesOf` under `withUser` first. Include `executeBranches`; retain
   the existing invalid/empty batch semantics, evaluator, active-company check,
   canonical-owner protection and descendant DENY behavior. Do not create a
   follow-up issue or reopen D-1 through D-4 as owner questions.
3. Feature sharing must be request-local and server-created, bound to the verified
   company and exact feature flag. A missing or mismatched result must use the
   existing `FeatureGuard` fallback. Do not accept a header/body-derived result,
   reuse it across requests or introduce a process-wide authorization cache.
   Keep refusal precedence: an unauthorized request receives `FORBIDDEN` even
   when the feature is disabled; an authorized disabled-feature request receives
   `FEATURE_DISABLED`. Keep non-permission routes and null-dependency refusal
   behavior covered. Add meaningful matching/mismatch/fallback and cross-request
   regression coverage, alongside the proposed real branch any-of tests.
4. The public `shared/request-authorizer.ts` interface remains unchanged. Internal
   optional feature metadata may be carried by the concrete authorizer and guard.
   Remove old reader methods only after the caller audit. Preserve the exported
   `readAccessTransaction` helper's behavior and callers; when `accessIn` is
   removed, change its dependent return-type reference to the named access result
   type rather than leaving `ReturnType<AccessReader['accessIn']>` dangling.
5. Correct the size section: the original brief was 500–1000 changed lines, so
   the delivery stop/split boundary is over 2000. The planner's 1600 estimate is
   a warning for scope review, not a new authorized cap. Count the added guard
   and feature-sharing tests in the estimate. No extra application scope follows
   from this clarification.

## Delivery conditions

No migration, deploy, sale/service-line edit, OpenAPI change or new task session.
Preserve the already-implemented `RequireAny` decorator and route-coverage code
unless a real defect is demonstrated. Keep the existing focused and CI gates,
independent implementation review, exact-head external receipts and correction
budget. Report any new business or architectural uncertainty before dependent
work; do not silently turn it into a policy change.
