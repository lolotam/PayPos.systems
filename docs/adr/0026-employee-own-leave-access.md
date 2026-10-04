# ADR-0026 — Employee ownership within scoped leave access

Date: 2026-10-04. Status: Accepted technical implementation of PR 17.

## Context

PRD P1-T7.4 names create:leave:own. Memberships still have COMPANY/BUSINESS/BRANCH scopes;
an Employee is not an authorization membership. ADR-0019 staff sessions identify a global
user in a proven paired-device context, without granting employee access automatically.

## Decision

Add `own` to permission scope recognition, without introducing an OWN membership scope.
The pure access target carries actorUserId and subjectUserId; an own permission is refused
unless both exist and are equal. Normal scoped ALLOW/DENY evaluation then applies at the
verified company/business/branch. Broad grants never bypass ownership. For non-owners,
covering DENY always takes precedence over ALLOW.
The recorded owner decision of 2026-10-03 (the owner keeps everything; nobody can reduce
an owner; never add owner DENYs) also applies to own leave codes. Owner immunity takes
precedence over covering DENY, including historical own-leave DENYs, while ownership,
employee scope/eligibility and feature checks still apply. This exception never weakens
DENY for a non-owner.
Do not allow generic @Require to infer ownership from route/body parameters. Own routes
use one @Authenticated declaration plus the existing STAFF_ROUTE policy, and staff's
live identity read port explicitly evaluates ownership and feature availability.

Staff resolves the active employee from the session user and business under its transaction;
dated branch attachments and employment dates prove eligibility. Identity locks company
then ordered memberships, staff then locks employee and request. Idempotent replay happens
after current authorization, and its fingerprint includes user identity to prevent a shared
company key from replaying another user's private response. Cancellation checks actual
requested_by for the own route. Manager routes evaluate branch permissions on stored context.
Own history remains employee-bound within the session business, and the requester can cancel
their pending request after a branch transfer: own authority and current eligibility use the
paired branch, while the saved request retains its original branch/timezone/interval.
Before eligibility or period diagnostics, writes verify an employee attachment to their
authorized branch and own identity; reads apply the same visibility rule before diagnostics.
Each write/read samples the injected Clock once and passes that instant through permission
expiry, employee eligibility and local-period validation, including idempotent authority checks.
Writes sample after lock waits to preserve the existing live authority check before replay.

Add six leave catalog codes and exhaustive default bundles in their own custom migration;
all Device cells are forbidden using ADR-0025's eligibility projection, including historical
ALLOW suppression. Human own grants do not grant staff login, create employees or bypass
eligibility. Manager bundles authorize on-behalf request/read/cancel only in scope. These
business defaults are settled by LR-Q5, owner decision 2026-10-04 (recommended option).

Extend existing staff→identity and staff→tenancy read ports only; no new import arrow,
auth facade, personal-phone authentication, external service or dependency. Leave events
are outbox facts reserved for subsequent attendance/approval consumers; Phase 1 polls.

## Consequences

Existing membership/override schema and all non-own authorization remain unchanged.
Future own resources must provide a verified ownership target; an own code alone is never
authority. PR 20 can reuse the own leave use cases/routes after its session policy is delivered.
Half-open UTC intervals plus captured branch timezone support approved-leave-at-instant
queries without reinterpreting dates. No leave balance or approval behavior ships here.
