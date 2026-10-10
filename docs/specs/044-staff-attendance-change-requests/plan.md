# Implementation Plan: Attendance change requests (request → owner approval)

**Branch**: `feat/p1-26a-attendance-change-requests` | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `docs/specs/044-staff-attendance-change-requests/spec.md` (owner answers
ACR-Q1 … ACR-Q22, Waleed 2026-10-10, the ⭐ option on all; the same day ACR-Q4 and ACR-Q21 were changed to option 2,
partner Abu Salem's pick — see "Change 2026-10-10" below).

## Summary

A new staff-owned tenant table `attendance_change_requests` holds requests to add a manual attendance day (kind
`ADD_SESSION`, applied by row 26b) or to void one (kind `VOID_SESSION`, row 26c). Three write use cases — file,
withdraw, decide (approve/reject) — and one read query (owner inbox / branch list) ship behind a new permission
`request:attendance-change:branch`; approve/reject needs `decide:attendance-change:company` (owner by default,
grantable by an owner only; ACR-Q4 option 2). The kind-specific rules and effects are reached through a kinds port that this
slice ships **empty**: in production every kind answers `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` until 26b/26c register
theirs. Owners get an in-app bell notice when a request waits; the requester gets one when it is decided. Every step
is audited in its own transaction.

## Technical Context

**Language/Version**: TypeScript 6 on Node 24 (ADR-0002; this machine runs 22.14 locally)

**Primary Dependencies**: NestJS (Fastify), Drizzle ORM + drizzle-kit, Zod, Vitest; no new dependency

**Storage**: PostgreSQL — new tenant table `attendance_change_requests` (FORCE RLS, tenant FKs, column-scoped UPDATE);
one permission row; no change to `attendance_sessions`

**Testing**: Vitest unit (domain); integration on the T2 compose Postgres, one cloned database per spec file
(ADR-0006); RLS negative; query shape + `EXPLAIN`; worker notifications consumer test

**Target Platform**: `apps/api` (HTTP), `apps/worker` (notifications consumer + known event types); admin bell renders
two new templates; no new screen (ACR-Q6)

**Project Type**: modular monolith (web service + worker + admin web app)

**Performance Goals**: each write is a handful of indexed statements in one transaction, well under 200 ms

**Constraints**: expand-only migration (numbered from 0111); no edit to `staff/domain/clock-attendance.ts` or
`staff/persistence/attendance-context.adapter.ts` (lane 16b-2); shared registries edited additively only; no new
module arrow (staff → identity and staff ⇒ notifications already declared)

**Scale/Scope**: 1 table, 1 permission, 3 use cases, 1 query, 2 events, 2 in-app templates, 5 new error codes, ~14
test files

## Constitution Check

| Principle | Check | Result |
|---|---|---|
| I. One vertical slice | One aggregate (the request) and its lifecycle; the two applying kinds are separate slices 26b/26c | ✅ (three small use cases on one aggregate, the decide-leave precedent) |
| II. Domain purity | Lifecycle rules are pure functions in `staff/domain/attendance-change-request.ts`; no arithmetic in use cases; Clock and IdGenerator injected | ✅ |
| III. Tenant isolation | `company_id`, PK `(company_id, id)`, ENABLE + FORCE RLS, tenant-qualified FKs, negative test, column-scoped UPDATE, no DELETE | ✅ |
| IV. Boundaries | identity reads through `identity/index.ts` (arrow declared); events to notifications via outbox (arrow declared); new synchronous adapter line added to `docs/module-map.md` | ✅ |
| V. Tests | Domain unit, integration ACR-01 … ACR-14, RLS negative, query shape + EXPLAIN, worker consumer | ✅ |
| VI. Arabic-first | Error text, permission name, template copy via `packages/i18n` / `packages/notifications` ar+en | ✅ |
| VII. Documented why | Arabic JSDoc on every domain function, port method and published event | ✅ |

Post-design re-check: unchanged, ✅. The kinds port has no production implementation in this PR; it is justified by
`CLAUDE.architecture.md` §12 (two implementations arrive in 26b/26c) and recorded in ADR-0040.

## Design notes

1. **Domain** (`staff/domain/attendance-change-request.ts`, new, pure):
   - `attendanceChangeReason(reason)` — trim, 1–500, else `VALIDATION_FAILED` (spec 034/035 bounds).
   - `planChangeRequest(input, context)` → the new row's status, actors, timestamps and revision. Self rule: refused
     with `ATTENDANCE_CHANGE_SELF_FORBIDDEN` when the actor is the employee and not an owner (ACR-Q3, ACR-Q22c).
     Owner one-step: status APPROVED with `decided_by = requested_by`, `revision 1` (ACR-Q2).
   - `planChangeCancel(request, context)` — requester only (`NOT_FOUND` for anyone else), PENDING only
     (`ATTENDANCE_CHANGE_NOT_PENDING`), revision match (`ATTENDANCE_CHANGE_REVISION_CONFLICT`).
   - `planChangeDecision(request, decision, context)` — decide-permission holder only (`NOT_FOUND`); a non-owner
     holder deciding a request he filed or one about his own attendance → `ATTENDANCE_CHANGE_SELF_FORBIDDEN`; PENDING
     only, revision match, REJECTED requires a reason, APPROVED reason optional (ACR-Q7).
   - Check order for a well-formed request: authority → self → state → revision → kind rules.
2. **Ports**:
   - `ports/attendance-change-transactions.port.ts` — `file`, `cancel`, `decide`: each runs `work(scope)` inside one
     tenant transaction after the locks, under `runIdempotent`, and gives the scope the locked facts (request row,
     employee `user_id`, owner flag, `now`) and `save` callbacks.
   - `ports/attendance-change-kinds.port.ts` — `AttendanceChangeKinds.find(kind)` returns an
     `AttendanceChangeKind | null`. A kind exposes `target(input)` (employee + branch, read without locks, for the
     authority precheck), `check(scope)` (kind rules under locks; returns the values to store) and `apply(scope)`
     (the effect, in the approval transaction). Production registry: empty (DI token `ATTENDANCE_CHANGE_KINDS`,
     `createAttendanceChangeKinds([])`). Tests register a test-only kind by overriding that provider in the test
     module only — never in `staff.module.ts`.
3. **Use cases** (one-line Arabic doc each, no arithmetic, no SQL):
   - `request-attendance-change` — kind lookup (`KIND_UNAVAILABLE` before any write) → transactions.file →
     `kind.check` → `planChangeRequest` → save (+ `kind.apply` when owner one-step) → 201.
   - `cancel-attendance-change` — transactions.cancel → `planChangeCancel` → save → 200.
   - `decide-attendance-change` — transactions.decide → `planChangeDecision` → on APPROVED `kind.check` again then
     `kind.apply` (ACR-Q13: any kind refusal propagates, the transaction rolls back, the request stays PENDING) →
     save → 200.
4. **Locks** (ADR-0028 order, spec 035 BR-002 pattern): non-locking authority precheck on the target branch →
   employee `AttendanceState` row (same statement shape as `lockCorrectionState`, kept in the new records file, not
   imported from `attendance-context.adapter.ts`) → identity company + ordered membership locks
   (`lockAttendanceExceptionAccess`) → request row `FOR UPDATE` (cancel/decide) → second Clock sample → authority
   re-read. Idempotency fingerprint = sha256(action, actor user, business, request id, body).
5. **Identity** (`identity/persistence/attendance-change-access.ts`, exported from `identity/index.ts`):
   - `readAttendanceChangeAccess(tx, companyId, userId, businessId, branchId, now)` → `{ canRequest, canDecide,
     owner }` — both permissions via `evaluateAccess`, owner via `canonicalOwnerSql` (every owner membership).
   - `readAttendanceChangeApprovers(tx, companyId, businessId, branchId, now)` → distinct `user_id` of active members
     for whom `decide:attendance-change:company` evaluates true there (owners always included).
6. **Events and notices** (`events/published.ts`, staff `index.ts`, worker `known-event-types.ts`,
   `NOTIFICATION_SOURCE_EVENTS`, `docs/specs/worker/known-event-types.md`, `docs/module-map.md`):
   - `AttendanceChangeRequested` (PENDING filed) — IN_APP to every owner except the requester, groups ≤ 100,
     template `attendance_change_requested` rev 1, parameters `employee_name_ar`, `employee_name_en` (display names),
     `change` (enum `ADD_SESSION` | `VOID_SESSION`). Not emitted for the owner one-step (nobody to ask).
   - `AttendanceChangeDecided` (approve/reject) — IN_APP to the requester when the decider is someone else, template
     `attendance_change_decided` rev 1, parameters employee names, `change`, `decision` (enum), and `reason` (safe
     text; when absent or failing the safe-text rule the value is `-`, research R4).
   - Payload facts: request id, kind, status, employee, business, branch, actor ids, timestamps, revision. The free
     reason travels only inside the requester's notification parameters (ACR-Q12), never in the facts.
7. **Errors** (`apps/api/src/shared/errors.ts`, i18n ar/en): `ATTENDANCE_CHANGE_SELF_FORBIDDEN` 403,
   `ATTENDANCE_CHANGE_NOT_PENDING` 409, `ATTENDANCE_CHANGE_REVISION_CONFLICT` 409,
   `ATTENDANCE_CHANGE_DUPLICATE_PENDING` 409 (mapped from the partial UNIQUE violation; used by kinds),
   `ATTENDANCE_CHANGE_KIND_UNAVAILABLE` 422; reused `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`,
   `IDEMPOTENCY_KEY_REUSED`, `TRANSACTION_RETRY_REQUIRED`, `NOT_READY`.
8. **Audit** (`appendAuditLog`, entity `attendance_change_request`): `attendance_change.requested`, `.approved`,
   `.rejected`, `.cancelled`; before/after hold status, revision, actor ids and timestamps; reasons stay on the row,
   not in the audit snapshot (spec 025 pattern). The owner one-step writes `requested` and `approved`.

## Change 2026-10-10 — ACR-Q4 and ACR-Q21 moved to option 2

- **ACR-Q4**: new permission `decide:attendance-change:company`, default owner only, owner-granted (added to
  `OWNER_GRANTED_PERMISSIONS` in `packages/db/src/role-defaults.ts` and the identity `permission-edit.ts` list, the
  OD-Q5 pattern: a non-owner editor gets `PERMISSION_OWNER_ONLY`), device-forbidden, i18n name, permission row +
  owner default in a new expand migration. The use cases replace the owner check with the permission check; the self
  rules of BR-004 apply to non-owner holders; recipients become every holder in scope (BR-006); the list treats decide
  holders like owners. Owner one-step (ACR-Q2) and owner self-decision (ACR-Q22c) stay owner-only.
- **ACR-Q21**: no code in 26a. The `kind` CHECK keeps an explicit list so 26c adds `RESTORE_SESSION` with one expand
  migration (drop + re-add the CHECK `NOT VALID`, then validate).

## Project Structure

### Documentation (this feature)

```text
docs/specs/044-staff-attendance-change-requests/
├── spec.md · owner-questions.ar.md · plan.md · research.md · data-model.md · quickstart.md · tasks.md
├── contracts/attendance-change-requests-api.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
packages/db/
├── schema/staff-attendance-change-requests.ts            (new) + schema index export
├── migrations/0111_2026-10-10_attendance-change-requests.sql (+ meta/_journal.json, snapshot)
└── src/{access-catalog,role-defaults,system-role-policy}.ts  (+ __tests__/privileges.spec.ts, role-defaults.spec.ts)
packages/contracts/src/staff/attendance-change-request{,-openapi}.ts (new) + index.ts, openapi.ts, in-app-notifications.ts
packages/notifications/src/templates/attendance-change-{requested,decided}.ts (new) + registry
packages/i18n/src/{ar,en,permission-name}.ts
apps/api/src/modules/staff/
├── domain/attendance-change-request.ts (+ __tests__)
├── ports/attendance-change-{transactions,kinds}.port.ts
├── persistence/{attendance-change-records,attendance-change-writes,attendance-change-context.adapter,drizzle-attendance-change-transactions,attendance-change-kinds}.ts
├── use-cases/{request,cancel,decide}-attendance-change/
├── queries/attendance-change-requests.query.ts
├── http/{attendance-change-requests.controller,attendance-change-http}.ts
├── events/published.ts · index.ts · staff.module.ts
└── __tests__/ (integration, RLS, query, races, http)
apps/api/src/modules/identity/{persistence/attendance-change-access.ts,index.ts}
apps/api/src/shared/errors.ts
apps/worker/src/{outbox/known-event-types.ts,modules/notifications/events/handlers/on-notification-request.handler.ts}
apps/admin/src/notifications/model/render-notification.ts · apps/{admin,pos}/src/shared/api/schema.d.ts · openapi/openapi.json
docs/{module-map.md,specs/worker/known-event-types.md,adr/0040-attendance-change-requests.md}
```

**Structure Decision**: the standard staff module shape (`CLAUDE.md` §2.2); no new folder outside it.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Kinds port with no production implementation in this PR | Owner split 26a/26b/26c into three PRs; the mechanism must merge first | Shipping 26a with one kind would merge two use cases into one PR (`CLAUDE.md` §1) and block the parallel 26b/26c |
