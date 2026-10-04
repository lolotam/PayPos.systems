# Feature Specification: Manager passkey unbind and shared-install attendance signal

**Feature Branch**: `feat/p1-21-unbind-passkey`
**Created**: 2026-10-04
**Status**: Implementation scope and owner policies approved 2026-10-04
**Sources**: Phase 1 SPEC §7; implementation plan PR 21; ADR-0013 §8;
spec 024; ADR-0027; ADR-0025; explicit implementation instructions.

## User Scenarios & Testing

### User Story 1 — Replace a lost authenticator (Priority: P1)

A permitted manager opens an employee's page, reviews binding history and unbinds
the current binding with a reason. The employee may then perform first enrollment again.

**Independent Test**: Bind, issue an operation proof, unbind, reject the stale proof,
enroll again, and verify both historical entries and one audit/event for the unbind.

**Acceptance Scenarios**:

1. **UNB-01**: Unbind keeps the binding, records manager/time/reason, invalidates its
   revision and writes `passkey.unbind` plus `EmployeePasskeyUnbound` atomically.
2. **UNB-02**: Empty/whitespace or over-500-character reasons fail. A trimmed reason
   of 1–500 characters succeeds. The command names the binding id and expected revision,
   so a stale tab cannot unbind a replacement enrollment.
3. **UNB-03**: Unknown, cross-company/business, deleted and inaccessible employees
   share NOT_FOUND, even with an invalid body. Personal/kiosk/device sessions fail.
4. **UNB-04**: Self-unbind fails after scope authorization. Branch managers reach
   only their own branches; business managers only their own business. Device ALLOW
   creation returns PERMISSION_ROLE_FORBIDDEN; historical ALLOW never authorizes.
5. **UNB-05**: Concurrent enrollment/unbind serialize without deadlock. A proof for
   an old binding fails both after unbind and after re-enrollment. Rollback leaves
   binding, audit and outbox unchanged; a retry cannot affect a replacement binding.

### User Story 2 — Review possible shared-device attendance (Priority: P2)

A manager can later review two different employees using the same app installation
within a short window. This never blocks a valid clock operation.

**Independent Test**: Store synthetic accepted-clock signals and query bounded pairs;
same employee, different installations, other tenants and out-of-window pairs do not flag.

**Acceptance Scenarios**:

1. **SIG-01**: Only an installation hash, tenant employee/branch ids and server clock
   time are stored; no raw installation id, browser fingerprint or biometric data.
2. **SIG-02**: Distinct employees with matching company-scoped signal within the
   inclusive window flag. Equal timestamps work; reversed inputs give the same decision.
3. **SIG-03**: Query pairs are cursor-paginated and scoped to authorized branch ids;
   both employees' observations must be visible. Identical clock ids dedupe storage.
4. **SIG-04**: FORCE RLS refuses cross-tenant reads/writes/FKs; other runtime roles
   and mutation/deletion of observations are refused. Query EXPLAIN uses indexes.

### Edge Cases

- A replacement enrollment commits before a retried old command: revision conflict.
- A user is relinked or manager authority is revoked while waiting: recheck under locks.
- Synced passkeys, cleared storage, private browsing or copied installation ids mean
  the signal is fallible; it conveys no physical-device or presence guarantee.
- Barcode clocks have no personal-install signal; PR 22 records only accepted web clocks,
  once per actual clock effect, and never for a deduplicated retry or rejected assertion.

## Requirements

- **FR-001**: Require scoped live permission, active employee and staff feature; prohibit self-unbind.
- **FR-002**: Keep history and invalidate binding revision in one transaction with safe audit/event.
- **FR-003**: Keep global credentials inert; no plugin delete/update/login is enabled.
- **FR-004**: Status, bound-since, paginated history, mandatory-reason action and errors use ar/en.
- **FR-005**: Supply PR 22's installation field, transactional signal writer, pure flag rule
  and PR 27's read query, without implementing clocking or an attendance board.

### Key Entities

- Employee binding: historical employee-to-credential relationship and validity revision.
- Accepted-clock installation observation: privacy-limited, immutable signal for manager review.

## Slice design

### Business rules

- Unbind only the named active binding at its expected revision, then increment revision.
  A new enrollment chooses a higher revision from the retained history.
- **UNB-Q1 — owner decision 2026-10-04 (recommended option)**: read/unbind defaults:
  owner, general_manager, business_manager within their own business and branch_manager
  within their own branch. Device is forbidden; nobody unbinds their own binding.
  Other system human roles remain forbidden for these codes; custom roles keep existing
  PR 7 delegation rules.
- **UNB-Q2 — owner decision 2026-10-04 (recommended option)**: an inclusive 10-minute
  shared-install advisory window; it never blocks attendance.
- **UNB-Q3 — owner decision 2026-10-04 (recommended option)**: a binding spans the
  employee's branches; require authority at primary and every current open attachment,
  matching existing employee privacy.
  A branch manager cannot unbind a binding shared with an inaccessible branch.
  An attachment is current until its exclusive end date in that branch's timezone,
  taken from the request's injected clock; a future-dated detach still counts and
  a future-starting attachment counts too (fail closed). The actor who registered
  the active binding (`bound_by`) is refused as self, even after the employee is relinked.
- **UNB-Q4 — owner decision 2026-10-04 (recommended option)**: device signals are
  retained with attendance history; no cleanup job now.

### Schema changes

| Table | Changes | RLS/grants | Indexes/FKs |
| --- | --- | --- | --- |
| employee_passkeys | Existing revision/unbound columns; reason remains in immutable audit | Existing forced tenant RLS and limited update | Existing active/history indexes; new company/employee/id history cursor index |
| attendance_device_signals | company/id, business/branch/employee, clock_event_id, installation_hash, clocked_at | New forced tenant SELECT/INSERT only | Tenant-qualified employee and branch FKs; company/clock unique; company/hash/time and company/branch/time; FK indexes in creating migration |
| permissions/role_permissions | read:passkeys:branch, unbind:passkeys:branch | New custom reference-data migration; seed matrix kept in sync | Existing indexes |

### API contract

- GET `/v1/businesses/{businessId}/employees/{employeeId}/passkeys`: status,
  can_unbind, safe history with cursor; requires read:passkeys:branch at stored branches.
- POST same resource `/unbind`: `{binding_id, revision, reason}`; scoped preflight
  guard precedes body validation, locked recheck, 200 safe unbound result. No money/stock
  effects: no Idempotency-Key; explicit binding/revision fence makes retry safe.
- GET `/v1/businesses/{businessId}/employee-passkeys`: scoped employee selector
  for managers who have passkey permission without employee editing permission.
- Each route has exactly one `@Authenticated()` plus SelectedCompanyGuard and targeted
  authorization; staff feature. Errors NOT_FOUND, FEATURE_DISABLED, PASSKEY_SELF_UNBIND,
  PASSKEY_REVISION_CONFLICT, VALIDATION_FAILED use bilingual envelopes.
- PR 22 input composes `attendanceInstallationSignal`: `installation_id` (random UUID v4,
  retained across personal logout/operator replacement; generated once in personal app
  storage). Normalize and SHA-256 hash with version/domain/company separation at the
  persistence boundary. It is advisory metadata, never a credential or access factor.

### Permissions

New `read:passkeys:branch` and `unbind:passkeys:branch` have the four owner-approved
manager defaults above; BM memberships stay BUSINESS and Branch Manager stays BRANCH.
Reads do not expose auth credential ids or material. Unbind additionally needs read.

### Events

`EmployeePasskeyUnbound`: employee/binding ids, new revision, unbound time only; no
credential, installation hash, challenge or free-text reason. No consumer in PR 21;
Phase 1 polling exception applies. The dispatcher knows the type so it can acknowledge
it without a subscriber rather than park an unknown event. Reason and actor remain in tenant audit.

### Test plan

Pure domain tests for invalidation/self/flag boundaries; real Postgres/API UNB-01–05,
proof revision fencing and enrollment race; scope/feature/Device grant regression;
SIG-01–04 including RLS, FK, immutability and paginated result-shape/EXPLAIN tests for
every new query. Admin hook/form tests verify generated endpoints, reason validation,
revoked read visibility and submission of the exact displayed binding/revision.
`pnpm check` with FORCE_COLOR unset and api/admin/pos/worker builds (POS has generated contracts only). Built api/worker optional-settings smoke remains required. No new dependency or startup configuration.

## Success Criteria

- Every successful unbind retains its history and one auditable reason/actor.
- Zero stale proofs or stale manager commands can act on a replacement binding.
- Zero inaccessible employee/binding records leak across scopes or tenants.
- Shared-install observations never reject a clock; every qualifying synthetic pair is returned.

## Assumptions

PR 20 and PR 7a/7d are present. Clocking is PR 22, manager board is PR 27.
Technical decisions and the owner decisions dated 2026-10-04 are recorded in ADR-0029.

Amendment 2026-10-04: PR 21 and PR 22 were built in parallel, so PR 22 ships without the `installation_id` field, the POS identifier and the transactional signal write. They move to follow-up PR 22b; until it merges `attendance_device_signals` stays empty and the shared-device flag cannot fire.
